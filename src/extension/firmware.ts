import * as vscode from 'vscode';
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
