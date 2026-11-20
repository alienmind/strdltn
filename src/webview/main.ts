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
import { sliderLabel, visualLabel } from '../shared/context';
import { githubBase, type PackInfo } from '../shared/packs';
import { diffText, type FirmwareInfo, type FromWebview, type Mode, type SampleMap, type SoundInfo, type ToWebview } from '../shared/protocol';
import { addFirmware, initFirmware, registerFirmware, transport } from './vibe';

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
			init(message.text, message.mode, message.samples, message.firmware);
			break;
		case 'update':
			applyRemoteText(message.text);
			break;
		case 'firmware':
			registerFirmware(message.firmware);
			break;
		case 'samples':
			void loadLocalSamples(message.samples);
			break;
		case 'packs':
			void loadPacks(message.packs);
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
		case 'slider':
			if (stageSliders[message.index]) moveSlider(stageSliders[message.index], String(message.value));
			break;
	}
});

post({ type: 'ready' });

function init(text: string, initialMode: Mode, samples: SampleMap, firmware: FirmwareInfo[]): void {
	mode = initialMode;
	document.body.classList.toggle('stage', mode === 'stage');
	reportEnvironment();

	initFirmware({
		log,
		clock: () => {
			const scheduler = mirror?.repl?.scheduler;
			return { cycle: scheduler?.started ? scheduler.now() : 0, cps: scheduler?.cps ?? 0.5, playing: !!scheduler?.started };
		},
	});

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
					// Last, so that it replaces the `samples` of @strudel/webaudio in the song's scope.
					// `firmware` is ours: VIBE FM firmwares from an address, for `vibefm1`.
					{ samples: taggedSamples, firmware: addFirmware },
				),
				strudelWebaudio.registerSynthSounds(),
				strudelWebaudio.registerZZFXSounds(),
				strudelSoundfonts.registerSoundfonts(),
			]);
			strudelWebaudio.registerSamplesPrefix('github:', resolveGithubPack);
			await loadLocalSamples(samples);
			registerFirmware(firmware);
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
			transport(started);
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
				if (!update.docChanged) return;
				mapStageSliders(update.changes);
				if (!applyingRemote) post({ type: 'edit', text: update.state.doc.toString() });
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

/** The packs the extension host has in its cache: name in the song -> sample map and folder URL. */
const cachedPacks = new Map<string, { map: Record<string, unknown>; base: string }>();
/** What was already registered, so that a repeated message does not load a pack again. */
const registeredPacks = new Set<string>();

/**
 * `samples()` as the song sees it. A pack loaded by name gets that name as its tag, and
 * the Sounds view makes a group of it. Nothing else changes.
 */
function taggedSamples(map: unknown, base?: string, options: Record<string, unknown> = {}): Promise<void> {
	return strudelWebaudio.samples(map, base, typeof map === 'string' ? { tag: map, ...options } : options);
}

/**
 * Upstream asks this for the map of every `github:` pack (registerSamplesPrefix). A
 * cached pack is answered from the workspace. Any other is fetched the way upstream
 * does it.
 */
async function resolveGithubPack(source: string): Promise<[Record<string, unknown>, string]> {
	const cached = cachedPacks.get(source);
	if (cached) return [structuredClone(cached.map), cached.base];
	const base = githubBase(source);
	const map = await fetch(`${base}strudel.json`).then((response) => response.json());
	return [map, map._base || base];
}

/**
 * The remote packs of the open song, from the extension host. They are registered right
 * away, so their sounds can be browsed before the song has played. When a pack arrives
 * in the cache it is registered again, and from then on it plays from the workspace.
 */
async function loadPacks(packs: PackInfo[]): Promise<void> {
	await mirror?.prebaked;
	for (const pack of packs) {
		if (pack.cached) cachedPacks.set(pack.source, pack.cached);
		const key = `${pack.source}${pack.cached ? ' (cached)' : ''}`;
		if (registeredPacks.has(key)) continue;
		registeredPacks.add(key);
		try {
			await taggedSamples(pack.source);
			log('info', `pack ${key}: registered`);
		} catch (error) {
			registeredPacks.delete(key);
			log('warn', `pack ${pack.source} not loaded: ${(error as Error)?.message}`);
		}
	}
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
			count: Array.isArray(data.variations) ? data.variations.length : Array.isArray(data.samples) ? data.samples.length : 1,
			variations: Array.isArray(data.variations) ? data.variations : undefined,
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
	if (mode === 'stage') log('info', `dock: ${describeDock()}`);
}

