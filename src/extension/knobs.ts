// Line actions (M = Mute, S = Solo, C = MIDI Capture) for the native VS Code text editor,
// plus host-side MIDI learn shared across both editors, the Mixer, and Ctrl+Alt+K.
// Uses the same `lineActionMap` and badge visuals as the Strudel editor so both views stay 1:1.
import * as vscode from 'vscode';
import { knobEdits, sliderAt, unmapKnobEdit } from '../shared/knob';
import { type LineAction, lineActionMap, lineActionStateKey, lineActionSvg } from '../shared/lineActions';
import { lf, lineColumn } from '../shared/sync';
import type { MidiBridge } from './midi';

const LEARN_MS = 10_000;

function commandUri(command: string, arg: unknown): string {
	return `command:${command}?${encodeURIComponent(JSON.stringify([arg]))}`;
}

function actionHover(uri: vscode.Uri, action: LineAction, learning: boolean): vscode.MarkdownString {
	const items: string[] = [];
	const uriStr = uri.toString();
	if (action.chain !== undefined) {
		const mLabel = action.muted ? '**M** Unmute' : '**M** Mute';
		const sLabel = action.solo ? '**S** Unsolo' : '**S** Solo';
		items.push(`[${mLabel}](${commandUri('strdltn.toggleChainLine', { uri: uriStr, chain: action.chain, button: 'mute' })} "${action.muted ? 'Unmute chain (M)' : 'Mute chain (M)'}")`);
		items.push(`[${sLabel}](${commandUri('strdltn.toggleChainLine', { uri: uriStr, chain: action.chain, button: 'solo' })} "${action.solo ? 'Unsolo chain (S)' : 'Solo chain (S)'}")`);
	}
	if (action.sliderFrom !== undefined) {
		if (learning) {
			items.push('**C** Listening... turn a knob on your MIDI controller');
		} else {
			const cLabel = action.cc === undefined ? '**C** MIDI Capture' : `**C** Unmap CC ${action.cc}`;
			const cTip =
				action.cc === undefined
					? 'MIDI Capture (C): click, then turn a knob on your MIDI controller to map this slider'
					: `MIDI Capture (CC ${action.cc}): mapped - click to unmap`;
			items.push(`[${cLabel}](${commandUri('strdltn.knobLearnAtLine', { uri: uriStr, from: action.sliderFrom, toggle: true })} "${cTip}")`);
		}
	}
	const md = new vscode.MarkdownString(items.join(' &nbsp;|&nbsp; '));
	md.isTrusted = { enabledCommands: ['strdltn.toggleChainLine', 'strdltn.knobLearnAtLine'] };
	return md;
}

export class KnobLearn implements vscode.Disposable {
	private message?: vscode.Disposable;
	private readonly disposables: vscode.Disposable[] = [];
	/** Cached M / S / C badge decoration types keyed by `lineActionStateKey`. */
	private readonly badgeTypes = new Map<string, vscode.TextEditorDecorationType>();
	/** The slider waiting for a CC, as its document and where its number starts. */
	private learning?: { document: vscode.TextDocument; from: number };
	private readonly learningChanged = new vscode.EventEmitter<{ document: vscode.TextDocument; from?: number }>();
	/**
	 * Which slider waits for a CC, and when it stops waiting (`from` undefined): its C badge
	 * turns red meanwhile, in both editors and the Mixer.
	 */
	readonly onLearning = this.learningChanged.event;

