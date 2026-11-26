import * as vscode from 'vscode';
import { DocumentWrites, lf, lineColumn, SyncHost, type SyncUpdate } from '../shared/sync';
import { type EditorAction, type EditorSettings, type EngineState, type FromWebview, type Mode, type ScopeFrame, type SoundInfo, type ToWebview } from '../shared/protocol';
import { findPackSources } from '../shared/packs';
import type { PackCache } from './packs';
import { findFirmwareUrls, type FirmwareCacheMap } from '../shared/firmware';
import { type FirmwareCache, scanFirmware } from './firmware';
import { scanSamples } from './samples';
import { isMidiMessage, type MidiBridge } from './midi';
import type { InsertArgument } from '../shared/context';
import type { DeviceInfo, DeviceRequest } from '../shared/devices';

/** What a session needs from the extension, and what it tells it. */
export interface SessionHost {
	output: vscode.OutputChannel;
	packs: PackCache;
	firmwareCache: FirmwareCache;
	midi: MidiBridge;
	/** Evaluation errors go here, so they show in the Problems view and as squiggles in the native editor. */
	diagnostics: vscode.DiagnosticCollection;
	onDispose(session: Session): void;
	onSounds(sounds: SoundInfo[]): void;
	/** The waves of the song's inline scopes, for the Mixer. */
	onScopes?(document: vscode.TextDocument, scopes: ScopeFrame[]): void;
	/** MIDI learn for a slider of the song, by where its number starts. */
	onKnobLearn?(document: vscode.TextDocument, from: number | undefined, toggle?: boolean): Promise<void>;
	/** A knob that waits for pickup moved, for the Mixer's dim handle. */
	onKnobGhost?(document: vscode.TextDocument, from: number, value: number | undefined): void;
	/** A slider of the song moved live, for the Mixer. */
	onSliderLive?(document: vscode.TextDocument, from: number, value: number): void;
	/** The engine state, the error or the active tab changed. The status bar follows. */
	onState(session: Session): void;
	/** The firmware copies this engine runs, for the Devices view. */
	onDevices?(session: Session, devices: DeviceInfo[]): void;
	/** A display frame of one of them. */
	onFrame?(session: Session, key: string, px: Uint8Array, values: number[]): void;
	/** A recording or a render came back: write it next to the song. */
	onAudio?(session: Session, kind: 'record' | 'render', wav: Uint8Array, info: { seconds: number; peak?: number }): Promise<void>;
	/** An item (from the Browser) or plain text was dropped onto the Strudel editor. */
	onDrop?(document: vscode.TextDocument, offset: number, info: { id?: string; index?: number; text?: string }): Promise<void>;
	/** Engine asks for the cached `fm1_web.wasm` file so it can emulate `.fwsc` firmwares. */
	onWantEmuWasm?(): Promise<vscode.Uri | undefined>;
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
	/** The version and the text (with `\n` line endings) both sides agree on. See src/shared/sync.ts. */
	private sync: SyncHost;
	/** Our writes into the document, which can lag behind `sync`. */
	private writes: DocumentWrites;
	/** True while a write is on its way into the document. */
	private writing = false;
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
	/** Record is on in this engine. */
	recording = false;
	/** A render of this song is being made. */
	rendering = false;
	/** Names this engine for the MIDI bridge. */
	private readonly midiId = Math.random().toString(36).slice(2);
	/** When this session's tab was last the active one. Picks the target of a preview or insert. */
	lastActiveAt = Date.now();

