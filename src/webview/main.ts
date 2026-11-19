// The webview: upstream StrudelMirror (editor, engine and visuals in one page) bound to
// a VS Code text document. We host upstream and add nothing to it, so that a new visual
// or widget in a later @strudel release arrives with a version bump.
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as strudelCodemirror from '@strudel/codemirror';
import * as strudelCore from '@strudel/core';
import * as strudelDraw from '@strudel/draw';
import * as strudelHydra from '@strudel/hydra';
import * as strudelMini from '@strudel/mini';
import * as strudelTonal from '@strudel/tonal';
import { getWidgetID, transpiler } from '@strudel/transpiler';
import * as strudelWebaudio from '@strudel/webaudio';
import { diffText, type FromWebview, type Mode, type SampleMap, type ToWebview } from '../shared/protocol';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const REPL_ID = 'vstrudel';
const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);
const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });

const statusElement = document.getElementById('status')!;
const unlockElement = document.getElementById('unlock')!;
const dockElement = document.getElementById('dock')!;

let mirror: any;
let mode: Mode = 'editor';
/** True while a change from the extension host is being applied, so it is not sent back. */
let applyingRemote = false;

window.addEventListener('error', (event) => log('error', `${event.message} (${event.filename}:${event.lineno})`));
window.addEventListener('unhandledrejection', (event) => log('error', `unhandled rejection: ${event.reason?.message ?? event.reason}`));
// Upstream reports everything (sample loading, eval errors) through this event.
document.addEventListener('strudel.log', (event) => {
	const { message, type } = (event as CustomEvent).detail ?? {};
	log(type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info', String(message));
});

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			init(message.text, message.mode, message.samples);
			break;
		case 'update':
			applyRemoteText(message.text);
			break;
		case 'play':
			void play();
			break;
		case 'stop':
			mirror?.stop();
			break;
	}
});

post({ type: 'ready' });

function init(text: string, initialMode: Mode, samples: SampleMap): void {
	mode = initialMode;
	document.body.classList.toggle('stage', mode === 'stage');
	reportEnvironment();

	mirror = new strudelCodemirror.StrudelMirror({
		id: REPL_ID,
		root: document.getElementById('editor'),
		initialCode: text,
		defaultOutput: strudelWebaudio.webaudioOutput,
		getTime: () => strudelWebaudio.getAudioContext().currentTime,
		transpiler,
		drawContext: strudelDraw.getDrawContext(),
		drawTime: [-2, 2],
		// We own the page background. With bgFill the editor would paint over the canvas.
		bgFill: false,
		prebake: async () => {
			strudelWebaudio.initAudioOnFirstClick();
			await Promise.all([
				strudelCore.evalScope(
					strudelCore,
					strudelDraw,
					strudelMini,
					strudelTonal,
					strudelWebaudio,
					strudelCodemirror,
					strudelHydra,
				),
				strudelWebaudio.registerSynthSounds(),
			]);
			// Not awaited, as on strudel.cc: a slow or offline network must not block local sounds.
			void strudelWebaudio.samples('github:tidalcycles/dirt-samples');
			if (Object.keys(samples).length) await strudelWebaudio.samples(samples);
			log('info', `local samples: ${Object.keys(samples).join(', ') || 'none'}`);
		},
		// StrudelMirror 1.3.0 calls this without arguments, so the code comes from the mirror.
		beforeEval: () => {
			if (mode === 'stage') prepareDock(mirror.code);
		},
		afterEval: ({ meta }: { meta: { widgets?: unknown[] } }) => {
			if (mode === 'stage') fillDock(meta?.widgets ?? []);
		},
		onToggle: (started: boolean) => {
			post({ type: 'started', started });
			updateStatus();
		},
		onEvalError: (error: Error) => log('error', `eval: ${error.message}`),
	});

	// Send every local change to the document. appendConfig because StrudelMirror
	// builds the editor state itself and takes no extra extensions.
	mirror.editor.dispatch({
		effects: StateEffect.appendConfig.of(
			EditorView.updateListener.of((update) => {
				if (update.docChanged && !applyingRemote) post({ type: 'edit', text: update.state.doc.toString() });
			}),
		),
	});

	unlockElement.addEventListener('click', () => {
		unlockElement.classList.remove('visible');
		void play();
	});
	updateStatus();
}

