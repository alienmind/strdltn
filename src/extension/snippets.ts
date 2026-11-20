import * as vscode from 'vscode';
import { parseSnippet, type SnippetInfo } from '../shared/snippet';

export interface Snippet extends SnippetInfo {
	uri: vscode.Uri;
}

/** A folder of the library, or one snippet in it. */
export type SnippetNode = { kind: 'folder'; name: string; snippets: SnippetNode[] } | ({ kind: 'snippet'; parent?: SnippetNode } & Snippet);

/** One color per category, from the palette VS Code gives to charts, so it fits every theme. */
const CATEGORY_COLORS: Record<string, string> = {
	drums: 'charts.red',
	bass: 'charts.orange',
	melody: 'charts.yellow',
	chords: 'charts.green',
	texture: 'charts.blue',
	effect: 'charts.purple',
	function: 'terminal.ansiCyan',
	song: 'terminal.ansiMagenta',
	visual: 'terminal.ansiBrightGreen',
};

/** A preview is for a look. A whole song would make the hover taller than the window. */
const PREVIEW_LINES = 30;

/**
 * The Snippets view: every .strudel file under a folder named by `strdltn.libFolder`
 * (default `lib`), anywhere in the workspace. One file is one snippet.
 *
 * It is a tree, like the Sounds view above it: a row per snippet, with the same two
 * small buttons, insert at the cursor and open. The description and the code are in
 * the hover of the row. VS Code draws that hover itself, so it floats over the editor
 * and is not held inside the narrow side bar, and it colors the code with the
 * highlighter of the editor.
 */
export class SnippetsView implements vscode.TreeDataProvider<SnippetNode> {
	private snippets: Snippet[] = [];
	private roots: SnippetNode[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	static folderName(): string {
		return vscode.workspace.getConfiguration('strdltn').get<string>('libFolder', 'lib');
	}

	async refresh(): Promise<void> {
		const folder = SnippetsView.folderName();
		const files = await vscode.workspace.findFiles(`**/${folder}/**/*.strudel`, '**/node_modules/**');
		const marker = `/${folder}/`;
		const snippets = await Promise.all(
			files.map(async (uri) => {
				const name = uri.path.slice(uri.path.lastIndexOf(marker) + marker.length).replace(/\.strudel$/, '');
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
				return { uri, ...parseSnippet(name, text) };
			}),
		);
		this.snippets = snippets.sort((a, b) => a.name.localeCompare(b.name));
		// One row per folder of the library, then the snippets that sit at its top.
		const folders = new Map<string, SnippetNode & { kind: 'folder' }>();
		const loose: SnippetNode[] = [];
		for (const snippet of this.snippets) {
			if (!snippet.folder) {
				loose.push({ kind: 'snippet', ...snippet });
				continue;
			}
			let node = folders.get(snippet.folder);
			if (!node) folders.set(snippet.folder, (node = { kind: 'folder', name: snippet.folder, snippets: [] }));
			node.snippets.push({ kind: 'snippet', parent: node, ...snippet });
		}
		this.roots = [...folders.values(), ...loose];
		this.changed.fire();
	}

	all(): Snippet[] {
		return this.snippets;
	}

	find(name: string): Snippet | undefined {
		return this.snippets.find((snippet) => snippet.name === name);
	}

	/** The row of one snippet. The integration test opens its folder for a screenshot. */
	node(name: string): SnippetNode | undefined {
		return this.roots.flatMap((root) => (root.kind === 'folder' ? root.snippets : [root])).find((node) => node.kind === 'snippet' && node.name === name);
	}

	getChildren(node?: SnippetNode): SnippetNode[] {
		if (!node) return this.roots;
		return node.kind === 'folder' ? node.snippets : [];
	}

	getParent(node: SnippetNode): SnippetNode | undefined {
		return node.kind === 'snippet' ? node.parent : undefined;
	}

	getTreeItem(node: SnippetNode): vscode.TreeItem {
		if (node.kind === 'folder') {
			const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
			item.description = String(node.snippets.length);
			item.contextValue = 'folder';
			return item;
		}
		const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
		const field = (name: string) => node.fields.find((entry) => entry.name === name)?.value;
		// Shown dimmed after the title, and searched by the filter of the tree (Ctrl+F in the view).
		item.description = field('tags');
		const color = CATEGORY_COLORS[node.category ?? ''];
		item.iconPath = new vscode.ThemeIcon('circle-filled', color ? new vscode.ThemeColor(color) : undefined);
		item.contextValue = 'snippet';
		item.tooltip = SnippetsView.preview(node);
		return item;
	}

	/** The hover of a row: what the snippet is, its header fields, and its code. */
	static preview(snippet: Snippet): vscode.MarkdownString {
		const text = new vscode.MarkdownString();
		const plain = (value: string) => value.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
		text.appendMarkdown(`**${plain(snippet.title)}**\n\n`);
		const details = snippet.fields.find((field) => field.name === 'details');
		if (details) text.appendMarkdown(`${plain(details.value)}\n\n`);
		const rest = snippet.fields.filter((field) => field.name !== 'details');
		if (rest.length) text.appendMarkdown(`${rest.map((field) => `*${plain(field.name)}:* ${plain(field.value)}`).join('   ')}\n\n`);
		const lines = snippet.code.split('\n');
		const shown = lines.slice(0, PREVIEW_LINES).join('\n');
		text.appendCodeblock(lines.length > PREVIEW_LINES ? `${shown}\n// ... ${lines.length - PREVIEW_LINES} more lines` : shown, 'javascript');
		return text;
	}
}
