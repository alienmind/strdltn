import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import * as vscode from 'vscode';
import { firmwareFileName, firmwareIdFromUrl, type FirmwareRuntime, type HubFirmware, type InstalledFirmware } from '../shared/firmware';
import type { FirmwareInfo } from '../shared/protocol';
import { STRDLTN_EXCLUDE_GLOB } from '../shared/workspace';
import { ensureStrdltnDir, strdltnCacheDir } from './workspace';

/** A firmware id as the SDK allows it: letters, digits, `-`, `_`, `.`. Mini-notation keeps all of them in `vibefm1:<id>`. */
const ID = /^[A-Za-z0-9._-]+$/;

/**
 * Lists the VIBE FM firmwares in a folder of the workspace. Two layouts, because people get them two ways:
 * - `<id>.wasm`, with `<id>.json` beside it, as the SDK's `firmwares/` folder has them.
 * - `<id>/<anything>.wasm` with `firmware.json`, an unzipped package from thefirmwarehub.com.
 * The json gives the name, author, version and license. Without one the id is the name.
 *
 * Like the samples, files are served with `asWebviewUri`, so this works in Codespaces too.
 */
export async function scanFirmware(folder: vscode.Uri, webview: vscode.Webview): Promise<FirmwareInfo[]> {
	return (await listFolder(folder)).map(({ id, meta, file, runtime }) => info(id, meta, webview.asWebviewUri(file), runtime));
}

type Found = { id: string; meta: Record<string, unknown>; file: vscode.Uri; runtime: FirmwareRuntime };

/** The firmwares of one folder, `.wasm` (VIBE FM) and `.fwsc` (real FM-1 hardware packages), in both layouts. */
async function listFolder(folder: vscode.Uri): Promise<Found[]> {
	const list: Found[] = [];
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(folder);
	} catch {
		return list;
	}
	const names = new Set(entries.map(([name]) => name));
	for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
		const uri = vscode.Uri.joinPath(folder, name);
		if (type & vscode.FileType.File && (name.endsWith('.wasm') || /\.fwsc$/i.test(name))) {
			const isFwsc = /\.fwsc$/i.test(name);
			const id = name.slice(0, -5);
			if (!ID.test(id)) continue;
			const meta = names.has(`${id}.json`) ? await readJson(vscode.Uri.joinPath(folder, `${id}.json`)) : {};
			list.push({ id, meta, file: uri, runtime: isFwsc ? 'fwsc' : 'vibe' });
		} else if (type & vscode.FileType.Directory && ID.test(name)) {
			const files = await vscode.workspace.fs.readDirectory(uri);
			const wasm = files.map(([file]) => file).find((file) => file.endsWith('.wasm') && !file.endsWith('.aot.wasm'));
			const fwsc = !wasm ? files.map(([file]) => file).find((file) => /\.fwsc$/i.test(file)) : undefined;
			const picked = wasm ?? fwsc;
			if (!picked) continue;
			const meta = files.some(([file]) => file === 'firmware.json') ? await readJson(vscode.Uri.joinPath(uri, 'firmware.json')) : {};
			list.push({ id: name, meta, file: vscode.Uri.joinPath(uri, picked), runtime: fwsc ? 'fwsc' : 'vibe' });
		}
	}
	return list;
}

async function readJson(uri: vscode.Uri): Promise<Record<string, unknown>> {
	try {
		return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
	} catch {
		return {};
	}
}

function info(id: string, meta: Record<string, unknown>, url: vscode.Uri, runtime: FirmwareRuntime): FirmwareInfo {
	const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : undefined);
	return {
		id: id.toLowerCase(),
		name: text('name') ?? id,
		author: text('author'),
		version: text('version'),
		license: text('license'),
		description: text('description'),
		runtime,
		url: url.toString(),
	};
}

/** Never firmware folders: packages and git's own folder. The cache is read on its own, below. */
const EXCLUDE = STRDLTN_EXCLUDE_GLOB;

const folderSetting = () => vscode.workspace.getConfiguration('strdltn').get<string>('firmwareFolder', 'firmware');

/**
 * The firmwares the Library lists under Installed: every `firmware/` folder of the workspace (the setting
 * `strdltn.firmwareFolder`), and the copies in `.strdltn/cache/firmware/` of each workspace folder. The cache is
 * read with readDirectory, not findFiles: its `.gitignore` says `*`, and a search may skip ignored files.
 * A song plays a folder firmware only from the folder nearest to it (`Session.firmwareFolder`); the Library shows all.
 */
export class FirmwareLibrary implements vscode.Disposable {
	private list: InstalledFirmware[] = [];
	private readonly changed = new vscode.EventEmitter<InstalledFirmware[]>();
	readonly onDidChange = this.changed.event;
	private readonly disposables: vscode.Disposable[] = [];
	private timer?: ReturnType<typeof setTimeout>;
	/** Where each id's file is, for the screen preview. A folder firmware first, as in the engine. */
	private files = new Map<string, vscode.Uri>();

