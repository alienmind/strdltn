import * as vscode from 'vscode';
import { duckEdits, type Edits, gainEdit, labelEdit, type MixerModel, readChains, scopeEdit, tempoEdit, unduckEdits } from '../shared/chains';
import type { ControlsState, FromControls } from '../shared/controls';
import type { FromMixer, ToMixer } from '../shared/mixer';
import type { ScopeFrame } from '../shared/protocol';
import { lf, lineColumn } from '../shared/sync';
import { setPage, type Surface } from './surface';

export interface MixerActions {
	/** Puts the cursor at an offset of a song, in whichever editor shows it. */
	reveal(document: vscode.TextDocument, offset: number): void;
	/**
	 * Gives a slider move to the engine that has the song open, which changes the sound
	 * and writes the number. False when no engine has it: then the Mixer writes the code.
	 */
	moveSlider(document: vscode.TextDocument, index: number, from: number | undefined, value: string): boolean;
	/** Evaluates the song again when it is playing, so a mute or solo is heard at once. */
	evaluate(document: vscode.TextDocument): void;
	/** Plays or stops the song, as the buttons of the editor's title do. */
	transport(document: vscode.TextDocument, action: 'play' | 'stop'): void;
	isPlaying(document: vscode.TextDocument): boolean;
	/** What Music Controls show changed. */
	controls(state: ControlsState): void;
}

/** How long a fader waits after its last move before it writes the code, when no engine has the song. As the stage's sliders did. */
const WRITE_PAUSE = 150;

/** A pause after typing before the model is read again. Long enough to skip a half typed word, short enough to feel live. */
const PAUSE = 300;

/**
 * The Mixer: a page in the bottom panel, or floating in a window of its own, with one strip per chain of the song in
 * front, its sliders as faders, and the sidechain cables. The host reads the model from
 * the text with `readChains`; the webview draws it. See "Mixer panel" in doc/DAW-PLAN.md.
 *
 * The song in front is the `.strudel` file of the active tab, in either editor. When the
 * focus goes to something else (the Mixer itself, a terminal, a stage) the Mixer keeps the
 * last song, the way the Outline view does.
 */
export class MixerView implements Surface {
	/** The Mixer's page, docked or floating. */
	private webview?: vscode.Webview;
	private document?: vscode.TextDocument;
	private model?: MixerModel;
	private error?: string;
	private timer?: ReturnType<typeof setTimeout>;
	private lastState?: Extract<FromMixer, { type: 'state' }>;
	/** The strips the page last reported unfolded, kept here so a new page shows the same. */
	private unfolded?: string[];
	/** Scope frames passed on, and how many scopes the last one had. For the integration test. */
	private scopeFrames = 0;
	private lastScopes = 0;
	/** How many pages have said `ready`. A move between dock and float that keeps its page does not count up. */
	pages = 0;

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

	/** Gives the Mixer a page, docked or floating (see `Place`). It sends the model at once and again on `ready`. */
	attach(webview: vscode.Webview): vscode.Disposable {
		this.webview = webview;
		setPage(this.context, webview, 'mixer');
		const listener = webview.onDidReceiveMessage((message: FromMixer) => this.handle(message));
		return new vscode.Disposable(() => {
			listener.dispose();
			if (this.webview === webview) this.webview = undefined;
		});
	}

	/** The model of the song in front, as the parser read it last. For the integration test. */
	current(): { song?: string; model?: MixerModel; error?: string; state?: Extract<FromMixer, { type: 'state' }>; pages: number; scopeFrames: number; lastScopes: number } {
		return { song: this.document && vscode.workspace.asRelativePath(this.document.uri), model: this.model, error: this.error, state: this.lastState, pages: this.pages, scopeFrames: this.scopeFrames, lastScopes: this.lastScopes };
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

	/**
	 * Music Controls, at the top of the Library view, act on the song the Mixer shows: its
	 * Play, Stop and BPM come here (from the Browser's host) and its state goes back through
	 * `actions.controls`.
	 */
	control(message: FromControls): void {
		if (message.type === 'tempo') return void this.setTempo(message.bpm);
		if (this.document) this.actions.transport(this.document, message.action);
	}

	/** What Music Controls show. Sent on every change of the song, its model or its playing. */
	private sendControls(): void {
		const song = this.document?.uri.path.split('/').pop();
		this.actions.controls({ song, known: !!this.model, tempo: this.model?.tempo && { bpm: this.model.tempo.bpm }, playing: this.playing });
	}

	private handle(message: FromMixer): void {
		switch (message.type) {
			case 'ready':
				this.pages++;
				this.send();
				this.post({ type: 'playing', on: this.playing });
				// A page made by a move between dock and float starts with every strip folded.
				if (this.unfolded) this.post({ type: 'show', unfold: this.unfolded });
				return;
			case 'reveal': {
				const chain = this.model?.chains[message.chain];
				if (chain && this.document) this.actions.reveal(this.document, chain.from);
				return;
			}
			case 'slider':
				return this.moveSlider(message.index, message.value);
			case 'toggle':
				return void this.toggle(message.chain, message.button);
			case 'duck':
			case 'unduck':
				return void this.handleAsync(message);
			case 'state':
				this.lastState = message;
				if (message.strips.length) this.unfolded = message.strips.filter((strip) => strip.unfolded).map((strip) => strip.name);
				return;
			case 'log':
				this.output.appendLine(`mixer: ${message.message}`);
				return;
		}
	}

	/**
	 * A fader moved. Its place in the code is read from the text as it is now, not from the
	 * model, which can be 300 ms old. The index of a slider does not change while only its
	 * number does, so it finds the same slider.
	 *
	 * Half typed code does not parse (a lone `/` while `//` is typed). Then the engine finds
	 * the slider by its index alone: it follows its sliders through every edit since the
	 * last evaluation. Seen in the integration test: the move was dropped before this.
	 */
	moveSlider(index: number, value: string): void {
		const document = this.document;
		if (!document) return;
		const now = readChains(lf(document.getText()));
		const slider = 'error' in now ? undefined : now.sliders[index];
		if (this.actions.moveSlider(document, index, slider?.from, value)) return;
		if (!slider) return;
		clearTimeout(this.writeTimer);
		this.writeTimer = setTimeout(() => {
			const text = lf(document.getText());
			const fresh = readChains(text);
			const target = 'error' in fresh ? undefined : fresh.sliders[index];
			if (!target || text.slice(target.from, target.to) === value) return;
			const from = lineColumn(text, target.from);
			const to = lineColumn(text, target.to);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, new vscode.Range(from.line, from.character, to.line, to.character), value);
			void vscode.workspace.applyEdit(edit);
		}, WRITE_PAUSE);
	}
	private writeTimer?: ReturnType<typeof setTimeout>;