	constructor(
		private readonly context: vscode.ExtensionContext,
		readonly document: vscode.TextDocument,
		readonly panel: vscode.WebviewPanel,
		readonly mode: Mode,
		private readonly host: SessionHost,
	) {
		this.sync = new SyncHost(lf(document.getText()));
		this.writes = new DocumentWrites(this.sync.text);
		const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'dist'),
				vscode.Uri.joinPath(context.globalStorageUri, 'firmware'),
				vscode.Uri.joinPath(document.uri, '..'),
				...workspaceFolders,
			],
		};
		panel.webview.html = this.html();

		this.disposables.push(
			panel.webview.onDidReceiveMessage((message: FromWebview) => this.receive(message)),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document !== document) return;
				this.documentChanged(event);
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
			host.midi.forget(this.midiId);
			host.onDispose(this);
		});
	}

	/** A request of the Devices view for one of this engine's firmware copies. */
	device(request: DeviceRequest): void {
		this.post({ type: 'device', request });
	}

	preview(name: string, index: number): void {
		this.post({ type: 'preview', name, index });
	}

	/** Moves the slider whose number starts at `from`, as a drag would: the sound changes and the number in the code follows. */
	moveSlider(index: number, from: number | undefined, value: string): void {
		this.post({ type: 'sliderValue', index, from, value });
	}

	/** Puts the cursor of the Strudel editor at an offset and scrolls to it. */
	select(offset: number): void {
		this.post({ type: 'select', offset });
	}

	/** Which slider of this song waits for a CC, for the red knob button. */
	knobLearning(from: number | undefined): void {
		this.post({ type: 'knobLearning', from });
	}

	/** MIDI learn for the slider at the cursor of the Strudel editor. */
	knobLearn(): void {
		this.post({ type: 'knobLearn' });
	}

	/** A key of VS Code reached our command: CodeMirror runs the action. Logged for the keybinding spike. */
	editorAction(action: EditorAction): void {
		this.host.output.appendLine(`[keys] ${action}: the key reached VS Code, sent to the Strudel editor`);
		this.post({ type: 'editorAction', action });
	}

	/** Inserts at the cursor of the Strudel editor. The change comes back as a normal edit. */
	insert(text: string, bare?: string, argument?: InsertArgument): void {
		this.post({ type: 'insert', text, bare, argument });
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
		// Stop also ends a recording, as Live's Stop does: the take so far is kept.
		if (this.recording) this.record(false);
		this.post({ type: 'stop' });
	}

	/** Record on or off. On plays the song if it does not; off writes what was heard next to the song. */
	record(on = !this.recording): void {
		if (on === this.recording || this.rendering) return;
		this.recording = on;
		this.post({ type: 'record', on });
		this.host.onState(this);
	}

	/** Ends the notification of a render in progress. */
	private renderDone?: () => void;

	/**
	 * Renders the song: the engine plays it from the start with the speakers off and records it, so it takes as long
	 * as the song. A notification says so, and its Cancel stops the song, which ends the render without a file.
	 */
	render(cycles: number): void {
		if (this.rendering) return;
		if (this.recording) this.record(false);
		this.rendering = true;
		this.post({ type: 'render', cycles });
		this.host.onState(this);
		const name = this.document.uri.path.split('/').pop();
		void vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `strdltn: rendering ${name}. It plays once from the start, with the sound off, and takes as long as the song`, cancellable: true },
			(_progress, token) =>
				new Promise<void>((resolve) => {
					this.renderDone = resolve;
					token.onCancellationRequested(() => this.stop());
				}),
		);
	}

	private post(message: ToWebview): void {
		void this.panel.webview.postMessage(message);
	}

	private async receive(message: FromWebview): Promise<void> {
		if (isMidiMessage(message)) return this.host.midi.receive(this.midiId, (m) => this.post(m), message);
		switch (message.type) {
			case 'ready': {
				const samples = await scanSamples(await this.samplesFolder(), this.panel.webview);
				const firmware = await scanFirmware(await this.firmwareFolder(), this.panel.webview);
				this.sync = new SyncHost(lf(this.document.getText()), this.sync.version + 1);
				this.writes = new DocumentWrites(this.sync.text);
				this.post({ type: 'init', text: this.sync.text, version: this.sync.version, mode: this.mode, samples, firmware, settings: editorSettings() });
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
			case 'push':
				this.applyPush(message.version, message.updates);
				break;
			case 'state':
				this.state = message.state;
				this.host.onState(this);
				break;
			case 'evaluated':
				this.showError(message.error);
				break;
			case 'knobLearnAt':
				void this.host.onKnobLearn?.(this.document, message.from, message.toggle);
				break;
			case 'dropItem':
				void this.host.onDrop?.(this.document, message.offset, message);
				break;
			case 'wantEmuWasm':
				void this.host.onWantEmuWasm?.().then(
					(uri) => this.post({ type: 'emuWasm', url: uri ? this.panel.webview.asWebviewUri(uri).toString() : undefined }),
					() => this.post({ type: 'emuWasm', url: undefined }),
				);
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
			case 'scopes':
				this.host.onScopes?.(this.document, message.scopes);
				break;
			case 'sliderLive':
				this.host.onSliderLive?.(this.document, message.from, message.value);
				break;
			case 'knobGhost':
				this.host.onKnobGhost?.(this.document, message.from, message.value);
				break;
			case 'devices':
				this.host.onDevices?.(this, message.devices);
				break;
			case 'frame':
				this.host.onFrame?.(this, message.key, message.px, message.values);
				break;
			case 'audio':
				if (message.kind === 'render') {
					this.rendering = false;
					this.renderDone?.();
				}
				else this.recording = false;
				this.host.onState(this);
				await this.host.onAudio?.(this, message.kind, message.wav, { seconds: message.seconds, peak: message.peak });
				break;
			case 'audioError':
				if (message.kind === 'render') {
					this.rendering = false;
					this.renderDone?.();
				}
				else this.recording = false;
				this.host.onState(this);
				void vscode.window.showErrorMessage(`strdltn: ${message.kind === 'render' ? 'the render' : 'the recording'} failed: ${message.message}`);
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
				? (() => {
						// The offsets are in the webview's text with `\n` line endings. Line and column fit the document whatever its line endings.
						const text = lf(this.document.getText());
						const from = lineColumn(text, error.from!);
						const to = lineColumn(text, error.to!);
						return new vscode.Range(from.line, from.character, to.line, to.character);
					})()
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

	/**
	 * Changes typed in the webview. Taken when they start from the version the host is at;
	 * otherwise dropped, and the webview sends them again after it has received what it
	 * missed. Each one is confirmed to the webview at once and written into the document
	 * after, by line and column, so the file keeps its own line endings.
	 */
	private applyPush(version: number, updates: SyncUpdate[]): void {
		const accepted = this.sync.push(version, updates);
		if (!accepted?.length) return;
		this.post({ type: 'changes', updates: accepted.map((a) => a.update) });
		for (const { changes } of accepted) this.writes.add(changes);
		void this.write();
		this.sendPacksSoon();
	}

	/** Writes what is queued into the document, one write at a time. A refused write is queued again. */
	private async write(attempt = 0): Promise<void> {
		if (this.writing) return;
		const edits = this.writes.take();
		if (!edits) return;
		const edit = new vscode.WorkspaceEdit();
		for (const e of edits) edit.replace(this.document.uri, new vscode.Range(e.start.line, e.start.character, e.end.line, e.end.character), e.text);
		this.writing = true;
		const landed = await vscode.workspace.applyEdit(edit);
		this.writing = false;
		if (landed) return this.write();
		this.writes.failed();
		// Refused because the document moved in the meantime: its change has been taken in by now, so try again.
		if (attempt < 20) return this.write(attempt + 1);
		this.resync();
	}

	/** A change of the document. Our own writes come back here too, and are recognized. */
	private documentChanged(event: vscode.TextDocumentChangeEvent): void {
		const text = lf(this.document.getText());
		if (text === this.writes.document) return;
		const edits = event.contentChanges.map((c) => ({ start: c.range.start, end: c.range.end, text: c.text }));
		const outside = this.writes.changed(text, edits);
		if (outside) {
			this.post({ type: 'changes', updates: [this.sync.change(outside)] });
			this.sendPacksSoon();
		}
		void this.write();
	}

	/** The two sides could not be kept in step: the webview takes the document as it is. */
	private resync(): void {
		this.sync = new SyncHost(lf(this.document.getText()), this.sync.version + 1);
		this.writes = new DocumentWrites(this.sync.text);
		this.host.output.appendLine(`[${this.mode}] text sync started over at version ${this.sync.version}`);
		this.post({ type: 'reset', text: this.sync.text, version: this.sync.version });
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
	/* The canvases of ._scope() and ._pianoroll() are block widgets of CodeMirror. A canvas is
	   inline by default, so it sat on a line box a few pixels taller than itself, and
	   CodeMirror, which measures the canvas, did not count them: every widget above a line
	   moved the clicks there further down (measured in the integration test). */
	#editor .cm-content > canvas { display: block; }
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
	/* Line actions, left of the line numbers (main.ts, lineActions). */
	.strdltn-actions .cm-gutterElement { padding: 0 2px 0 4px; display: flex; align-items: center; }
	.strdltn-knob { display: inline-flex; cursor: pointer; color: var(--vscode-descriptionForeground, #8b949e); opacity: .6; --knob-fill: none; --knob-mark: currentColor; }
	.strdltn-knob:hover { opacity: 1; }
	.strdltn-knob.on { color: var(--vscode-charts-green, #3fb950); opacity: 1; --knob-fill: currentColor; --knob-mark: var(--vscode-editor-background, #1f2328); }
	.strdltn-knob.learning { color: var(--vscode-charts-red, #f85149); opacity: 1; --knob-fill: currentColor; --knob-mark: var(--vscode-editor-background, #1f2328); animation: strdltn-learn 1s ease-in-out infinite; }
	@keyframes strdltn-learn { 50% { opacity: .45; } }
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
