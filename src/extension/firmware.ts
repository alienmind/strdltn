import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { firmwareFileName } from '../shared/firmware';
import type { FirmwareInfo } from '../shared/protocol';

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
	const list: FirmwareInfo[] = [];
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(folder);
	} catch {
		return list;
	}
	const names = new Set(entries.map(([name]) => name));
	for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
		const uri = vscode.Uri.joinPath(folder, name);
		if (type & vscode.FileType.File && name.endsWith('.wasm')) {
			const id = name.slice(0, -5);
			if (!ID.test(id)) continue;
			const meta = names.has(`${id}.json`) ? await readJson(vscode.Uri.joinPath(folder, `${id}.json`)) : {};
			list.push(info(id, meta, webview.asWebviewUri(uri)));
		} else if (type & vscode.FileType.Directory && ID.test(name)) {
			const files = await vscode.workspace.fs.readDirectory(uri);
			const wasm = files.map(([file]) => file).find((file) => file.endsWith('.wasm') && !file.endsWith('.aot.wasm'));
			if (!wasm) continue;
			const meta = files.some(([file]) => file === 'firmware.json') ? await readJson(vscode.Uri.joinPath(uri, 'firmware.json')) : {};
			list.push(info(name, meta, webview.asWebviewUri(vscode.Uri.joinPath(uri, wasm))));
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

function info(id: string, meta: Record<string, unknown>, url: vscode.Uri): FirmwareInfo {
	const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : undefined);
	return {
		id: id.toLowerCase(),
		name: text('name') ?? id,
		author: text('author'),
		version: text('version'),
		license: text('license'),
		description: text('description'),
		url: url.toString(),
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
		return vscode.Uri.joinPath(workspaceFolder, '.strdltn', 'cache', 'firmware', hash);
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
		await fs.createDirectory(folder);
		const ignore = vscode.Uri.joinPath(workspaceFolder, '.strdltn', '.gitignore');
		try {
			await fs.stat(ignore);
		} catch {
			await fs.writeFile(ignore, new TextEncoder().encode('# Downloaded by strdltn. Safe to delete.\n*\n'));
		}
		await fs.writeFile(vscode.Uri.joinPath(folder, firmwareFileName(url)), bytes);
		// Written last: cached() only trusts a folder that has it. It also says where the file came from.
		await fs.writeFile(done, new TextEncoder().encode(`${url}\n`));
		this.output.appendLine(`[firmware] ${url}: cached, ${Math.round(bytes.length / 1024)} KB`);
		this.changed.fire();
	}
}