	/**
	 * M or S clicked: the label of the chain gets or loses `_` or `S` (decision 5 of
	 * doc/DAW-PLAN.md). G clicked: the chain gets or loses its `.gain(slider(...))`. Read from the text as it is now, written into the document, which
	 * the editor follows like any edit from outside. A song that plays is evaluated again
	 * at once, as Live mutes at once.
	 */
	async toggle(chain: number, button: 'mute' | 'solo' | 'gain' | 'scope'): Promise<void> {
		const document = this.document;
		if (!document) return;
		const text = lf(document.getText());
		await this.write(document, text, button === 'gain' ? gainEdit(text, chain) : button === 'scope' ? scopeEdit(text, chain) : labelEdit(text, chain, button));
	}

	/** Puts the cursor of the editor on a chain, as a click on its name does. For the integration test. */
	revealChain(chain: number): void {
		const target = this.model?.chains[chain];
		if (target && this.document) this.actions.reveal(this.document, target.from);
	}

	/** A cable dropped (`to`) or pulled off onto nothing (`orbit`), as the page sends it. For the integration test. */
	async cable(from: number, drop: { to: number; move?: number } | { orbit: number }): Promise<void> {
		await this.handleAsync('to' in drop ? { type: 'duck', from, to: drop.to, move: drop.move } : { type: 'unduck', from, orbit: drop.orbit });
	}

	/** The BPM box: `setcpm(<bpm>/4)` written, or taken out for Strudel's default. Heard at once when playing. */
	async setTempo(bpm: number | undefined): Promise<void> {
		const document = this.document;
		if (!document) return;
		const text = lf(document.getText());
		await this.write(document, text, tempoEdit(text, bpm));
	}

	/** The waves of the scopes of a song, passed on when it is the song the Mixer shows. */
	setScopes(document: vscode.TextDocument, scopes: ScopeFrame[]): void {
		if (document !== this.document) return;
		this.scopeFrames++;
		this.lastScopes = scopes.length;
		this.post({ type: 'scopes', scopes });
	}

	/** Says whether a song plays. The Play and Stop buttons show it when it is the song in front. */
	setPlaying(document: vscode.TextDocument, on: boolean): void {
		if (document !== this.document) return;
		this.playing = on;
		this.post({ type: 'playing', on });
		this.sendControls();
	}
	private playing = false;

	private async handleAsync(message: Extract<FromMixer, { type: 'duck' | 'unduck' }>): Promise<void> {
		const document = this.document;
		if (!document) return;
		const text = lf(document.getText());
		const result = message.type === 'duck' ? duckEdits(text, message.from, message.to, message.move) : unduckEdits(text, message.from, message.orbit);
		await this.writeAll(document, text, result);
	}

	/** One edit of the song, by line and column of its `\n` text, then evaluated if it plays. */
	private async write(document: vscode.TextDocument, text: string, change: { from: number; to: number; insert: string } | undefined): Promise<void> {
		if (change) await this.writeAll(document, text, { edits: [change] });
	}

	/**
	 * Several edits as one, so one undo takes back a cable with the orbit it gave its target.
	 * All offsets are of `text`, as it was read. A refused cable says why in the status bar.
	 */
	private async writeAll(document: vscode.TextDocument, text: string, result: Edits): Promise<void> {
		if ('refused' in result) return void vscode.window.setStatusBarMessage(`strdltn: ${result.refused}`, 5000);
		if (!result.edits.length) return;
		const edit = new vscode.WorkspaceEdit();
		for (const change of result.edits) {
			const from = lineColumn(text, change.from);
			const to = lineColumn(text, change.to);
			edit.replace(document.uri, new vscode.Range(from.line, from.character, to.line, to.character), change.insert);
		}
		if (await vscode.workspace.applyEdit(edit)) this.actions.evaluate(document);
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
		this.playing = this.actions.isPlaying(document);
		this.post({ type: 'playing', on: this.playing });
		this.read();
	}

	private read(): void {
		if (!this.document) return;
		// Read with `\n` line endings, as the editors' offsets are, whatever the file has.
		const result = readChains(lf(this.document.getText()));
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
		this.sendControls();
	}

	private post(message: ToMixer): void {
		void this.webview?.postMessage(message);
	}
}
