import * as vscode from 'vscode';
import { type MixerModel, readChains } from '../shared/chains';
import type { FromMixer, ToMixer } from '../shared/mixer';

export interface MixerActions {
	/** Puts the cursor at an offset of a song, in whichever editor shows it. */
	reveal(document: vscode.TextDocument, offset: number): void;
}

/** A pause after typing before the model is read again. Long enough to skip a half typed word, short enough to feel live. */
const PAUSE = 300;

/**
 * The Mixer: a webview view in the bottom panel with one strip per chain of the song in
 * front, its sliders as faders, and the sidechain cables. The host reads the model from
 * the text with `readChains`; the webview draws it. See "Mixer panel" in doc/DAW-PLAN.md.
 *
 * The song in front is the `.strudel` file of the active tab, in either editor. When the
 * focus goes to something else (the Mixer itself, a terminal, a stage) the Mixer keeps the
 * last song, the way the Outline view does.
 */
export class MixerView implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private document?: vscode.TextDocument;
	private model?: MixerModel;
	private error?: string;
	private timer?: ReturnType<typeof setTimeout>;
	private lastState?: Extract<FromMixer, { type: 'state' }>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly actions: MixerActions,
	) {
		context.subscriptions.push(
			vscode.window.tabGroups.onDidChangeTabs(() => this.follow()),
			vscode.window.tabGroups.onDidChangeTabGroups(() => this.follow()),
			vscode.window.onDidChangeActiveTextEditor(() => this.follow()),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document !== this.document) return;
				clearTimeout(this.timer);
				this.timer = setTimeout(() => this.read(), PAUSE);
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				if (document !== this.document) return;
				this.document = this.model = this.error = undefined;
				this.send();
			}),
		);
		this.follow();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
		view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
		const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
		const script = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'mixer.js'));
		const style = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'mixer.css'));
		const csp = [`default-src 'none'`, `script-src 'nonce-${nonce}'`, `style-src ${view.webview.cspSource} 'unsafe-inline'`, `img-src ${view.webview.cspSource} data:`].join('; ');
		view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
		view.webview.onDidReceiveMessage((message: FromMixer) => this.handle(message));
		view.onDidDispose(() => (this.view = undefined));
	}

	/** The model of the song in front, as the parser read it last. For the integration test. */
	current(): { song?: string; model?: MixerModel; error?: string } {
		return { song: this.document && vscode.workspace.asRelativePath(this.document.uri), model: this.model, error: this.error };
	}

	/** Unfolds the named strips and folds the others, and returns what the page reports after it has drawn. */
	async show(unfold: string[]): Promise<Extract<FromMixer, { type: 'state' }> | undefined> {
		// A view that was just opened reports its first draw, before the model arrives. Wait for
		// a report with as many strips as the model has.
		const expected = this.model ? this.model.chains.length + (this.model.global.length ? 1 : 0) : 0;
		this.lastState = undefined;
		for (let i = 0; i < 30; i++) {
			this.send();
			this.post({ type: 'show', unfold });
			await new Promise((resolve) => setTimeout(resolve, 200));
			// Set by the message handler meanwhile; the compiler cannot know.
			const state = this.lastState as Extract<FromMixer, { type: 'state' }> | undefined;
			if (state?.strips.length === expected) break;
		}
		return this.lastState;
	}

	private handle(message: FromMixer): void {
		switch (message.type) {
			case 'ready':
				return this.send();
			case 'reveal': {
				const chain = this.model?.chains[message.chain];
				if (chain && this.document) this.actions.reveal(this.document, chain.from);
				return;
			}
			case 'state':
				this.lastState = message;
				return;
			case 'log':
				this.output.appendLine(`mixer: ${message.message}`);
				return;
		}
	}

	/** Finds the song of the active tab. Anything that is not a song keeps the last one. */
	private follow(): void {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
		if (!uri || !uri.path.endsWith('.strudel')) return;
		if (this.document?.uri.toString() === uri.toString()) return;
		const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
		if (document) return this.use(document);
		void vscode.workspace.openTextDocument(uri).then(
			(opened) => this.use(opened),
			() => undefined,
		);
	}

	private use(document: vscode.TextDocument): void {
		this.document = document;
		this.model = this.error = undefined;
		this.read();
	}

	private read(): void {
		if (!this.document) return;
		const result = readChains(this.document.getText());
		if ('error' in result) {
			// Half typed code. The strips stay as they were, marked as old.
			this.error = result.error;
		} else {
			this.model = result;
			this.error = undefined;
		}
		this.send();
	}

	private send(): void {
		const song = this.document?.uri.path.split('/').pop();
		this.post({ type: 'model', song, model: this.model, error: this.error });
	}

	private post(message: ToMixer): void {
		void this.view?.webview.postMessage(message);
	}
}
