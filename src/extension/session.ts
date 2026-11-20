import * as vscode from 'vscode';
import { diffText, type EditorSettings, type EngineState, type FromWebview, type Mode, type SoundInfo, type ToWebview } from '../shared/protocol';
import { findPackSources } from '../shared/packs';
import type { PackCache } from './packs';
import { findFirmwareUrls, type FirmwareCacheMap } from '../shared/firmware';
import { type FirmwareCache, scanFirmware } from './firmware';
import { scanSamples } from './samples';

/** What a session needs from the extension, and what it tells it. */
export interface SessionHost {
	output: vscode.OutputChannel;
	packs: PackCache;
	firmwareCache: FirmwareCache;
	/** Evaluation errors go here, so they show in the Problems view and as squiggles in the native editor. */
	diagnostics: vscode.DiagnosticCollection;
	onDispose(session: Session): void;
	onSounds(sounds: SoundInfo[]): void;
	/** The engine state, the error or the active tab changed. The status bar follows. */
	onState(session: Session): void;
}

/** The settings `strdltn.editor.*`. An empty font and a size of 0 mean: as the VS Code editor. */
export function editorSettings(): EditorSettings {
	const ours = vscode.workspace.getConfiguration('strdltn.editor');
	const editor = vscode.workspace.getConfiguration('editor');
	return {
		theme: ours.get('theme', 'strudelTheme'),
		fontFamily: ours.get('fontFamily', '') || editor.get('fontFamily', 'monospace'),
		fontSize: ours.get('fontSize', 0) || editor.get('fontSize', 14),
	};
}

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
	private playWhenReady = false;
	private readonly disposables: vscode.Disposable[] = [];
	/** False until the webview has its content. */
	ready = false;
	state: EngineState = { started: false, audio: 'suspended', needsClick: false };
	/** The error of the last evaluation. Kept until the next one, also after the squiggle is gone. */
	error: string | undefined;
	get started(): boolean {
		return this.state.started;
	}
	/** Everything the webview logged. Read by the integration test through the extension API. */
	readonly logs: string[] = [];
	/** When this session's tab was last the active one. Picks the target of a preview or insert. */
	lastActiveAt = Date.now();

	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly document: vscode.TextDocument,
		readonly panel: vscode.WebviewPanel,
		readonly mode: Mode,
		private readonly host: SessionHost,
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
				this.sendPacksSoon();
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				// The squiggle marks a place in the text that was evaluated. After an edit
				// it would mark something else. The status bar keeps the message.
				if (event.document === document && event.contentChanges.length) host.diagnostics.delete(document.uri);
			}),
			// A pack finished downloading: the webview can now play it from the cache.
			// The cache was emptied: the webview goes back to the network, and nothing
			// is downloaded again until the song is opened or edited.
			host.packs.onDidChange((what) => void this.sendPacks(what === 'cached')),
			host.firmwareCache.onDidChange(() => void this.sendFirmwareCache()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('strdltn.editor') && !event.affectsConfiguration('editor.fontFamily') && !event.affectsConfiguration('editor.fontSize')) return;
				this.post({ type: 'settings', settings: editorSettings() });
			}),
			panel.onDidChangeViewState(() => {
				if (panel.active) this.lastActiveAt = Date.now();
				host.onState(this);
			}),
		);
		panel.onDidDispose(() => {
			this.disposables.forEach((d) => d.dispose());
			clearTimeout(this.packsTimer);
			host.diagnostics.delete(document.uri);
			host.onDispose(this);
		});
	}

	preview(name: string, index: number): void {
		this.post({ type: 'preview', name, index });
	}

	/** Moves one slider of the stage, as a drag would: the sound changes and the number in the code follows. */
	setSlider(index: number, value: number): void {
		this.post({ type: 'slider', index, value });
	}

	/** Inserts at the cursor of the Strudel editor. The change comes back as a normal edit. */
	insert(text: string): void {
		this.post({ type: 'insert', text });
	}

	private packsTimer: ReturnType<typeof setTimeout> | undefined;
	/** After an edit, wait until the typing stops. A half typed `samples('github:...` is not a pack. */
	private sendPacksSoon(): void {
		clearTimeout(this.packsTimer);
		this.packsTimer = setTimeout(() => {
			void this.sendPacks();
			void this.sendFirmwareCache();
		}, 1500);
	}

	/**
	 * Tells the webview which remote packs the song loads, with the cached copy of the
	 * ones we have, and starts the download of the others. The webview registers them at
	 * once, so their sounds are in the Sounds view before the song has played.
	 */
	private async sendPacks(download = true): Promise<void> {
		const folder = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri;
		if (!this.ready || !folder) return;
		const sources = findPackSources(this.document.getText());
		const packs = await Promise.all(sources.map((source) => this.host.packs.info(source, folder, this.panel.webview)));
		this.post({ type: 'packs', packs });
		if (download) for (const pack of packs) if (!pack.cached) void this.host.packs.ensure(pack.source, folder);
	}

	/**
	 * Tells the webview which firmware addresses of the song are cached, with the URL of each copy, and starts the
	 * download of the others. The webview loads a cached one from the copy and the rest from the network.
	 */
	private async sendFirmwareCache(): Promise<void> {
		const folder = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri;
		if (!this.ready || !folder) return;
		const map: FirmwareCacheMap = {};
		for (const url of findFirmwareUrls(this.document.getText())) {
			const cached = await this.host.firmwareCache.cached(url, folder, this.panel.webview);
			if (cached) map[url] = cached;
			else void this.host.firmwareCache.ensure(url, folder);
		}
		this.post({ type: 'firmwareCache', map });
	}

	/** Scans the samples folder again, after files were added or removed. */
	async refreshSamples(): Promise<void> {
		if (!this.ready) return;
		this.post({ type: 'samples', samples: await scanSamples(await this.samplesFolder(), this.panel.webview) });
	}

	/** Scans the firmware folder again, after files were added or removed. */
	async refreshFirmware(): Promise<void> {
		if (!this.ready) return;
		this.post({ type: 'firmware', firmware: await scanFirmware(await this.firmwareFolder(), this.panel.webview) });
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
				const firmware = await scanFirmware(await this.firmwareFolder(), this.panel.webview);
				this.known = this.document.getText();
				this.post({ type: 'init', text: this.known, mode: this.mode, samples, firmware, settings: editorSettings() });
				this.ready = true;
				this.host.onState(this);
				void this.sendPacks();
				void this.sendFirmwareCache();
				if (this.playWhenReady) {
					this.playWhenReady = false;
					this.post({ type: 'play' });
				}
				break;
			}
			case 'edit':
				this.queue = this.queue.then(() => this.applyEdit(message.text));
				break;
			case 'state':
				this.state = message.state;
				this.host.onState(this);
				break;
			case 'evaluated':
				this.showError(message.error);
				break;
			case 'cacheFiles': {
				const folder = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri;
				const cached = folder && (await this.host.packs.files(message.base, message.files, folder));
				this.post({ type: 'cachedFiles', id: message.id, base: cached && `${this.panel.webview.asWebviewUri(cached).toString()}/` });
				break;
			}
			case 'sounds':
				this.host.onSounds(message.sounds);
				break;
			case 'log': {
				const line = `[${this.mode}] ${message.level}: ${message.message}`;
				this.logs.push(line);
				this.host.output.appendLine(line);
				break;
			}
		}
	}

	/**
	 * Shows the error of an evaluation as a problem of the document, or takes the old
	 * one away after a good evaluation. An error we could not place goes on the first
	 * line: the Problems view needs a line, and the message is what matters.
	 */
	private showError(error?: { message: string; from?: number; to?: number }): void {
		this.error = error?.message;
		if (!error) {
			this.host.diagnostics.delete(this.document.uri);
		} else {
			const placed = error.from !== undefined && error.to !== undefined && error.to <= this.document.getText().length;
			const range = placed
				? new vscode.Range(this.document.positionAt(error.from!), this.document.positionAt(error.to!))
				: this.document.lineAt(0).range;
			const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
			diagnostic.source = 'strdltn';
			this.host.diagnostics.set(this.document.uri, [diagnostic]);
		}
		this.host.onState(this);
	}

	/**
	 * The samples folder nearest to the file: beside it, or in a parent folder, up to
	 * the workspace root. A song in a subfolder of a bigger repo then still finds the
	 * samples that belong to it.
	 */
	private samplesFolder(): Promise<vscode.Uri> {
		return this.nearestFolder(vscode.workspace.getConfiguration('strdltn').get<string>('samplesFolder', 'samples'));
	}

	/** The firmware folder nearest to the file, found the same way as the samples. */
	private firmwareFolder(): Promise<vscode.Uri> {
		return this.nearestFolder(vscode.workspace.getConfiguration('strdltn').get<string>('firmwareFolder', 'firmware'));
	}

	private async nearestFolder(name: string): Promise<vscode.Uri> {
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
		this.sendPacksSoon();
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
	#dock { position: relative; z-index: 1; display: none; flex-direction: column; gap: 14px; padding: 10px 12px; font: 12px var(--vscode-font-family, sans-serif); }
	body.stage #dock { display: flex; }
	.dock-group h2 { margin: 0 0 6px; padding-bottom: 3px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
		opacity: .7; border-bottom: 1px solid rgba(128, 128, 128, .35); }
	/* A song may draw a full page visual behind the stage. The rows keep their own dark ground so they stay readable. */
	.dock-group { padding: 8px 10px; border-radius: 4px; background: rgba(0, 0, 0, .6); }
	.dock-row { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 10px; padding: 3px 0; }
	.dock-slot canvas { max-width: 100%; height: auto !important; }
	.dock-label { display: flex; flex-direction: column; min-width: 0; }
	.dock-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
	.dock-label small { opacity: .55; font-size: 10px; }
	.dock-slot { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
	.dock-slot input[type=range] { flex: 1; max-width: 320px; accent-color: var(--vscode-focusBorder, #3794ff); }
	.dock-slot output { width: 64px; font-family: var(--vscode-editor-font-family, monospace); opacity: .85; }
	#unlock { position: fixed; z-index: 4; inset: 0; display: none; align-items: center; justify-content: center;
		background: rgba(0, 0, 0, 0.7); color: #fff; font: 16px sans-serif; cursor: pointer; }
	#unlock.visible { display: flex; }
</style>
</head>
<body>
<div id="editor"></div>
<div id="dock"></div>
<div id="unlock">Click to enable audio</div>
<script type="module" src="${script}"></script>
</body>
</html>`;
	}
}
