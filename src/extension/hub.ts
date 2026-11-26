import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import {
	DEFAULT_FIRMWARE_REPOS,
	type FirmwareRepo,
	type HubFirmware,
	mergeHubFirmwares,
	parseCustomRepos,
	parseRepoPayload,
} from '../shared/firmware';

/** Remote JSON repositories are refreshed at most once a day, as The Firmware Hub asks (kb/#catalog). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Loads firmware marketplace repositories: built-in repos (The Firmware Hub VIBE index & FM-1 .fwsc catalog, plus
 * external vendor repos like SHRUB on shrub.audio) combined with user-configured URLs in
 * `strdltn.firmware.repositories`. Remote JSON catalogs are cached once a day in global storage for offline use.
 */
export class HubCatalog implements vscode.Disposable {
	private list: HubFirmware[] = [];
	private readonly changed = new vscode.EventEmitter<HubFirmware[]>();
	readonly onDidChange = this.changed.event;
	private readonly repoDir: vscode.Uri;
	private readonly configSub: vscode.Disposable;
	private loading?: Promise<void>;
	readAt?: number;
	error?: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly userAgent: string,
	) {
		this.repoDir = vscode.Uri.joinPath(context.globalStorageUri, 'firmware', 'repos');
		this.configSub = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('strdltn.firmware.repositories')) void this.reload();
		});
	}

	all(): HubFirmware[] {
		return this.list;
	}

	/** All active repositories: built-in defaults plus user-configured custom URLs. */
	repos(): FirmwareRepo[] {
		const raw = vscode.workspace.getConfiguration('strdltn').get<unknown>('firmware.repositories', []);
		return [...DEFAULT_FIRMWARE_REPOS, ...parseCustomRepos(raw)];
	}

	/** Loads kept copies, and refreshes any copy that is a day old or missing. Once at a time. */
	load(): Promise<void> {
		return (this.loading ??= this.read(false).finally(() => (this.loading = undefined)));
	}

	/** Forces a reload of repositories (e.g. after adding/removing a custom repo URL). */
	reload(): Promise<void> {
		this.loading = undefined;
		return (this.loading = this.read(true).finally(() => (this.loading = undefined)));
	}

	private async read(forceCustom: boolean): Promise<void> {
		const repos = this.repos();
		const results = await Promise.all(repos.map((repo) => this.readRepo(repo, forceCustom && repo.id.startsWith('custom-'))));
		const vibe: HubFirmware[] = [];
		const fwsc: HubFirmware[] = [];
		let latestRead = 0;
		let firstError: string | undefined;
		for (const res of results) {
			if (res.readAt && res.readAt > latestRead) latestRead = res.readAt;
			if (res.error && !firstError) firstError = res.error;
			for (const fw of res.list) {
				if (fw.runtime === 'fwsc') fwsc.push(fw);
				else vibe.push(fw);
			}
		}
		const merged = mergeHubFirmwares(vibe, fwsc);
		this.error = firstError;
		this.list = merged;
		this.readAt = latestRead || Date.now();
		this.changed.fire(merged);
	}

	private cacheFileFor(url: string): vscode.Uri {
		const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
		return vscode.Uri.joinPath(this.repoDir, `${key}.json`);
	}

	private async readRepo(repo: FirmwareRepo, force: boolean): Promise<{ list: HubFirmware[]; readAt?: number; error?: string }> {
		// External links (e.g. SHRUB) and direct .wasm/.fwsc file URLs need no JSON fetch.
		if (repo.entries?.length || repo.kind === 'external' || /\.(wasm|fwsc)(\?|$)/i.test(repo.url)) {
			return { list: parseRepoPayload(repo), readAt: Date.now() };
		}
		const file = this.cacheFileFor(repo.url);
		let kept: { readAt: number; json: unknown } | undefined;
		if (!force) {
			try {
				kept = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
			} catch {
				// Never read yet.
			}
			if (kept && Date.now() - kept.readAt < DAY_MS) {
				return { list: parseRepoPayload(repo, kept.json), readAt: kept.readAt };
			}
		}
		try {
			const response = await fetch(repo.url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } });
			if (!response.ok) throw new Error(`${response.status}`);
			const json = await response.json();
			const readAt = Date.now();
			await vscode.workspace.fs.createDirectory(this.repoDir);
			await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify({ readAt, json })));
			const list = parseRepoPayload(repo, json);
			this.output.appendLine(`[firmware] repo "${repo.name}" (${repo.url}) lists ${list.length} firmwares`);
			return { list, readAt };
		} catch (error) {
			const msg = (error as Error).message;
			this.output.appendLine(`[firmware] repo "${repo.name}" could not be read (${msg})${kept ? ', using cached copy' : ''}`);
			return { list: kept ? parseRepoPayload(repo, kept.json) : [], readAt: kept?.readAt, error: msg };
		}
	}

	dispose(): void {
		this.configSub.dispose();
		this.changed.dispose();
	}
}