	constructor(cache: FirmwareCache) {
		const watch = (glob: string) => {
			const watcher = vscode.workspace.createFileSystemWatcher(glob);
			watcher.onDidCreate(() => this.soon());
			watcher.onDidDelete(() => this.soon());
			watcher.onDidChange(() => this.soon());
			this.disposables.push(watcher);
		};
		watch(`**/${folderSetting()}/**`);
		watch('**/.strdltn/cache/firmware/**');
		this.disposables.push(
			cache.onDidChange(() => this.soon()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.soon()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('strdltn.firmwareFolder')) this.soon();
			}),
		);
	}

	all(): InstalledFirmware[] {
		return this.list;
	}

	/** The file of an installed firmware: its `.wasm`, or the package `.zip` it came in. */
	file(id: string): vscode.Uri | undefined {
		return this.files.get(id);
	}

	/**
	 * Installs a firmware of the hub into the project: `<firmware folder>/<id>/<id>.wasm` with a `firmware.json` of the
	 * hub's fields, the layout of an unzipped package, at the root of the first workspace folder. From there every song
	 * of the project finds it (`Session.firmwareFolder` looks in the parent folders), with no `firmware()` line.
	 */
	async install(fw: HubFirmware, bytes: Uint8Array, refresh = true): Promise<vscode.Uri> {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) throw new Error('open a folder first: a firmware is installed into the project');
		if (fw.sha256) {
			const actual = createHash('sha256').update(bytes).digest('hex');
			if (actual.toLowerCase() !== fw.sha256.toLowerCase()) {
				throw new Error(`SHA-256 mismatch for ${fw.name}`);
			}
		}
		const folder = vscode.Uri.joinPath(workspace.uri, folderSetting(), fw.id);
		await vscode.workspace.fs.createDirectory(folder);
		const ext = fw.runtime === 'fwsc' ? 'fwsc' : 'wasm';
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, `${fw.id}.${ext}`), bytes);
		const meta = {
			name: fw.name,
			version: fw.version,
			author: fw.author,
			license: fw.license,
			description: fw.description,
			runtime: fw.runtime ?? 'vibe',
			editor: fw.editor,
			source: fw.url,
			cheat: fw.cheat,
		};
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'firmware.json'), new TextEncoder().encode(`${JSON.stringify(meta, null, '\t')}\n`));
		if (refresh) await this.refresh();
		return folder;
	}

	/** What changes when an installed firmware's file does: for the key of its picture. */
	async stamp(id: string): Promise<string | undefined> {
		const file = this.files.get(id);
		if (!file) return undefined;
		try {
			const stat = await vscode.workspace.fs.stat(file);
			return `${file.toString()}|${stat.mtime}|${stat.size}`;
		} catch {
			return undefined;
		}
	}

	/** A change comes as a burst of file events: one scan after the last. */
	private soon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.refresh(), 300);
	}

	async refresh(): Promise<void> {
		const name = folderSetting();
		const several = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
		const relative = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, several);
		const list: InstalledFirmware[] = [];
		const files = new Map<string, vscode.Uri>();
		const keep = (fw: InstalledFirmware, file: vscode.Uri) => {
			list.push(fw);
			if (!files.has(fw.id)) files.set(fw.id, file);
		};
		// Every folder of that name with a .wasm or .fwsc in it or one level down: the two layouts of listFolder.
		const folders = new Map<string, vscode.Uri>();
		for (const uri of await vscode.workspace.findFiles(`**/${name}/**/*.{wasm,fwsc}`, EXCLUDE)) {
			const parts = uri.path.split('/');
			const at = parts.lastIndexOf(name);
			if (at < 0 || parts.length - at > 3) continue;
			const folder = uri.with({ path: parts.slice(0, at + 1).join('/') });
			folders.set(folder.toString(), folder);
		}
		for (const folder of [...folders.values()].sort((a, b) => a.path.localeCompare(b.path))) {
			for (const { id, meta, file, runtime } of await listFolder(folder)) {
				keep({ ...describe(id.toLowerCase(), meta), runtime, from: 'folder', path: relative(file) }, file);
			}
		}
		for (const workspace of vscode.workspace.workspaceFolders ?? []) {
			const root = strdltnCacheDir(workspace.uri, 'firmware');
			let entries: [string, vscode.FileType][] = [];
			try {
				entries = await vscode.workspace.fs.readDirectory(root);
			} catch {
				continue;
			}
			for (const [hash, type] of entries) {
				if (!(type & vscode.FileType.Directory)) continue;
				const folder = vscode.Uri.joinPath(root, hash);
				// `.complete` is written last and names the address: a folder without it is a download that broke off.
				const url = await readText(vscode.Uri.joinPath(folder, '.complete')).then(
					(text) => text.split('\n')[0].trim(),
					() => '',
				);
				const id = firmwareIdFromUrl(url);
				if (!/^https?:\/\//.test(url) || !ID.test(id)) continue;
				const file = vscode.Uri.joinPath(folder, firmwareFileName(url));
				keep({ ...describe(id, await packageMeta(file)), from: 'cache', path: relative(file), url }, file);
			}
		}
		this.list = list;
		this.files = files;
		this.changed.fire(list);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.disposables.forEach((d) => d.dispose());
		this.changed.dispose();
	}
}

