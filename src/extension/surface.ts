import * as vscode from 'vscode';

/**
 * Fills a webview with one of our pages: a script and a style from `dist/`, a nonce and a
 * strict CSP. The same for a view in a side bar or the bottom panel and for an editor tab,
 * since both hand over a `vscode.Webview`.
 */
export function setPage(context: vscode.ExtensionContext, webview: vscode.Webview, name: string, roots: string[] = ['dist']): void {
	const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
	webview.options = { enableScripts: true, localResourceRoots: roots.map((root) => vscode.Uri.joinPath(context.extensionUri, root)) };
	const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
	const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${name}.js`));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, `${name}.css`));
	const csp = [`default-src 'none'`, `script-src 'nonce-${nonce}'`, `style-src ${webview.cspSource} 'unsafe-inline'`, `img-src ${webview.cspSource} data:`].join('; ');
	webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

/** A page that does not care where it is shown. `attach` gives it a webview; the returned disposable takes it away. */
export interface Surface {
	attach(webview: vscode.Webview): vscode.Disposable;
}

export interface PlaceOptions {
	/** The view declared in package.json, which is the docked place. */
	viewId: string;
	/** The type of the editor tab, which is the floating place. */
	tabType: string;
	title: string;
	/** A context key, true while floating. The view's `when` hides the docked place with it. */
	contextKey: string;
}

/**
 * Shows a `Surface` docked, as a webview view, or floating, as an editor tab that VS Code
 * moves into a window of its own. One at a time: the surface has one page. A move makes a
 * new page, so a surface keeps its state on the host side and sends it again on `ready`.
 * See "Dock and float" in doc/DAW-PLAN.md.
 */
export class Place implements vscode.WebviewViewProvider {
	private panel?: vscode.WebviewPanel;
	private view?: vscode.WebviewView;
	private attached?: vscode.Disposable;

	constructor(
		private readonly surface: Surface,
		private readonly options: PlaceOptions,
	) {
		void vscode.commands.executeCommand('setContext', options.contextKey, false);
	}

	get floating(): boolean {
		return !!this.panel;
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.onDidDispose(() => {
			if (this.view !== view) return;
			this.view = undefined;
			if (!this.panel) this.drop();
		});
		// The view is hidden while floating, but VS Code may still resolve it once.
		if (!this.panel) this.use(view.webview);
	}

	/** Takes the surface out of the panel into an editor tab, and that tab into a new window when `window` is set. */
	async float(window = true): Promise<void> {
		if (!this.panel) {
			const panel = vscode.window.createWebviewPanel(this.options.tabType, this.options.title, vscode.ViewColumn.Active, { retainContextWhenHidden: true });
			this.panel = panel;
			this.use(panel.webview);
			panel.onDidDispose(() => {
				if (this.panel !== panel) return;
				this.panel = undefined;
				this.drop();
				if (this.view) this.use(this.view.webview);
				void this.setFloating(false);
			});
			await this.setFloating(true);
		}
		this.panel.reveal();
		if (window) await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
	}

	/** Puts the surface back into its view. Closing the floating tab does the same. */
	async dock(): Promise<void> {
		const panel = this.panel;
		this.panel = undefined;
		this.drop();
		panel?.dispose();
		// A view that kept its page while hidden is not resolved again: give it the surface here.
		if (this.view) this.use(this.view.webview);
		await this.setFloating(false);
		await vscode.commands.executeCommand(`${this.options.viewId}.focus`);
	}

	private use(webview: vscode.Webview): void {
		this.drop();
		this.attached = this.surface.attach(webview);
	}

	private drop(): void {
		this.attached?.dispose();
		this.attached = undefined;
	}

	private async setFloating(on: boolean): Promise<void> {
		await vscode.commands.executeCommand('setContext', this.options.contextKey, on);
	}
}
