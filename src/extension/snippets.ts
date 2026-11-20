import * as vscode from 'vscode';
import { parseSnippet, type SnippetInfo } from '../shared/snippet';

export interface Snippet extends SnippetInfo {
	uri: vscode.Uri;
}

/** What the Snippets view sends to the extension host. */
type FromView = { type: 'ready' } | { type: 'insert'; name: string } | { type: 'open'; name: string };

/**
 * The Snippets view: every .strudel file under a folder named by `vstrudel.libFolder`
 * (default `lib`), anywhere in the workspace. One file is one snippet.
 *
 * It is a webview and not a tree, because a tree row is one line of plain text. Here a
 * click opens a card with the header fields as a table and the code with syntax colors.
 */
export class SnippetsView implements vscode.WebviewViewProvider {
	private snippets: Snippet[] = [];
	private view: vscode.WebviewView | undefined;

	constructor(private readonly extensionUri: vscode.Uri) {}

	static folderName(): string {
		return vscode.workspace.getConfiguration('vstrudel').get<string>('libFolder', 'lib');
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
		this.send();
	}

	all(): Snippet[] {
		return this.snippets;
	}

	find(name: string): Snippet | undefined {
		return this.snippets.find((snippet) => snippet.name === name);
	}

	/** Opens the card of one snippet. Used by the integration test for its screenshot. */
	expand(name: string): void {
		void this.view?.webview.postMessage({ type: 'expand', name });
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] };
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage((message: FromView) => {
			if (message.type === 'ready') return this.send();
			const snippet = this.find(message.name);
			if (!snippet) return;
			void vscode.commands.executeCommand(message.type === 'insert' ? 'vstrudel.insertSnippet' : 'vstrudel.openSnippet', snippet);
		});
		view.onDidDispose(() => (this.view = undefined));
	}

	private send(): void {
		const snippets = this.snippets.map(({ uri, ...info }) => ({ ...info, path: vscode.workspace.asRelativePath(uri) }));
		void this.view?.webview.postMessage({ type: 'snippets', snippets, folder: SnippetsView.folderName() });
	}

	private html(webview: vscode.Webview): string {
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'snippets-view.js'));
		const csp = `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'`;
		return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	body { padding: 0 0 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
	#filter { box-sizing: border-box; width: calc(100% - 16px); margin: 6px 8px; padding: 3px 6px; color: var(--vscode-input-foreground);
		background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); outline-color: var(--vscode-focusBorder); }
	.empty { padding: 8px 12px; color: var(--vscode-descriptionForeground); }
	details > summary { list-style: none; cursor: pointer; padding: 2px 8px; font-weight: 600; user-select: none; }
	details > summary::-webkit-details-marker { display: none; }
	details > summary::before { content: '\\203A'; display: inline-block; width: 12px; transition: transform .1s; }
	details[open] > summary::before { transform: rotate(90deg); }
	summary .count { margin-left: 6px; font-weight: 400; color: var(--vscode-descriptionForeground); }
	.row { display: flex; align-items: center; gap: 6px; padding: 2px 8px 2px 22px; cursor: pointer; user-select: none; }
	.row:hover { background: var(--vscode-list-hoverBackground); }
	.row.open { background: var(--vscode-list-inactiveSelectionBackground); }
	.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--category, var(--vscode-descriptionForeground)); }
	.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.card { margin: 2px 8px 8px 22px; padding: 8px; border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, #8884));
		border-left: 3px solid var(--category, var(--vscode-descriptionForeground)); background: var(--vscode-editorWidget-background); }
	table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
	th, td { text-align: left; vertical-align: top; padding: 2px 6px 2px 0; }
	th { width: 1%; white-space: nowrap; font-weight: 400; color: var(--vscode-descriptionForeground); text-transform: capitalize; }
	.badge { display: inline-block; padding: 0 6px; border-radius: 8px; color: var(--vscode-editor-background); background: var(--category, var(--vscode-descriptionForeground)); }
	.tag { display: inline-block; margin: 0 4px 2px 0; padding: 0 5px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
	pre { margin: 0 0 8px; padding: 6px 8px; overflow-x: auto; background: var(--vscode-textCodeBlock-background);
		font: var(--vscode-editor-font-size, 12px)/1.45 var(--vscode-editor-font-family, monospace); }
	.tok-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
	.tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
	.tok-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
	.tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
	.tok-call { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
	.tok-label { color: var(--vscode-symbolIcon-variableForeground, #4fc1ff); font-weight: 600; }
	.actions { display: flex; gap: 6px; }
	button { padding: 3px 10px; border: 0; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
<input id="filter" type="search" placeholder="Filter snippets" aria-label="Filter snippets">
<div id="list"></div>
<script src="${script}"></script>
</body>
</html>`;
	}
}