async function readText(uri: vscode.Uri): Promise<string> {
	return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** The `firmware.json` inside a package `.zip` from the hub. A bare `.wasm` has none. */
async function packageMeta(file: vscode.Uri): Promise<Record<string, unknown>> {
	if (!file.path.endsWith('.zip')) return {};
	try {
		const files = unzipSync(await vscode.workspace.fs.readFile(file), { filter: (f) => f.name.split('/').pop() === 'firmware.json' });
		const json = Object.values(files)[0];
		return json ? JSON.parse(new TextDecoder().decode(json)) : {};
	} catch {
		return {};
	}
}

/** Name, author, version, license and description from a firmware's json. Without a name, the id in capitals, as the Devices view writes it. */
function describe(id: string, meta: Record<string, unknown>): Omit<InstalledFirmware, 'from' | 'path'> {
	const text = (key: string) => {
		const value = meta[key];
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	};
	return {
		id,
		name: text('name') ?? id.toUpperCase(),
		author: text('author'),
		version: text('version'),
		license: text('license'),
		description: text('description'),
		editor: text('editor'),
	};
}


/**
 * Keeps a copy of the firmwares that songs load from an address (`firmware('https://...')`), in
 * `.strdltn/cache/firmware/<hash of the address>/` of the workspace folder, beside the sample packs. The host
 * downloads with Node, so a server without CORS headers works too, and a cached firmware plays offline.
 * The file is kept as it came, a `.wasm` or a package `.zip`: the webview tells them apart by their first bytes.
 */
export class FirmwareCache {
	private readonly running = new Map<string, Promise<void>>();
	private readonly changed = new vscode.EventEmitter<void>();
	/** Fires when a firmware finished downloading. */
	readonly onDidChange = this.changed.event;

	constructor(private readonly output: vscode.OutputChannel) {}

	/** `<workspace>/.strdltn/cache/firmware/<16 hex digits of the address' SHA-256>/`. */
	private static folderOf(url: string, workspaceFolder: vscode.Uri): vscode.Uri {
		const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
		return strdltnCacheDir(workspaceFolder, 'firmware', hash);
	}

	/** The webview URL of the cached copy, or undefined while there is none. */
	async cached(url: string, workspaceFolder: vscode.Uri, webview: vscode.Webview): Promise<string | undefined> {
		const file = vscode.Uri.joinPath(FirmwareCache.folderOf(url, workspaceFolder), firmwareFileName(url));
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(file, '..', '.complete'));
			return webview.asWebviewUri(file).toString();
		} catch {
			return undefined;
		}
	}

	/** Downloads a firmware unless it is cached or on its way. Never throws: the webview still fetches it itself. */
	ensure(url: string, workspaceFolder: vscode.Uri): Promise<void> {
		const folder = FirmwareCache.folderOf(url, workspaceFolder);
		const key = folder.toString();
		let run = this.running.get(key);
		if (!run) {
			run = this.download(url, workspaceFolder, folder)
				.catch((error: Error) => this.output.appendLine(`[firmware] ${url}: not cached (${error.message})`))
				.finally(() => this.running.delete(key));
			this.running.set(key, run);
		}
		return run;
	}

	private async download(url: string, workspaceFolder: vscode.Uri, folder: vscode.Uri): Promise<void> {
		const fs = vscode.workspace.fs;
		const done = vscode.Uri.joinPath(folder, '.complete');
		try {
			await fs.stat(done);
			return;
		} catch {
			// Not cached yet.
		}
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} for ${url}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		await ensureStrdltnDir(workspaceFolder, 'cache');
		await fs.createDirectory(folder);
		await fs.writeFile(vscode.Uri.joinPath(folder, firmwareFileName(url)), bytes);
		// Written last: cached() only trusts a folder that has it. It also says where the file came from.
		await fs.writeFile(done, new TextEncoder().encode(`${url}\n`));
		this.output.appendLine(`[firmware] ${url}: cached, ${Math.round(bytes.length / 1024)} KB`);
		this.changed.fire();
	}
}