	constructor(
		private readonly midi: MidiBridge,
		private readonly output: vscode.OutputChannel,
		/** Evaluates the song again where it plays, so the new knob works at once. */
		private readonly evaluate: (document: vscode.TextDocument) => void,
		/** Toggles mute or solo on a chain label, shared with the Strudel editor. */
		private readonly toggleChain: (document: vscode.TextDocument, chain: number, button: 'mute' | 'solo') => Promise<void>,
	) {
		this.disposables.push(
			this.learningChanged,
			vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((e) => this.decorate(e))),
			vscode.workspace.onDidChangeTextDocument((event) => {
				for (const editor of vscode.window.visibleTextEditors) if (editor.document === event.document) this.decorate(editor);
			}),
			vscode.window.onDidChangeTextEditorSelection((event) => this.gutterClick(event)),
		);
		vscode.window.visibleTextEditors.forEach((e) => this.decorate(e));
	}

	private badgeType(key: string, action: LineAction | undefined, learning: boolean): vscode.TextEditorDecorationType {
		let type = this.badgeTypes.get(key);
		if (!type) {
			const svg = lineActionSvg(action, learning);
			const uri = vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`);
			type = vscode.window.createTextEditorDecorationType({
				before: {
					contentIconPath: uri,
					width: '49px',
					height: '15px',
					margin: '0 8px 0 0',
					textDecoration: 'none; vertical-align: middle;',
				},
			});
			this.badgeTypes.set(key, type);
		}
		return type;
	}

	private decorate(editor: vscode.TextEditor): void {
		if (!editor.document.uri.path.endsWith('.strudel')) return;
		const text = lf(editor.document.getText());
		const map = lineActionMap(text);
		if (map.size === 0) {
			for (const type of this.badgeTypes.values()) editor.setDecorations(type, []);
			return;
		}
		const waiting = this.learning?.document === editor.document ? lineColumn(text, this.learning.from).line : undefined;
		const buckets = new Map<string, { action: LineAction | undefined; learning: boolean; items: vscode.DecorationOptions[] }>();
		for (let line = 0; line < editor.document.lineCount; line++) {
			const action = map.get(line);
			const learning = action?.sliderFrom !== undefined && waiting === line;
			const key = lineActionStateKey(action, learning);
			let bucket = buckets.get(key);
			if (!bucket) {
				bucket = { action, learning, items: [] };
				buckets.set(key, bucket);
			}
			const range = new vscode.Range(line, 0, line, 0);
			bucket.items.push(action ? { range, hoverMessage: actionHover(editor.document.uri, action, learning) } : { range });
		}
		// Ensure every active state key has a decoration type, and clear any unused cached types.
		for (const [key, bucket] of buckets) this.badgeType(key, bucket.action, bucket.learning);
		for (const [key, type] of this.badgeTypes) editor.setDecorations(type, buckets.get(key)?.items ?? []);
	}

	/**
	 * VS Code reports no direct click on a line decoration. Clicking the line number or glyph
	 * margin selects the whole line with the mouse; on a slider line that starts/toggles MIDI
	 * Capture (C), matching the one-click workflow. M, S, and C are all clickable on hover and
	 * in the line-number context menu.
	 */
	private gutterClick(event: vscode.TextEditorSelectionChangeEvent): void {
		const { textEditor: editor, selections, kind } = event;
		if (kind !== vscode.TextEditorSelectionChangeKind.Mouse || selections.length !== 1 || !editor.document.uri.path.endsWith('.strudel')) return;
		const [selection] = selections;
		const wholeLine =
			selection.start.character === 0 &&
			((selection.end.line === selection.start.line + 1 && selection.end.character === 0) ||
				(selection.end.line === selection.start.line && selection.end.character === editor.document.lineAt(selection.start.line).text.length && selection.end.character > 0));
		if (!wholeLine) return;
		const line = selection.start.line;
		const action = lineActionMap(lf(editor.document.getText())).get(line);
		if (action?.sliderFrom === undefined) return;
		this.output.appendLine(`[knobs] native editor: line ${line + 1} selected whole by the mouse, taken as MIDI Capture (C)`);
		void this.learn(editor.document, action.sliderFrom, true);
	}

	/** Toggles mute or solo for the labeled chain starting on `line` (0-based). */
	async toggleChainAtLine(document: vscode.TextDocument, line: number, button: 'mute' | 'solo'): Promise<void> {
		const action = lineActionMap(lf(document.getText())).get(line);
		if (action?.chain === undefined) {
			return this.say('warning', `Line ${line + 1} is not the start of a labeled chain`);
		}
		await this.toggleChain(document, action.chain, button);
	}

	/** The first slider of a line. For the line number menu and the gutter. */
	async learnLine(document: vscode.TextDocument, line: number, toggle = false): Promise<void> {
		const action = lineActionMap(lf(document.getText())).get(line);
		return this.learn(document, action?.sliderFrom, toggle);
	}

	/** The slider whose call holds `offset` (an offset of the native editor, CRLF counted as two). */
	learnAtOffset(document: vscode.TextDocument, offset: number): Promise<void> {
		const text = document.getText();
		return this.learn(document, sliderAt(lf(text), lf(text.slice(0, offset)).length));
	}

	/**
	 * Waits for the next CC and writes `.knob(cc)` on the slider whose number starts at `from`
	 * (an offset of the text with `\n` line ends, as the pages and the Mixer count), plus the
	 * snippet the first time. With `toggle` (a click on a C button), a slider that has a
	 * knob loses it instead.
	 */
	async learn(document: vscode.TextDocument, from: number | undefined, toggle = false): Promise<void> {
		if (from === undefined) return this.say('warning', 'Put the cursor in a slider(...) call first');
		const unmap = toggle ? unmapKnobEdit(lf(document.getText()), from) : undefined;
		if (unmap) {
			await this.apply(document, lf(document.getText()), [unmap]);
			return this.say('check', 'Knob taken off the slider');
		}
		this.say('loading~spin', 'Move a knob on your MIDI controller (10 s)', LEARN_MS + 1000);
		this.setLearning({ document, from });
		const cc = await this.midi.captureCC(LEARN_MS).finally(() => this.setLearning(undefined));
		if (cc === 'noMidi') return this.say('warning', 'No MIDI here: knobs work on desktop VS Code only');
		if (cc === undefined) return this.say('warning', 'No knob moved: nothing mapped');
		const text = lf(document.getText());
		const edits = knobEdits(text, from, cc);
		if (!edits) return this.say('warning', 'The slider is gone from the code');
		if (!(await this.apply(document, text, edits))) return this.say('warning', 'The code could not be changed');
		this.say('check', `Knob on CC ${cc} mapped to the slider`);
	}

	/** Offsets of `text` (`\n` line ends), as one edit, then the song is evaluated again where it plays. */
	private async apply(document: vscode.TextDocument, text: string, edits: { from: number; to: number; insert: string }[]): Promise<boolean> {
		const edit = new vscode.WorkspaceEdit();
		for (const change of edits) {
			const a = lineColumn(text, change.from);
			const b = lineColumn(text, change.to);
			edit.replace(document.uri, new vscode.Range(a.line, a.character, b.line, b.character), change.insert);
		}
		if (!(await vscode.workspace.applyEdit(edit))) return false;
		this.evaluate(document);
		return true;
	}

	private setLearning(learning: { document: vscode.TextDocument; from: number } | undefined): void {
		const document = learning?.document ?? this.learning?.document;
		this.learning = learning;
		if (!document) return;
		this.learningChanged.fire({ document, from: learning?.from });
		for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) this.decorate(editor);
	}

	private say(icon: string, text: string, ms = 5000): void {
		this.output.appendLine(`[knobs] ${text}`);
		this.message?.dispose();
		this.message = vscode.window.setStatusBarMessage(`$(${icon}) strdltn: ${text}`, ms);
	}

	dispose(): void {
		this.message?.dispose();
		for (const type of this.badgeTypes.values()) type.dispose();
		this.badgeTypes.clear();
		this.disposables.forEach((d) => d.dispose());
	}
}
