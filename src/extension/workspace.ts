import * as vscode from 'vscode';
import { STRDLTN_DIR, STRDLTN_GITIGNORE, strdltnSegments } from '../shared/workspace';

/** `<workspace>/.strdltn/cache[/...sub]`. */
export function strdltnCacheDir(workspaceFolder: vscode.Uri, ...sub: string[]): vscode.Uri {
	return vscode.Uri.joinPath(workspaceFolder, ...strdltnSegments('cache', ...sub));
}

/** `<workspace>/.strdltn/tmp[/...sub]`. */
export function strdltnTmpDir(workspaceFolder: vscode.Uri, ...sub: string[]): vscode.Uri {
	return vscode.Uri.joinPath(workspaceFolder, ...strdltnSegments('tmp', ...sub));
}

/** Ensures `<workspace>/.strdltn/<kind>[/...sub]` exists along with `.strdltn/.gitignore` ignoring `*`. */
export async function ensureStrdltnDir(workspaceFolder: vscode.Uri, kind: 'cache' | 'tmp', ...sub: string[]): Promise<vscode.Uri> {
	const fs = vscode.workspace.fs;
	const target = vscode.Uri.joinPath(workspaceFolder, ...strdltnSegments(kind, ...sub));
	await fs.createDirectory(target);
	const ignore = vscode.Uri.joinPath(workspaceFolder, STRDLTN_DIR, '.gitignore');
	try {
		await fs.stat(ignore);
	} catch {
		await fs.writeFile(ignore, new TextEncoder().encode(STRDLTN_GITIGNORE));
	}
	return target;
}
