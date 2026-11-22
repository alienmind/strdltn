// MIDI learn for sliders on knobs, in the extension host: it owns the MIDI ports, so learn
// works the same from every place that asks (the knob button left of a line in either
// editor, a fader of the Mixer, Ctrl+Alt+K), with a song playing or not. The rules are in
// src/shared/knob.ts; the page moves the sliders. See "Sliders on knobs" in ARCHITECTURE.
import * as vscode from 'vscode';
import { knobEdits, sliderAt } from '../shared/knob';
import { lf, lineColumn } from '../shared/sync';
import type { MidiBridge } from './midi';

const LEARN_MS = 10_000;

/** Lines that hold a slider, and the CC of a knob already on it. Line text only: cheap enough for every edit. */
export function sliderLines(text: string): { line: number; cc?: number }[] {
	const lines: { line: number; cc?: number }[] = [];
	text.split('\n').forEach((content, line) => {
		if (!/\bslider\s*\(/.test(content)) return;
		const cc = /\.knob\(\s*(\d+)\s*\)/.exec(content)?.[1];
		lines.push({ line, cc: cc === undefined ? undefined : Number(cc) });
	});
	return lines;
}

export class KnobLearn implements vscode.Disposable {
	private message?: vscode.Disposable;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly icon: vscode.TextEditorDecorationType;
	private readonly iconOn: vscode.TextEditorDecorationType;

	constructor(
		context: vscode.ExtensionContext,
		private readonly midi: MidiBridge,
		private readonly output: vscode.OutputChannel,
		/** Evaluates the song again where it plays, so the new knob works at once. */
		private readonly evaluate: (document: vscode.TextDocument) => void,
	) {
		// The native editor: an icon in the glyph margin, left of the line numbers, on every
		// line with a slider. Filled when a knob is on it.
		const icon = (file: string) =>
			vscode.window.createTextEditorDecorationType({ gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', file), gutterIconSize: 'contain' });
		this.icon = icon('knob.svg');
		this.iconOn = icon('knob-on.svg');
		this.disposables.push(
			this.icon,
			this.iconOn,
			vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((e) => this.decorate(e))),
			vscode.workspace.onDidChangeTextDocument((event) => {
				for (const editor of vscode.window.visibleTextEditors) if (editor.document === event.document) this.decorate(editor);
			}),
			vscode.window.onDidChangeTextEditorSelection((event) => this.gutterClick(event)),
		);
		vscode.window.visibleTextEditors.forEach((e) => this.decorate(e));
	}

	private decorate(editor: vscode.TextEditor): void {
		if (!editor.document.uri.path.endsWith('.strudel')) return;
		const lines = sliderLines(lf(editor.document.getText()));
		const range = (line: number) => new vscode.Range(line, 0, line, 0);
		editor.setDecorations(this.icon, lines.filter((l) => l.cc === undefined).map((l) => ({ range: range(l.line), hoverMessage: 'Knob: click left of the line number, then turn a knob' })));
		editor.setDecorations(this.iconOn, lines.filter((l) => l.cc !== undefined).map((l) => ({ range: range(l.line), hoverMessage: `Knob on CC ${l.cc}` })));
	}

	/**
	 * VS Code reports no click on a gutter icon. A click in the glyph margin or on a line
	 * number selects the whole line with the mouse, which this sees. Spike: whether a click
	 * on the icon does that, and whether it can be told from a click on the number. Logged.
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
		if (!sliderLines(lf(editor.document.getText())).some((l) => l.line === line)) return;
		this.output.appendLine(`[knobs] native editor: line ${line + 1} selected whole by the mouse, taken as a click on its knob`);
		void this.learnLine(editor.document, line);
	}

	/** The first slider of a line. For the line number menu and the gutter. */
	async learnLine(document: vscode.TextDocument, line: number): Promise<void> {
		const text = lf(document.getText());
		const start = text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0);
		const at = /\bslider\s*\(/.exec(text.slice(start).split('\n')[0]);
		return this.learn(document, at ? sliderAt(text, start + at.index + at[0].length) : undefined);
	}

	/** The slider whose call holds `offset` (an offset of the native editor, CRLF counted as two). */
	learnAtOffset(document: vscode.TextDocument, offset: number): Promise<void> {
		const text = document.getText();
		return this.learn(document, sliderAt(lf(text), lf(text.slice(0, offset)).length));
	}

	/**
	 * Waits for the next CC and writes `.knob(cc)` on the slider whose number starts at `from`
	 * (an offset of the text with `\n` line ends, as the pages and the Mixer count), plus the
	 * snippet the first time.
	 */
	async learn(document: vscode.TextDocument, from: number | undefined): Promise<void> {
		if (from === undefined) return this.say('warning', 'Put the cursor in a slider(...) call first');
		this.say('loading~spin', 'Move a knob on your MIDI controller (10 s)', LEARN_MS + 1000);
		const cc = await this.midi.captureCC(LEARN_MS);
		if (cc === 'noMidi') return this.say('warning', 'No MIDI here: knobs work on desktop VS Code only');
		if (cc === undefined) return this.say('warning', 'No knob moved: nothing mapped');
		const text = lf(document.getText());
		const edits = knobEdits(text, from, cc);
		if (!edits) return this.say('warning', 'The slider is gone from the code');
		const edit = new vscode.WorkspaceEdit();
		for (const change of edits) {
			const a = lineColumn(text, change.from);
			const b = lineColumn(text, change.to);
			edit.replace(document.uri, new vscode.Range(a.line, a.character, b.line, b.character), change.insert);
		}
		if (!(await vscode.workspace.applyEdit(edit))) return this.say('warning', 'The code could not be changed');
		this.evaluate(document);
		this.say('check', `Knob on CC ${cc} mapped to the slider`);
	}

	private say(icon: string, text: string, ms = 5000): void {
		this.output.appendLine(`[knobs] ${text}`);
		this.message?.dispose();
		this.message = vscode.window.setStatusBarMessage(`$(${icon}) strdltn: ${text}`, ms);
	}

	dispose(): void {
		this.message?.dispose();
		this.disposables.forEach((d) => d.dispose());
	}
}