// ---- the stage ------------------------------------------------------------------------
//
// In the stage the code is hidden, so everything the code would show inline is laid out
// here instead, in two groups: the sliders, then the visuals. Each row has a label on
// the left that says which part of the song it belongs to. The labels come from the
// rules in src/shared/context.ts.

interface StageSlider {
	/** The id upstream gives the slider: `slider_<position at evaluation>`. Its value lives under this id. */
	id: string;
	/** Where the number is in the document now. Kept up to date as the text changes. */
	from: number;
	to: number;
	input: HTMLInputElement;
	output: HTMLElement;
	writeTimer?: ReturnType<typeof setTimeout>;
}
let stageSliders: StageSlider[] = [];

function dockGroup(title: string): HTMLElement {
	const group = document.createElement('section');
	group.className = 'dock-group';
	group.appendChild(document.createElement('h2')).textContent = title;
	return group;
}

function dockRow(label: { text: string; rule: string }, kind: string): { row: HTMLElement; slot: HTMLElement } {
	const row = document.createElement('div');
	row.className = 'dock-row';
	const name = row.appendChild(document.createElement('div'));
	name.className = 'dock-label';
	name.title = `${label.text}\n(${kind}, named from: ${label.rule})`;
	name.appendChild(document.createElement('span')).textContent = label.text;
	name.appendChild(document.createElement('small')).textContent = kind;
	const slot = row.appendChild(document.createElement('div'));
	slot.className = 'dock-slot';
	return { row, slot };
}

/**
 * Builds the stage before the code runs. Inline widgets (`._scope()`, `._pianoroll()`)
 * draw on a canvas they look up by id and only create when it is missing, so we put
 * those canvases in place first and upstream draws on ours. The ids and the positions
 * come from the same transpiler call upstream is about to make.
 */
function prepareDock(code: string): void {
	let widgets: any[] = [];
	try {
		widgets = transpiler(code, { id: REPL_ID }).widgets ?? [];
	} catch {
		// A syntax error is reported by the real evaluation that follows.
		return;
	}
	// Keep the canvases that are already there. A new canvas would flash on every update.
	const canvases = new Map<string, HTMLElement>();
	for (const canvas of dockElement.querySelectorAll('canvas')) canvases.set(canvas.id, canvas);
	stageSliders.forEach((slider) => clearTimeout(slider.writeTimer));
	stageSliders = [];
	dockElement.replaceChildren();

	const sliders = widgets.filter((widget) => widget.type === 'slider');
	if (sliders.length) {
		const group = dockElement.appendChild(dockGroup('Sliders'));
		for (const widget of sliders) group.appendChild(sliderRow(code, widget));
	}
	const visuals = widgets.filter((widget) => widget.type !== 'slider');
	if (visuals.length) {
		const group = dockElement.appendChild(dockGroup('Visuals'));
		for (const widget of visuals) {
			const id = getWidgetID(widget);
			const { row, slot } = dockRow(visualLabel(code, widget.to), String(widget.type).replace(/^_/, ''));
			slot.dataset.widget = id;
			const canvas = canvases.get(id) ?? Object.assign(document.createElement('canvas'), { id });
			slot.appendChild(canvas);
			group.appendChild(row);
		}
	}
}

function sliderRow(code: string, widget: any): HTMLElement {
	const { row, slot } = dockRow(sliderLabel(code, widget.from), 'slider');
	const input = slot.appendChild(document.createElement('input'));
	input.type = 'range';
	input.min = String(widget.min);
	input.max = String(widget.max);
	input.step = String(widget.step ?? (widget.max - widget.min) / 1000);
	input.value = String(widget.value);
	const output = slot.appendChild(document.createElement('output'));
	output.textContent = String(widget.value);
	const slider: StageSlider = { id: `slider_${widget.from}`, from: widget.from, to: widget.to, input, output };
	stageSliders.push(slider);
	input.addEventListener('input', () => moveSlider(slider, input.value));
	return row;
}

