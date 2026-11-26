import * as vscode from 'vscode';
import { HUB_CATALOG, HUB_INDEX, type HubFirmware, mergeHubFirmwares, parseHubCatalog, parseHubIndex } from '../shared/firmware';

/** The lists are read at most once a day, as the hub asks of apps for its catalog.json (kb/#catalog). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The firmwares of The Firmware Hub: both VIBE FM `.wasm` builds (`play.thefirmwarehub.com/firmware/index.json`) and
 * real FM-1 `.fwsc` firmwares (`thefirmwarehub.com/catalog.json`), deduplicated so VIBE `.wasm` wins whenever both
 * exist. Both lists are cached once a day in global storage so offline use keeps working.
 */
export class HubCatalog implements vscode.Disposable {
	private list: HubFirmware[] = [];
	private readonly changed = new vscode.EventEmitter<HubFirmware[]>();
	readonly onDidChange = this.changed.event;
	private readonly vibeFile: vscode.Uri;
	private readonly catalogFile: vscode.Uri;
	private loading?: Promise<void>;
	readAt?: number;
	error?: string;

	constructor(
		context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly userAgent: string,
	) {
		this.vibeFile = vscode.Uri.joinPath(context.globalStorageUri, 'firmware', 'hub-index.json');
		this.catalogFile = vscode.Uri.joinPath(context.globalStorageUri, 'firmware', 'hub-catalog.json');
	}

	all(): HubFirmware[] {
		return this.list;
	}

	/** Loads kept copies, and refreshes any copy that is a day old or missing. Once at a time. */
	load(): Promise<void> {
		return (this.loading ??= this.read().finally(() => (this.loading = undefined)));
	}

	private async read(): Promise<void> {
		const [vibe, fwsc] = await Promise.all([
			this.readOne(this.vibeFile, HUB_INDEX, parseHubIndex, 'VIBE index'),
			this.readOne(this.catalogFile, HUB_CATALOG, parseHubCatalog, 'FM-1 catalog'),
		]);
		const merged = mergeHubFirmwares(vibe.list, fwsc.list);
		const readAt = Math.max(vibe.readAt ?? 0, fwsc.readAt ?? 0) || Date.now();
		this.error = vibe.error ?? fwsc.error;
		this.list = merged;
		this.readAt = readAt;
		this.changed.fire(merged);
	}

	private async readOne(
		file: vscode.Uri,
		url: string,
		parse: (json: unknown) => HubFirmware[],
		label: string,
	): Promise<{ list: HubFirmware[]; readAt?: number; error?: string }> {
		let kept: { readAt: number; json: unknown } | undefined;
		try {
			kept = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
		} catch {
			// Never read yet.
		}
		if (kept && Date.now() - kept.readAt < DAY_MS) {
			return { list: parse(kept.json), readAt: kept.readAt };
		}
		try {
			const response = await fetch(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } });
			if (!response.ok) throw new Error(`${response.status}`);
			const json = await response.json();
			const readAt = Date.now();
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
			await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify({ readAt, json })));
			const list = parse(json);
			this.output.appendLine(`[firmware] ${label} lists ${list.length} firmwares`);
			return { list, readAt };
		} catch (error) {
			const msg = (error as Error).message;
			this.output.appendLine(`[firmware] ${label} could not be read (${msg})${kept ? ', using cached copy' : ''}`);
			return { list: kept ? parse(kept.json) : [], readAt: kept?.readAt, error: msg };
		}
	}

	dispose(): void {
		this.changed.dispose();
	}
}
