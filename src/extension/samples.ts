import * as vscode from 'vscode';
import type { SampleMap } from '../shared/protocol';

const AUDIO = /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff)$/i;

/**
 * Builds the sample map for a samples folder. Each subfolder is one sound name and its
 * audio files are the numbered variations (`s("kick:2")`). An audio file directly in
 * the folder is a sound named after the file.
 *
 * Uses `workspace.fs` and `asWebviewUri` rather than Node `fs` and a local HTTP server,
 * so the same code serves files from a Codespaces remote to a webview in the browser.
 */
export async function scanSamples(folder: vscode.Uri, webview: vscode.Webview): Promise<SampleMap> {
	const map: SampleMap = {};
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(folder);
	} catch {
		return map;
	}
	const url = (uri: vscode.Uri) => webview.asWebviewUri(uri).toString();
	for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
		const uri = vscode.Uri.joinPath(folder, name);
		if (type & vscode.FileType.Directory) {
			const files = (await vscode.workspace.fs.readDirectory(uri))
				.filter(([file, fileType]) => fileType & vscode.FileType.File && AUDIO.test(file))
				.map(([file]) => file)
				.sort((a, b) => a.localeCompare(b));
			if (files.length) map[name] = files.map((file) => url(vscode.Uri.joinPath(uri, file)));
		} else if (AUDIO.test(name)) {
			map[name.replace(AUDIO, '')] = [url(uri)];
		}
	}
	return map;
}
