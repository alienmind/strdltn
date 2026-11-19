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
import * as strudelSoundfonts from '@strudel/soundfonts';
import * as strudelTonal from '@strudel/tonal';
import { getWidgetID, transpiler } from '@strudel/transpiler';
import * as strudelWebaudio from '@strudel/webaudio';
import { diffText, type FromWebview, type Mode, type SampleMap, type SoundInfo, type ToWebview } from '../shared/protocol';

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
/** What to do once the user has clicked the "enable audio" overlay. */
let afterUnlock: (() => unknown) | undefined;

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
		case 'samples':
			void loadLocalSamples(message.samples);
			break;
		case 'play':
			void play();
			break;
		case 'stop':
			mirror?.stop();
			break;
		case 'preview':
			void preview(message.name, message.index);
			break;
		case 'insert':
			insert(message.text);
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
					strudelSoundfonts,
				),
				strudelWebaudio.registerSynthSounds(),
				strudelWebaudio.registerZZFXSounds(),
				strudelSoundfonts.registerSoundfonts(),
			]);
			await loadLocalSamples(samples);
			log('info', `local samples: ${Object.keys(samples).join(', ') || 'none'}`);
			// The first play waits for the default packs, or "bd" is not found yet (measured
			// on a slow network). The wait is capped so that offline use still starts.
			await Promise.race([loadDefaultSounds(), new Promise((resolve) => setTimeout(resolve, 6000))]);
			publishSounds();
			strudelWebaudio.soundMap.listen(publishSoundsSoon);
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
		const action = afterUnlock;
		afterUnlock = undefined;
		if (action) void withAudio(action);
	});
	updateStatus();
}

/**
 * The sounds strudel.cc loads by default. The list is the one upstream publishes in
 * `@strudel/repl` (prebake.mjs, 1.3.0), with the tags the website adds so that drum
 * machines can be shown as their own group. A pack that fails to load is reported and
 * skipped: the rest still works.
 */
async function loadDefaultSounds(): Promise<void> {
	const doughSamples = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
	const todepond = 'https://raw.githubusercontent.com/todepond/samples/main';
	const uzuDrumkit = 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main';
	// One run on a slow network lost every pack and played without "bd" until the
	// window was closed. So each pack gets three tries, and a try that hangs is
	// given up after 15 seconds.
	const load = async (url: string, tag?: string) => {
		for (let attempt = 1; attempt <= 3; attempt++) {
			const outcome = await Promise.race([
				Promise.resolve(strudelWebaudio.samples(url, undefined, { prebake: true, tag })).then(
					() => 'loaded',
					(error: Error) => `failed: ${error?.message}`,
				),
				new Promise<string>((resolve) => setTimeout(() => resolve('no answer after 15 s'), 15000)),
			]);
			if (outcome === 'loaded') return;
			log('warn', `sound pack not loaded, try ${attempt} of 3: ${url} (${outcome})`);
			await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
		}
	};
	await Promise.all([
		load(`${doughSamples}/tidal-drum-machines.json`, 'drum-machines'),
		load(`${doughSamples}/piano.json`),
		load(`${doughSamples}/Dirt-Samples.json`),
		load(`${doughSamples}/vcsl.json`),
		load(`${doughSamples}/mridangam.json`),
		load(`${uzuDrumkit}/strudel.json`, 'drum-machines'),
	]);
	strudelWebaudio.aliasBank(`${todepond}/tidal-drum-machines-alias.json`);
}

/** Registers the samples of the workspace. Called again when the samples folder changes. */
async function loadLocalSamples(samples: SampleMap): Promise<void> {
	if (!Object.keys(samples).length) return;
	await strudelWebaudio.samples(samples, undefined, { prebake: false, tag: 'local' });
}

let publishTimer: ReturnType<typeof setTimeout> | undefined;
/** Loading a pack registers hundreds of sounds one by one. Send the list once it settles. */
function publishSoundsSoon(): void {
	clearTimeout(publishTimer);
	publishTimer = setTimeout(publishSounds, 300);
}

/** Sends the engine's sound list to the Sounds view. It is read from superdough, never hardcoded. */
function publishSounds(): void {
	const entries = Object.entries(strudelWebaudio.soundMap.get() as Record<string, { data?: any }>);
	const sounds: SoundInfo[] = entries
		.filter(([name]) => !name.startsWith('_'))
		.map(([name, { data = {} }]) => ({
			name,
			type: String(data.type ?? 'other'),
			tag: data.tag,
			// Only a plain list has numbered variations. A pitched map (piano) has one sound.
			count: Array.isArray(data.samples) ? data.samples.length : 1,
		}));
	post({ type: 'sounds', sounds });
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

function insert(text: string): void {
	if (!mirror) return;
	mirror.editor.dispatch(mirror.editor.state.replaceSelection(text));
	mirror.editor.focus();
}

/**
 * Runs `action` once audio may play. A request from VS Code (title bar button, a key in
 * the native editor, a click in the Sounds view) carries no click inside this page, and
 * a webview does not start its AudioContext without one (measured in VS Code 1.130). So
 * we try to resume, and fall back to an overlay that asks for one click.
 */
async function withAudio(action: () => unknown): Promise<void> {
	const context: AudioContext = strudelWebaudio.getAudioContext();
	await Promise.race([strudelWebaudio.initAudio(), new Promise((resolve) => setTimeout(resolve, 3000))]);
	if (context.state !== 'running') {
		// initAudio() does not resume the context by itself. resume() stays pending for
		// ever when the browser wants a user gesture first, hence the race.
		await Promise.race([context.resume().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1500))]);
	}
	if (context.state !== 'running') {
		log('warn', `AudioContext is "${context.state}" after a request from VS Code: a click inside the webview is needed`);
		afterUnlock = action;
		unlockElement.classList.add('visible');
		updateStatus();
		return;
	}
	await action();
}

function play(): Promise<void> {
	if (!mirror) return Promise.resolve();
	return withAudio(async () => {
		await mirror.evaluate();
		updateStatus();
		report();
	});
}

/** Plays one sound once, the way the sounds tab of strudel.cc does. */
function preview(name: string, index: number): Promise<void> {
	return withAudio(async () => {
		const data = (strudelWebaudio.soundMap.get() as Record<string, { data?: any }>)[name]?.data ?? {};
		// Synths, soundfonts and pitched sample maps need a note to make a sound.
		const pitched = data.type !== 'sample' || !Array.isArray(data.samples);
		const value = { s: name, n: index, clip: 1, release: 0.5, ...(pitched ? { note: 'a3' } : {}) };
		const context: AudioContext = strudelWebaudio.getAudioContext();
		await strudelWebaudio.superdough(value, context.currentTime + 0.05, 0.5);
		log('info', `preview: ${name}:${index}`);
	});
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

/** Records the platform facts (codecs, isolation, audio state) in the log. */
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