function applyRemoteText(text: string): void {
	if (!mirror) return;
	const change = diffText(mirror.editor.state.doc.toString(), text);
	if (!change) return;
	applyingRemote = true;
	try {
		mirror.editor.dispatch({ changes: change });
	} finally {
		applyingRemote = false;
	}
}

/**
 * Play asked for by a VS Code command (title bar button, keybinding in the native
 * editor). No click happened inside this page, so the browser may refuse to start the
 * AudioContext. We try, and fall back to an overlay that asks for one click.
 */
async function play(): Promise<void> {
	if (!mirror) return;
	const context: AudioContext = strudelWebaudio.getAudioContext();
	await Promise.race([strudelWebaudio.initAudio(), new Promise((resolve) => setTimeout(resolve, 1500))]);
	if (context.state !== 'running') {
		log('warn', `AudioContext is "${context.state}" after a command-triggered play: a click inside the webview is needed`);
		unlockElement.classList.add('visible');
		updateStatus();
		return;
	}
	await mirror.evaluate();
	updateStatus();
	report();
}

/** One line on what the page looks like after a play. The integration test reads it. */
function report(): void {
	const canvases = [...document.querySelectorAll('canvas')]
		.map((canvas) => `${canvas.id}@${canvas.parentElement?.id || canvas.parentElement?.className || canvas.parentElement?.tagName}`)
		.join(',');
	const context: AudioContext = strudelWebaudio.getAudioContext();
	log(
		'info',
		`report: audio=${context.state} started=${!!mirror.repl.scheduler.started} docLength=${mirror.code.length} canvases=${canvases}`,
	);
}

/**
 * Stage layout only. Inline widgets (`._scope()`, `._pianoroll()`) draw on a canvas they
 * look up by id and only create when it is missing. The editor is hidden in the stage,
 * so we create those canvases in the dock before the code runs, and upstream draws
 * on ours. The ids come from the same transpiler call upstream is about to make.
 */
function prepareDock(code: string): void {
	let widgets: any[] = [];
	try {
		widgets = transpiler(code, { id: REPL_ID }).widgets ?? [];
	} catch {
		// A syntax error is reported by the real evaluation that follows.
		return;
	}
	const wanted = new Set(widgets.filter((w) => w.type !== 'slider').map((w) => getWidgetID(w)));
	for (const child of [...dockElement.children]) if (!wanted.has(child.id)) child.remove();
	for (const id of wanted) {
		if (document.getElementById(id)) continue;
		const canvas = document.createElement('canvas');
		canvas.id = id;
		dockElement.appendChild(canvas);
	}
}

/**
 * By now StrudelMirror has given the widget canvases to CodeMirror, which moved them
 * into the hidden editor. Moving them back is not enough: CodeMirror restores its own
 * DOM. So we first clear its widget decorations, then put the canvases in the dock.
 */
function fillDock(widgets: any[]): void {
	const elements = widgets
		.filter((widget) => widget.type !== 'slider')
		.map((widget) => document.getElementById(getWidgetID(widget)))
		.filter((element) => element !== null);
	strudelCodemirror.updateWidgets(mirror.editor, []);
	for (const element of elements) dockElement.appendChild(element);
}

function updateStatus(): void {
	const context: AudioContext = strudelWebaudio.getAudioContext();
	statusElement.textContent = `${mode} | audio ${context.state} | ${mirror?.repl?.scheduler?.started ? 'playing' : 'stopped'}`;
}

/** Answers the codec and isolation questions of the M0 spike without anyone having to listen. */
function reportEnvironment(): void {
	const audio = document.createElement('audio');
	const codecs = {
		wav: 'audio/wav',
		mp3: 'audio/mpeg',
		ogg: 'audio/ogg; codecs="vorbis"',
		opus: 'audio/ogg; codecs="opus"',
		flac: 'audio/flac',
		aac: 'audio/mp4; codecs="mp4a.40.2"',
	};
	const support = Object.entries(codecs)
		.map(([name, type]) => `${name}=${audio.canPlayType(type) || 'no'}`)
		.join(' ');
	const context: AudioContext = strudelWebaudio.getAudioContext();
	log('info', `userAgent: ${navigator.userAgent}`);
	log('info', `codecs: ${support}`);
	log('info', `crossOriginIsolated=${crossOriginIsolated} audioWorklet=${'audioWorklet' in context} sampleRate=${context.sampleRate} state=${context.state}`);
	context.addEventListener('statechange', () => {
		log('info', `AudioContext state -> ${context.state}`);
		updateStatus();
	});
}
