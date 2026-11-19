import * as vscode from 'vscode';
import { diffText, type FromWebview, type Mode, type SoundInfo, type ToWebview } from '../shared/protocol';
import { scanSamples } from './samples';

/**
 * One webview bound to one text document. The same class backs both layouts: the
 * Strudel editor (a custom editor tab) and the stage (a panel beside the native editor).
 * The document stays the source of truth, which is what gives us save, reload from
 * disk and edits by agents without any code here.
 */
export class Session {
	/** The text the webview is known to hold. Used to tell our own echo from a real outside change. */
	private known: string;
	/** Edits from the webview are applied one at a time. Each one is a diff against the
	 * document, so a second diff computed before the first has landed would corrupt the text. */
	private queue: Promise<unknown> = Promise.resolve();
	private ready = false;
	private playWhenReady = false;
	private readonly disposables: vscode.Disposable[] = [];
	started = false;
	/** Everything the webview logged. Read by the integration test through the extension API. */
	readonly logs: string[] = [];
	/** When this session's tab was last the active one. Picks the target of a preview or insert. */
	lastActiveAt = Date.now();

	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly document: vscode.TextDocument,
		readonly panel: vscode.WebviewPanel,
		readonly mode: Mode,
		private readonly output: vscode.OutputChannel,
		private readonly events: { onDispose(session: Session): void; onSounds(sounds: SoundInfo[]): void },
	) {
		this.known = document.getText();
		const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'dist'),
				vscode.Uri.joinPath(document.uri, '..'),
				...workspaceFolders,
			],
		};
		panel.webview.html = this.html();

		this.disposables.push(
			panel.webview.onDidReceiveMessage((message: FromWebview) => this.receive(message)),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document !== document) return;
				const text = document.getText();
				if (text === this.known) return;
				this.known = text;
				this.post({ type: 'update', text });
			}),
		);
		this.disposables.push(
			panel.onDidChangeViewState(() => {
				if (panel.active) this.lastActiveAt = Date.now();
			}),
		);
		panel.onDidDispose(() => {
			this.disposables.forEach((d) => d.dispose());
			events.onDispose(this);
		});
	}

	preview(name: string, index: number): void {
		this.post({ type: 'preview', name, index });
	}

	/** Inserts at the cursor of the Strudel editor. The change comes back as a normal edit. */
	insert(text: string): void {
		this.post({ type: 'insert', text });
	}

	/** Scans the samples folder again, after files were added or removed. */
	async refreshSamples(): Promise<void> {
		if (!this.ready) return;
		this.post({ type: 'samples', samples: await scanSamples(await this.samplesFolder(), this.panel.webview) });
	}

	play(): void {
		if (this.ready) this.post({ type: 'play' });
		else this.playWhenReady = true;
	}

	stop(): void {
		this.post({ type: 'stop' });
	}

	private post(message: ToWebview): void {
		void this.panel.webview.postMessage(message);
	}

	private async receive(message: FromWebview): Promise<void> {
		switch (message.type) {
			case 'ready': {
				const samples = await scanSamples(await this.samplesFolder(), this.panel.webview);
				this.known = this.document.getText();
				this.post({ type: 'init', text: this.known, mode: this.mode, samples });
				this.ready = true;
				if (this.playWhenReady) {
					this.playWhenReady = false;
					this.post({ type: 'play' });
				}
				break;
			}
			case 'edit':
				this.queue = this.queue.then(() => this.applyEdit(message.text));
				break;
			case 'started':
				this.started = message.started;
				break;
			case 'sounds':
				this.events.onSounds(message.sounds);
				break;
			case 'log': {
				const line = `[${this.mode}] ${message.level}: ${message.message}`;
				this.logs.push(line);
				this.output.appendLine(line);
				break;
			}
		}
	}

	/**
	 * The samples folder nearest to the file: beside it, or in a parent folder, up to
	 * the workspace root. A song in a subfolder of a bigger repo then still finds the
	 * samples that belong to it.
	 */
	private async samplesFolder(): Promise<vscode.Uri> {
		const name = vscode.workspace.getConfiguration('vstrudel').get<string>('samplesFolder', 'samples');
		const root = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri;
		let folder = vscode.Uri.joinPath(this.document.uri, '..');
		for (;;) {
			const candidate = vscode.Uri.joinPath(folder, name);
			try {
				const stat = await vscode.workspace.fs.stat(candidate);
				if (stat.type & vscode.FileType.Directory) return candidate;
			} catch {
				// Not here, look one folder up.
			}
			const parent = vscode.Uri.joinPath(folder, '..');
			if (!root || folder.toString() === root.toString() || parent.toString() === folder.toString()) return candidate;
			folder = parent;
		}
	}

	private async applyEdit(text: string): Promise<void> {
		const change = diffText(this.document.getText(), text);
		this.known = text;
		if (!change) return;
		const edit = new vscode.WorkspaceEdit();
		const range = new vscode.Range(this.document.positionAt(change.from), this.document.positionAt(change.to));
		edit.replace(this.document.uri, range, change.insert);
		await vscode.workspace.applyEdit(edit);
	}

	private html(): string {
		const webview = this.panel.webview;
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
		// What each relaxed rule is for:
		// - 'unsafe-eval': Strudel evaluates the user's code.
		// - data: in script-src: superdough loads its AudioWorklets from data: URLs.
		// - https://unpkg.com: upstream initHydra() imports hydra-synth from there at run time.
		// - 'unsafe-inline' styles: CodeMirror and the Strudel themes inject style elements.
		// - https: in connect-src: sample packs such as github:tidalcycles/dirt-samples.
		const csp = [
			`default-src 'none'`,
			`script-src ${webview.cspSource} https://unpkg.com data: blob: 'unsafe-eval'`,
			`worker-src ${webview.cspSource} data: blob:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`img-src ${webview.cspSource} https: data: blob:`,
			`media-src ${webview.cspSource} https: data: blob:`,
			`font-src ${webview.cspSource} https: data:`,
			`connect-src ${webview.cspSource} https: data: blob:`,
		].join('; ');
		return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	html, body { height: 100%; margin: 0; padding: 0; background: var(--background, #222); color: var(--foreground, #fff); }
	/* Above the fullscreen canvas that upstream getDrawContext() appends to the body. */
	#editor { position: relative; z-index: 1; min-height: 100%; }
	/* !important because StrudelMirror sets an inline display:block on its root. */
	body.stage #editor { display: none !important; }
	#dock { position: relative; z-index: 1; display: none; flex-direction: column; gap: 8px; padding: 8px; }
	body.stage #dock { display: flex; }
	#status { position: fixed; z-index: 3; right: 8px; bottom: 6px; font: 11px monospace; opacity: 0.6; pointer-events: none; }
	#unlock { position: fixed; z-index: 4; inset: 0; display: none; align-items: center; justify-content: center;
		background: rgba(0, 0, 0, 0.7); color: #fff; font: 16px sans-serif; cursor: pointer; }
	#unlock.visible { display: flex; }
</style>
</head>
<body>
<div id="editor"></div>
<div id="dock"></div>
<div id="status"></div>
<div id="unlock">Click to enable audio</div>
<script type="module" src="${script}"></script>
</body>
</html>`;
	}
}
