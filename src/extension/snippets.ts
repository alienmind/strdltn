import * as vscode from 'vscode';

export interface Snippet {
	uri: vscode.Uri;
	/** Path below the library folder, without the extension: `drums/four-on-the-floor`. */
	name: string;
}

/**
 * The Snippets view: every .strudel file under a folder named by `vstrudel.libFolder`
 * (default `lib`), anywhere in the workspace. One file is one snippet. A click inserts
 * the file's text at the cursor.
 */
export class SnippetsProvider implements vscode.TreeDataProvider<Snippet> {
	private snippets: Snippet[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	static folderName(): string {
		return vscode.workspace.getConfiguration('vstrudel').get<string>('libFolder', 'lib');
	}

	async refresh(): Promise<void> {
		const folder = SnippetsProvider.folderName();
		const files = await vscode.workspace.findFiles(`**/${folder}/**/*.strudel`, '**/node_modules/**');
		const marker = `/${folder}/`;
		this.snippets = files
			.map((uri) => ({ uri, name: uri.path.slice(uri.path.lastIndexOf(marker) + marker.length).replace(/\.strudel$/, '') }))
			.sort((a, b) => a.name.localeCompare(b.name));
		this.changed.fire();
	}

	all(): Snippet[] {
		return this.snippets;
	}

	getChildren(node?: Snippet): Snippet[] {
		return node ? [] : this.snippets;
	}

	getTreeItem(snippet: Snippet): vscode.TreeItem {
		const item = new vscode.TreeItem(snippet.name, vscode.TreeItemCollapsibleState.None);
		item.resourceUri = snippet.uri;
		item.iconPath = new vscode.ThemeIcon('symbol-snippet');
		item.contextValue = 'snippet';
		item.tooltip = `Insert ${vscode.workspace.asRelativePath(snippet.uri)} at the cursor`;
		item.command = { command: 'vstrudel.insertSnippet', title: 'Insert', arguments: [snippet] };
		return item;
	}
}

/** The text of a snippet file, without a trailing newline so it can go in the middle of a line. */
export async function snippetText(snippet: Snippet): Promise<string> {
	const bytes = await vscode.workspace.fs.readFile(snippet.uri);
	return new TextDecoder().decode(bytes).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}
