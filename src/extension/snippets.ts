import * as vscode from 'vscode';
import { parseSnippet, type SnippetInfo } from '../shared/snippet';
import { STRDLTN_EXCLUDE_GLOB } from '../shared/workspace';

export interface Snippet extends SnippetInfo {
	uri: vscode.Uri;
}

/**
 * The snippet library: every .strudel file under a folder named by `strdltn.libFolder`
 * (default `lib`), anywhere in the workspace. One file is one snippet. The Browser shows
 * them in its Snippets category.
 */
export class SnippetLibrary {
	private snippets: Snippet[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	static folderName(): string {
		return vscode.workspace.getConfiguration('strdltn').get<string>('libFolder', 'lib');
	}

	async refresh(): Promise<void> {
		const folder = SnippetLibrary.folderName();
		const files = await vscode.workspace.findFiles(`**/${folder}/**/*.strudel`, STRDLTN_EXCLUDE_GLOB);
		const marker = `/${folder}/`;
		const snippets = await Promise.all(
			files.map(async (uri) => {
				const name = uri.path.slice(uri.path.lastIndexOf(marker) + marker.length).replace(/\.strudel$/, '');
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
				return { uri, ...parseSnippet(name, text) };
			}),
		);
		this.snippets = snippets.sort((a, b) => a.name.localeCompare(b.name));
		this.changed.fire();
	}

	all(): Snippet[] {
		return this.snippets;
	}

	find(name: string): Snippet | undefined {
		return this.snippets.find((snippet) => snippet.name === name);
	}
}