/**
 * A slider moved. Two things follow, as in the Strudel editor: the sound changes at
 * once, and the number in the code becomes the new value.
 *
 * The sound: upstream keeps slider values by id and listens for this window message.
 * The code: we change the text of the hidden editor, and the change travels to the VS
 * Code document like any other edit. That is throttled, because a drag fires an event
 * per pixel and each one would be an edit in the document.
 */
function moveSlider(slider: StageSlider, value: string): void {
	slider.input.value = value;
	slider.output.textContent = value;
	window.postMessage({ type: 'cm-slider', value: Number(value), id: slider.id }, '*');
	clearTimeout(slider.writeTimer);
	slider.writeTimer = setTimeout(() => {
		mirror.editor.dispatch({ changes: { from: slider.from, to: slider.to, insert: value } });
		// The update listener has moved every position by now, this one to the end of the new number.
	}, 150);
}

/** Follows the text. Called for every change of the document, ours or anyone's. */
function mapStageSliders(changes: { mapPos(position: number, assoc?: number): number }): void {
	for (const slider of stageSliders) {
		slider.from = changes.mapPos(slider.from, -1);
		slider.to = changes.mapPos(slider.to, 1);
	}
}

/**
 * After the code ran. By now StrudelMirror has given the widget canvases to CodeMirror,
 * which moved them into the hidden editor. Moving them back is not enough: CodeMirror
 * restores its own DOM. So we first clear its widget decorations, then put each canvas
 * back in its row.
 */
function fillDock(widgets: any[]): void {
	const placed = widgets
		.filter((widget) => widget.type !== 'slider')
		.map((widget) => getWidgetID(widget))
		.map((id) => ({ canvas: document.getElementById(id), slot: dockElement.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`) }));
	strudelCodemirror.updateWidgets(mirror.editor, []);
	for (const { canvas, slot } of placed) if (canvas && slot) slot.appendChild(canvas);
}

/** What the stage shows, for the report line: `Sliders: a(slider)|b(slider) ; Visuals: c(scope)`. */
function describeDock(): string {
	return [...dockElement.querySelectorAll('.dock-group')]
		.map((group) => {
			const rows = [...group.querySelectorAll('.dock-label')].map(
				(label) => `${label.querySelector('span')?.textContent}(${label.querySelector('small')?.textContent})`,
			);
			return `${group.querySelector('h2')?.textContent}: ${rows.join('|')}`;
		})
		.join(' ; ');
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
	void probe('midi', async () => {
		const access = await (navigator as any).requestMIDIAccess();
		return `outputs=[${[...access.outputs.values()].map((port: any) => port.name).join(', ')}] inputs=[${[...access.inputs.values()].map((port: any) => port.name).join(', ')}]`;
	});
	// Which sound cards can the engine send its sound to? Labels are empty until the
	// page may use a microphone, so the count is the first thing to look at.
	void probe('audio outputs', async () => {
		const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
		return `${devices.length} [${devices.map((device) => device.label || '(no label)').join(', ')}] setSinkId=${'setSinkId' in AudioContext.prototype}`;
	});
	void probe('webgpu', async () => {
		const adapter = await (navigator as any).gpu.requestAdapter();
		return adapter ? `adapter ok, fallback=${adapter.isFallbackAdapter ?? adapter.info?.isFallbackAdapter}` : 'no adapter';
	});
}

/** Tries one browser capability and logs what happened. A request that never answers is reported too. */
async function probe(name: string, attempt: () => Promise<string>): Promise<void> {
	const outcome = await Promise.race([
		attempt().catch((error: Error) => `refused: ${error?.name}: ${error?.message}`),
		new Promise<string>((resolve) => setTimeout(() => resolve('no answer after 5 s'), 5000)),
	]);
	log('info', `${name}: ${outcome}`);
}
