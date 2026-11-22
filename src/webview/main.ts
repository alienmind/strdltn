// The webview: upstream StrudelMirror (editor, engine and visuals in one page) bound to
// a VS Code text document. We host upstream and add nothing to it, so that a new visual
// or widget in a later @strudel release arrives with a version bump.
import { Annotation, Prec, StateEffect, Transaction, type EditorSelection } from '@codemirror/state';
import { gotoLine, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import * as strudelCodemirror from '@strudel/codemirror';
import * as strudelCore from '@strudel/core';
import * as strudelDraw from '@strudel/draw';
import * as strudelHydra from '@strudel/hydra';
import * as strudelMini from '@strudel/mini';
import * as strudelSoundfonts from '@strudel/soundfonts';
import * as strudelTonal from '@strudel/tonal';
import { getWidgetID, transpiler } from '@strudel/transpiler';
import * as strudelWebaudio from '@strudel/webaudio';
import { chooseInsert, type InsertArgument, visualLabel } from '../shared/context';
import { toggleComment } from '../shared/comment';
import { locateError } from '../shared/diagnostic';
import { githubBase, hasOwnBases, isRemote, packFiles, type PackInfo } from '../shared/packs';
import { SyncClient, type SyncUpdate } from '../shared/sync';
import { type EditorSettings, type FirmwareInfo, type FromWebview, type Mode, type SampleMap, type SoundInfo, type ToWebview } from '../shared/protocol';
import { initMidi, listenEverywhere, midiMessage, midiScope, midiStopped, onControlChange, setMidiMuted } from './midi';
import { findKnobs, type KnobBinding, type Pickup, pickup, sliderAt } from '../shared/knob';
import { addFirmware, deviceRequest, initFirmware, registerFirmware, setFirmwareCache, transport } from './vibe';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const REPL_ID = 'strdltn';
const vscode = acquireVsCodeApi();
const post = (message: FromWebview) => vscode.postMessage(message);
const log = (level: 'info' | 'warn' | 'error', message: string) => post({ type: 'log', level, message });

const unlockElement = document.getElementById('unlock')!;
const dockElement = document.getElementById('dock')!;

let mirror: any;
/** Upstream's own `mirror.evaluate`, before init() routes the method through play(). */
let evaluateUpstream: () => Promise<void> = async () => undefined;
let mode: Mode = 'editor';
/** The text sync with the host, see src/shared/sync.ts. Set by init. */
let sync: SyncClient;
/** Marks a change that came from the host, so it is not sent back as ours. */
const fromHost = Annotation.define<boolean>();
/** A push waits for the host's answer before the next one. */
let pushing = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const syncId = Math.random().toString(36).slice(2);
/** What to do once the user has clicked the "enable audio" overlay. */
let afterUnlock: (() => unknown) | undefined;

window.addEventListener('error', (event) => log('error', `${event.message} (${event.filename}:${event.lineno})`));
window.addEventListener('unhandledrejection', (event) => log('error', `unhandled rejection: ${event.reason?.message ?? event.reason}`));
// Upstream reports everything (sample loading, eval errors) through this event.
document.addEventListener('strudel.log', (event) => {
	const { message, type } = (event as CustomEvent).detail ?? {};
	log(type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info', String(message));
});

initMidi(post, log);

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
	const message = event.data;
	if (midiMessage(message)) return;
	switch (message.type) {
		case 'init':
			sync = new SyncClient(message.version, syncId);
			init(message.text, message.mode, message.samples, message.firmware, message.settings);
			break;
		case 'settings':
			applySettings(message.settings);
			break;
		case 'cachedFiles':
			fileQuestions.get(message.id)?.(message.base);
			break;
		case 'changes':
			receiveChanges(message.updates);
			break;
		case 'reset':
			sync = new SyncClient(message.version, syncId);
			pushing = false;
			applyFromHost({ from: 0, to: mirror.editor.state.doc.length, insert: message.text });
			break;
		case 'firmware':
			registerFirmware(message.firmware);
			break;
		case 'firmwareCache':
			setFirmwareCache(message.map);
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
		case 'device':
			deviceRequest(message.request);
			break;
		case 'record':
			void recordTake(message.on);
			break;
		case 'render':
			void renderSong(message.cycles);
			break;
		case 'preview':
			void preview(message.name, message.index);
			break;
		case 'insert':
			insert(message.text, message.bare, message.argument);
			break;
		case 'editorAction':
			if (mirror && mode === 'editor') {
				mirror.editor.focus();
				// openSearchPanel adds the search extension when the editor has none: upstream
				// leaves search() out of its setup.
				const view = mirror.editor;
				const ran =
					message.action === 'find' || message.action === 'replace'
						? openSearchPanel(view)
						: message.action === 'gotoLine'
							? gotoLine(view)
							: message.action === 'selectNextMatch'
								? selectNextOccurrence(view)
								: selectSelectionMatches(view);
				// The search panel holds the replace field too; Ctrl+H puts the cursor there.
				if (message.action === 'replace') (view.dom.querySelector('.cm-search input[name=replace]') as HTMLInputElement | null)?.focus();
				log('info', `editor action ${message.action}: ${ran ? 'ran' : 'did nothing'}`);
			}
			break;
		case 'knobLearning':
			learningFrom = message.from;
			if (mirror && mode === 'editor') mirror.editor.dispatch({ effects: learningEffect.of(message.from) });
			break;
		case 'knobLearn':
			if (mirror && mode === 'editor') post({ type: 'knobLearnAt', from: sliderAt(mirror.editor.state.doc.toString(), mirror.editor.state.selection.main.head) });
			break;
		case 'select':
			if (mirror && mode === 'editor') {
				mirror.editor.dispatch({ selection: { anchor: Math.min(message.offset, mirror.editor.state.doc.length) }, scrollIntoView: true });
				mirror.editor.focus();
			}
			break;
		case 'sliderValue':
			moveSlider(message.index, message.from, message.value);
			break;
	}
});

post({ type: 'ready' });

/**
 * Theme and font of the Strudel editor. Upstream keeps them in a store that the editor
 * reads when it is created, so the store is set first and a new editor starts with the
 * right look. An editor that exists is told as well.
 */
function applySettings(settings: EditorSettings): void {
	const theme = settings.theme in strudelCodemirror.themes ? settings.theme : 'strudelTheme';
	const { fontFamily, fontSize } = settings;
	try {
		strudelCodemirror.codemirrorSettings.set({ ...strudelCodemirror.codemirrorSettings.get(), theme, fontFamily, fontSize });
	} catch {
		// The store writes to localStorage. Without it the editor is told below.
	}
	if (mirror) {
		mirror.setTheme(theme);
		mirror.setFontSize(fontSize);
		mirror.setFontFamily(fontFamily);
	}
	log('info', `settings: theme=${theme} font=${fontFamily} size=${fontSize}`);
}

function init(text: string, initialMode: Mode, samples: SampleMap, firmware: FirmwareInfo[], settings: EditorSettings): void {
	mode = initialMode;
	document.body.classList.toggle('stage', mode === 'stage');
	reportEnvironment();
	applySettings(settings);

	initFirmware({
		log,
		clock: () => {
			const scheduler = mirror?.repl?.scheduler;
			// During a render the song plays, offline, from cycle 0: a firmware is told so, as it is when it plays live.
			return { cycle: scheduler?.started ? scheduler.now() : 0, cps: scheduler?.cps ?? 0.5, playing: !!scheduler?.started || renderingNow };
		},
		devices: (devices) => post({ type: 'devices', devices }),
		meter: meterInput,
		frame: (key, px, values) => post({ type: 'frame', key, px, values }),
	});

	mirror = new strudelCodemirror.StrudelMirror({
		id: REPL_ID,
		root: document.getElementById('editor'),
		initialCode: text,
		// Every note passes here on its way to superdough: the Mixer's pump meter counts it.
		defaultOutput: (hap: any, deadline: number, duration: number, cps: number, t: number) => {
			noteHit(hap, t);
			// superdough reaches getOrbit before its first await, so while this call runs the note's chain is known
			// there: see meterOrbits.
			meterOrbits();
			meterChain = String(hap?.value?.[CHAIN_KEY] ?? '');
			try {
				return strudelWebaudio.webaudioOutput(hap, deadline, duration, cps, t);
			} finally {
				meterChain = undefined;
			}
		},
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
					// MIDI goes through the extension host (src/webview/midi.ts).
					{ samples: taggedSamples, firmware: addFirmware, ...midiScope },
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
			tagChains();
			if (mode === 'stage') prepareDock(mirror.code);
		},
		afterEval: ({ meta }: { meta: { widgets?: unknown[] } }) => {
			rememberSliders(meta?.widgets ?? []);
			rememberKnobs(mirror.code);
			if (mode === 'stage') fillDock(meta?.widgets ?? []);
			post({ type: 'evaluated' });
		},
		onToggle: (started: boolean) => {
			// The firmwares follow the transport of the song.
			transport(started);
			if (!started) midiStopped();
			sendLevels();
			postState();
		},
		onEvalError: (error: Error & { pos?: unknown }) => {
			log('error', `eval: ${error.message}`);
			const place = locateError(mirror.code, error);
			post({ type: 'evaluated', error: { message: String(error.message), from: place?.from, to: place?.to } });
		},
	});

	// Send every local change to the document. appendConfig because StrudelMirror
	// builds the editor state itself and takes no extra extensions.
	mirror.editor.dispatch({
		effects: StateEffect.appendConfig.of(
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				mapSliders(update.changes);
				listenIfTheCodeHasKnobs();
				for (const transaction of update.transactions) {
					if (transaction.docChanged && !transaction.annotation(fromHost)) sync.local(transaction.changes);
				}
				pushChanges();
			}),
		),
	});
	mirror.editor.dispatch({ effects: StateEffect.appendConfig.of(slashComment()) });

	// For the integration test, which clicks and types with real input through the DevTools
	// protocol: where a character is on screen, and what the editor holds. Read only.
	(window as unknown as { __strdltnTest: unknown }).__strdltnTest = {
		mode: () => mode,
		reveal: (position: number) => mirror.editor.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) }),
		coords: (position: number) => {
			const box = mirror.editor.coordsAtPos(position);
			return box && { x: box.left + 1, y: (box.top + box.bottom) / 2 };
		},
		/** Where CodeMirror itself places a point, and what element is under it. */
		posAt: (x: number, y: number) => ({ pos: mirror.editor.posAtCoords({ x, y }), under: (document.elementFromPoint(x, y) as HTMLElement | null)?.className || document.elementFromPoint(x, y)?.tagName }),
		/** CodeMirror's stored top of the line of a position, against the line on screen. */
		geometry: (position: number) => {
			const view = mirror.editor;
			const block = view.lineBlockAt(position);
			const node = view.domAtPos(position).node;
			const line = (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.closest('.cm-line');
			const canvases = [...view.contentDOM.querySelectorAll('canvas')].map((c) => `${c.id}:${Math.round(c.getBoundingClientRect().height)}@${c.parentElement?.className}`);
			return { stored: Math.round(block.top), real: line ? Math.round(line.getBoundingClientRect().top - view.documentTop) : null, canvases };
		},
		/** Asks CodeMirror to measure, and resolves two frames later when it has. */
		measure: () => new Promise((done) => { mirror.editor.requestMeasure(); requestAnimationFrame(() => requestAnimationFrame(done)); }),
		text: () => mirror.editor.state.doc.toString(),
		head: () => mirror.editor.state.selection.main.head,
		focused: () => mirror.editor.hasFocus,
		record: takes,
	};

	// Ctrl+Enter and Alt+Enter in the editor are upstream's keymap, which calls
	// mirror.evaluate() directly. That path never resumed the AudioContext: upstream only
	// starts audio on a mouse click in the page. After a reload, Ctrl+Enter without a click
	// first ran the song with the audio suspended and nothing said why (seen by the
	// maintainer in 0.2.0). So the method goes through play(), like the play button. A key
	// press is a user gesture for the browser, so resume() is allowed there.
	evaluateUpstream = mirror.evaluate.bind(mirror);
	mirror.evaluate = () => play();

	if (mode === 'editor') mirror.editor.dispatch({ effects: StateEffect.appendConfig.of(lineActions()) });
	listenIfTheCodeHasKnobs();

	// A double click on a slider's widget starts MIDI learn for it. Upstream's widget input
	// carries `from`, where its number starts.
	(mirror.editor.dom as HTMLElement).addEventListener('dblclick', (event) => {
		const input = (event.target as HTMLElement).closest?.('.cm-slider')?.querySelector('input') as (HTMLInputElement & { from?: number }) | null;
		if (input?.from !== undefined) post({ type: 'knobLearnAt', from: input.from });
	});

	unlockElement.addEventListener('click', () => {
		unlockElement.classList.remove('visible');
		const action = afterUnlock;
		afterUnlock = undefined;
		postState();
		if (action) void withAudio(action);
	});
	postState();
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
 * `samples()` as the song sees it. Two things are added to upstream.
 *
 * A pack loaded by name gets that name as its tag, and the Sounds view makes a group of
 * it. A cached `github:` pack is answered by `resolveGithubPack`. An `https://` map has
 * no such hook upstream, so its cached copy is handed over here.
 *
 * A map written in the song with a remote base (`samples({ bd: 'bd/x.wav' },
 * 'github:user/repo')`) plays from the cache when the host has every file of it.
 */
async function taggedSamples(map: any, base?: string, options: Record<string, unknown> = {}): Promise<void> {
	if (typeof map === 'string') {
		const cached = map.startsWith('github:') ? undefined : cachedPacks.get(map);
		if (cached) return strudelWebaudio.samples(structuredClone(cached.map), base || cached.base, { tag: map, ...options });
		// A pack that cannot be read (offline, a wrong address, a file not pushed yet) is a
		// warning, not an error of the song: on strudel.cc the song plays on without it, and
		// the demo loads its vocals from its own repository, which a branch has not on `main`
		// yet. The sounds of the project's samples folder are loaded already.
		try {
			return await strudelWebaudio.samples(map, base, { tag: map, ...options });
		} catch (error) {
			log('warn', `samples from ${map} not loaded: ${(error as Error).message}`);
			return;
		}
	}
	const remote = base ?? map?._base;
	if (map && typeof map === 'object' && isRemote(remote) && !hasOwnBases(map)) {
		const local = await cachedFolder(remote, packFiles(map));
		log('info', `samples from ${remote}: ${local ? 'cache' : 'network'}`);
		if (local) return strudelWebaudio.samples(map, local, options);
	}
	return strudelWebaudio.samples(map, base, options);
}

const fileQuestions = new Map<number, (base?: string) => void>();
let fileQuestionId = 0;
/**
 * Asks the host for the cached folder of a remote base. The answer is the address of
 * that folder when it holds every file, and nothing otherwise. The host then downloads
 * what is missing, for the next time. A host that does not answer in 2 seconds counts
 * as "not cached", so a song never waits long for it.
 */
function cachedFolder(base: string, files: string[]): Promise<string | undefined> {
	const id = ++fileQuestionId;
	return new Promise<string | undefined>((resolve) => {
		fileQuestions.set(id, resolve);
		setTimeout(() => resolve(undefined), 2000);
		post({ type: 'cacheFiles', id, base, files });
	}).finally(() => fileQuestions.delete(id));
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
		else if (cachedPacks.delete(pack.source)) {
			// The cache was emptied. Register the pack again, from the network this time.
			registeredPacks.delete(pack.source);
		}
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

/**
 * The files of a sound, for previews the Browser plays without the engine. superdough
 * keeps a list of full addresses, or for a pitched sound a map from notes to lists: then
 * the list of the note closest to A3, the note a preview plays.
 */
function sampleUrls(samples: unknown): string[] | undefined {
	const strings = (list: unknown) => (Array.isArray(list) && list.every((url) => typeof url === 'string') ? (list as string[]) : undefined);
	if (Array.isArray(samples)) return strings(samples);
	if (!samples || typeof samples !== 'object') return undefined;
	const notes = Object.keys(samples).filter((key) => !key.startsWith('_'));
	const midi = (note: string) => {
		const match = /^([a-gA-G])([#bs]*)(-?\d+)$/.exec(note);
		if (!match) return Number.NaN;
		const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase() as 'c'] ?? 0;
		const accidental = [...match[2]].reduce((sum, sign) => sum + (sign === 'b' ? -1 : 1), 0);
		return (Number(match[3]) + 1) * 12 + base + accidental;
	};
	const closest = notes.filter((note) => !Number.isNaN(midi(note))).sort((a, b) => Math.abs(midi(a) - 57) - Math.abs(midi(b) - 57))[0];
	return closest ? strings((samples as Record<string, unknown>)[closest]) : undefined;
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
			urls: sampleUrls(data.samples),
		}));
	post({ type: 'sounds', sounds });
}

/** Sends this editor's unconfirmed changes to the host, one push at a time. */
function pushChanges(): void {
	if (pushing || !mirror) return;
	const sendable = sync.sendable();
	if (!sendable) return;
	pushing = true;
	post({ type: 'push', ...sendable });
	// A lost answer must not stop the sync. A push sent twice is refused by its version.
	clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		pushing = false;
		pushChanges();
	}, 3000);
}

/** Changes the host accepted: ours are confirmed, the others applied here over what we still have unconfirmed. */
function receiveChanges(updates: SyncUpdate[]): void {
	if (!mirror) return;
	pushing = false;
	const changes = sync.receive(updates);
	if (changes) applyFromHost(changes);
	pushChanges();
}

/** A change from the host. Not ours to undo, so not in this editor's history. */
function applyFromHost(changes: unknown): void {
	mirror.editor.dispatch({ changes, annotations: [fromHost.of(true), Transaction.addToHistory.of(false)] });
}

function insert(text: string, bare?: string, argument?: InsertArgument): void {
	if (!mirror) return;
	const state = mirror.editor.state;
	mirror.editor.dispatch(state.replaceSelection(chooseInsert(state.doc.toString(), state.selection.main.from, text, bare, argument)));
	mirror.editor.focus();
}

/**
 * `//` typed over a selection comments the selected lines, and the same keys again take
 * the comment off (the rule is `toggleComment` in src/shared/comment.ts). The first `/`
 * waits for the second: any other key, or a pause of half a second, types the `/` as usual,
 * over the selection. Without a selection `/` is an ordinary key.
 */
function slashComment() {
	let pending: { selection: EditorSelection; timer: ReturnType<typeof setTimeout> } | undefined;
	const typeSlash = (view: EditorView, after = '') => view.dispatch(view.state.replaceSelection(`/${after}`));
	return Prec.highest(
		EditorView.inputHandler.of((view, _from, _to, text) => {
			const { selection } = view.state;
			if (pending) {
				const waiting = pending;
				pending = undefined;
				clearTimeout(waiting.timer);
				if (!waiting.selection.eq(selection)) return false;
				if (text !== '/') {
					typeSlash(view, text);
					return true;
				}
				const doc = view.state.doc.toString();
				const seen = new Set<number>();
				const changes = selection.ranges
					.flatMap((range) => toggleComment(doc, range.from, range.to))
					// Two ranges on one line would edit it twice.
					.filter((edit) => !seen.has(edit.at) && seen.add(edit.at))
					.sort((a, b) => a.at - b.at)
					.map((edit) => ({ from: edit.at, to: edit.at + edit.remove, insert: edit.insert }));
				if (changes.length) view.dispatch({ changes, userEvent: 'input.comment' });
				return true;
			}
			if (text !== '/' || selection.ranges.every((range) => range.empty)) return false;
			pending = {
				selection,
				// Half a second: the maintainer found a whole second too slow for a plain slash.
				timer: setTimeout(() => {
					// Typed once and left: it was a plain slash. Unless the selection moved since.
					if (pending?.selection.eq(view.state.selection)) typeSlash(view);
					pending = undefined;
				}, 500),
			};
			return true;
		}),
	);
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
		postState();
		return;
	}
	await action();
}

function play(): Promise<void> {
	if (!mirror) return Promise.resolve();
	return withAudio(async () => {
		await evaluateUpstream();
		postState();
		report();
	});
}

/**
 * Plays one sound once, the way the sounds tab of strudel.cc does. While the song plays,
 * the sound starts on the next beat and lasts one beat, so a synth or a sample can be
 * tried against the music, as the preview of Live does with "Raw" off. One cycle is a bar
 * of four beats, the same rule the firmware clock uses.
 */
function preview(name: string, index: number): Promise<void> {
	return withAudio(async () => {
		const data = (strudelWebaudio.soundMap.get() as Record<string, { data?: any }>)[name]?.data ?? {};
		// Synths, soundfonts and pitched sample maps need a note to make a sound.
		const pitched = data.type !== 'sample' || !Array.isArray(data.samples);
		const value = { s: name, n: index, clip: 1, release: 0.5, ...(pitched ? { note: 'a3' } : {}) };
		const context: AudioContext = strudelWebaudio.getAudioContext();
		const scheduler = mirror?.repl?.scheduler;
		let at = context.currentTime + 0.05;
		let duration = 0.5;
		let synced = '';
		if (scheduler?.started && scheduler.cps > 0) {
			const beats = 4;
			// The audio time of a cycle, by the formula of upstream's Cyclist (cyclist.mjs,
			// @strudel/core 1.2.6). Its `latency` is in it: the song is heard that much after
			// the scheduler's own `now()`.
			const timeOf = (c: number) => (c - scheduler.num_cycles_at_cps_change) / scheduler.cps + scheduler.seconds_at_cps_change + scheduler.latency;
			const heard = (context.currentTime - scheduler.latency - scheduler.seconds_at_cps_change) * scheduler.cps + scheduler.num_cycles_at_cps_change;
			let next = Math.ceil(heard * beats) / beats;
			// Not a beat closer than 50 ms: the sound could not start in time.
			while (timeOf(next) < context.currentTime + 0.05) next += 1 / beats;
			at = timeOf(next);
			duration = 1 / beats / scheduler.cps;
			synced = ` on beat ${(Math.round(next * beats) % beats) + 1}`;
		}
		await strudelWebaudio.superdough(value, at, duration);
		log('info', `preview: ${name}:${index}${synced}`);
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
// In the stage the code is hidden, so the visuals the code would show inline are laid
// out here instead. Each row has a label on the left that says which part of the song it
// belongs to. The labels come from the rules in src/shared/context.ts. The sliders are
// not here: they are the faders of the Mixer.

// ---- sliders moved from the Mixer -----------------------------------------------------

interface LiveSlider {
	/** The id upstream gives the slider: `slider_<position at evaluation>`. Its value lives under this id. */
	id: string;
	/** Where the number is in the document now. Kept up to date as the text changes. */
	from: number;
	writeTimer?: ReturnType<typeof setTimeout>;
	/** The value the next write puts in the code. */
	pending?: string;
}
/** The sliders of the last evaluation, in both modes. */
let liveSliders: LiveSlider[] = [];

function rememberSliders(widgets: any[]): void {
	liveSliders.forEach((slider) => clearTimeout(slider.writeTimer));
	liveSliders = widgets.filter((widget) => widget.type === 'slider').map((widget) => ({ id: `slider_${widget.from}`, from: widget.from }));
}

/**
 * A fader of the Mixer moved. Two things follow, as when a slider in the code is dragged:
 * the sound changes at once, and the number in the code becomes the new value.
 *
 * The sound: upstream keeps slider values by id and listens for this window message. A
 * slider typed since the last evaluation has no id yet; then only the code changes.
 *
 * The code: this page writes it, not the host, because upstream's inline slider in the
 * Strudel editor keeps the text of its number and replaces that many characters on its
 * next drag. A number changed behind its back would be cut wrong. So the widget is told
 * the new text in the same step. The write waits 150 ms after the last move: a drag
 * fires an event per pixel, and each one would be an edit of the document.
 *
 * What moves at once, on every move: the sound, and the widget's handle in the editor (its
 * range input; the text it keeps is set with the write). Not the code. A knob first wrote
 * the code every 15 ms while it turned, as the maintainer asked for a snappier knob: each
 * write is an edit that the editor parses, the host receives and the Mixer reads again, and
 * at 60 a second the knob lagged by seconds (2026-11-22). So the code is written once, 150
 * ms after the last move, and the handle is what follows the hand.
 */
function moveSlider(index: number, from: number | undefined, value: string): void {
	// By position when the host could read it, else by index: half typed code does not
	// parse on the host, and this list follows every edit since the last evaluation.
	const slider = from !== undefined ? liveSliders.find((s) => s.from === from) : liveSliders[index];
	if (slider) window.postMessage({ type: 'cm-slider', value: Number(value), id: slider.id }, '*');
	if (!slider && from === undefined) return;
	if (mirror) {
		const at = slider?.from ?? from;
		for (const input of (mirror.editor.dom as HTMLElement).querySelectorAll<HTMLInputElement & { from?: number }>('.cm-slider input')) if (input.from === at) input.value = value;
	}
	let key = slider ?? pendingWrites.find((p) => p.from === from);
	if (!key) pendingWrites.push((key = { id: '', from: from! }));
	const target = key;
	target.pending = value;
	clearTimeout(target.writeTimer);
	target.writeTimer = setTimeout(() => {
		target.writeTimer = undefined;
		pendingWrites = pendingWrites.filter((p) => p !== target);
		const key = target;
		const value = target.pending!;
		const doc = mirror.editor.state.doc.toString();
		const number = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(doc.slice(key.from))?.[0];
		if (!number || number === value) return;
		const start = key.from;
		mirror.editor.dispatch({ changes: { from: start, to: start + number.length, insert: value } });
		// Upstream's widget of this slider, if the editor shows one: its position is kept
		// by upstream, the text of its number we set.
		for (const input of (mirror.editor.dom as HTMLElement).querySelectorAll<HTMLInputElement & { from?: number; originalValue?: string }>('.cm-slider input')) {
			if (input.from === start) {
				input.originalValue = value;
				input.value = value;
			}
		}
	}, 150);
}

// Every live move of a slider, whoever made it (upstream's widget, a Mixer fader, a knob),
// is a `cm-slider` window message. The Mixer hears of it by where the number is now, at
// most once per slider per frame: a knob sends a value per MIDI message.
const liveOut = new Map<string, number>();
let liveFrame = 0;
window.addEventListener('message', (event: MessageEvent) => {
	if (event.data?.type !== 'cm-slider') return;
	liveOut.set(event.data.id, Number(event.data.value));
	liveFrame ||= requestAnimationFrame(() => {
		liveFrame = 0;
		for (const [id, value] of liveOut) {
			const slider = liveSliders.find((s) => s.id === id);
			if (slider) post({ type: 'sliderLive', from: slider.from, value });
		}
		liveOut.clear();
	});
});
/**
 * A knob that has not caught its slider yet: where it is, in the slider's units, so the
 * Mixer draws a dim second handle there (the maintainer, 2026-11-22: without it a knob
 * that waits for pickup looks dead). `undefined` once it caught the slider. Sent at most
 * once per slider per frame, by where the slider's number is now.
 */
const ghostOut = new Map<number, number | undefined>();
let ghostFrame = 0;
function ghost(from: number, value: number | undefined): void {
	ghostOut.set(from, value);
	ghostFrame ||= requestAnimationFrame(() => {
		ghostFrame = 0;
		for (const [at, v] of ghostOut) post({ type: 'knobGhost', from: at, value: v });
		ghostOut.clear();
	});
}

/**
 * Sliders on knobs (src/shared/knob.ts). The bindings are read from the code that was
 * evaluated, so their `from` is the slider's id; the slider's number is found where it is
 * now through `liveSliders`. A CC moves the slider as a Mixer fader does (`moveSlider`), so
 * the sound and the widget's handle follow at once, the number in the code 150 ms after the
 * knob stops.
 */
let knobs: { binding: KnobBinding; state: Pickup }[] = [];
let listening = false;

/**
 * Where each CC was last, 0 to 1, across evaluations. A new evaluation starts every knob's
 * pickup over; a knob that sits on its slider's value (it wrote it) and then moves away
 * never crosses that value again, so it never took over. Seen by the maintainer on
 * 2026-11-22: mapping CC 2 re-evaluated the song and CC 1 stopped answering. With its last
 * position known, the first move counts as starting on the value.
 */
const lastPosition = new Map<number, number>();

function rememberKnobs(code: string): void {
	evaluated = true;
	knobs = findKnobs(code).map((binding) => {
		const at = lastPosition.get(binding.cc);
		return { binding, state: { engaged: false, knob: at === undefined ? undefined : binding.min + at * (binding.max - binding.min) } };
	});
	if (!knobs.length) return;
	// Said once per evaluation, so the Output shows whether each knob found its slider.
	const values = (strudelCodemirror as any).sliderValues ?? {};
	log('info', `knobs: ${knobs.map(({ binding: b }) => `CC ${b.cc} -> slider_${b.from} (${b.min} to ${b.max})${typeof values[`slider_${b.from}`] === 'number' ? '' : ' NOT FOUND'}`).join(', ')}`);
	void listen();
}

/** When each knob last said it waits for pickup, so a turning knob says it once a second. */
const pickupSaid = new Map<number, number>();

async function listen(): Promise<boolean> {
	if (listening) return true;
	try {
		const inputs = await listenEverywhere();
		listening = true;
		log('info', `knobs: listening to ${inputs} MIDI inputs`);
		return true;
	} catch (error) {
		log('warn', `knobs: no MIDI here (${(error as Error).message})`);
		return false;
	}
}

/**
 * Where a slider's number is now, and the value it plays: upstream's `sliderValues`, which
 * every drag, fader and knob sets through the `cm-slider` message. Not the number in the
 * code: that follows 150 ms late, and a turning knob would take it for a drag and let go.
 */
function sliderNow(id: string): { from: number; value: number } | undefined {
	const slider = liveSliders.find((s) => s.id === id);
	const value = (strudelCodemirror as any).sliderValues?.[id];
	return slider && typeof value === 'number' ? { from: slider.from, value } : undefined;
}

/** True once the song was evaluated: its sliders have ids and values, and `knobs` is read from that code. */
let evaluated = false;

/**
 * Knobs before the song was ever played (the maintainer, 2026-11-22: "wire knobs even
 * without playing"). Nothing was evaluated, so no slider has an id or a value; the bindings
 * are read from the code as it is now, and a knob moves the number in the code and the
 * Mixer's fader. The sound follows once the song plays. Read again when the text changes,
 * which during a turn it does not (the code is written 150 ms after the knob stops); the
 * pickup states carry over by CC and order.
 */
let codeKnobs: { doc: unknown; knobs: { binding: KnobBinding; state: Pickup }[] } | undefined;
function knobsOfTheCode(): { binding: KnobBinding; state: Pickup }[] {
	const doc = mirror?.editor.state.doc;
	if (!doc) return [];
	if (codeKnobs && codeKnobs.doc === doc) return codeKnobs.knobs;
	const before = codeKnobs?.knobs ?? [];
	const seen = new Map<number, number>();
	const knobs = findKnobs(doc.toString()).map((binding) => {
		const nth = seen.get(binding.cc) ?? 0;
		seen.set(binding.cc, nth + 1);
		const old = before.filter((k) => k.binding.cc === binding.cc)[nth];
		const at = lastPosition.get(binding.cc);
		return { binding, state: old?.state ?? { engaged: false, knob: at === undefined ? undefined : binding.min + at * (binding.max - binding.min) } };
	});
	codeKnobs = { doc, knobs };
	return knobs;
}

/** The value in the code of the slider whose number starts at `from`, or the one about to be written there. */
function valueInCode(from: number): number | undefined {
	const pending = pendingWrites.find((p) => p.from === from)?.pending;
	if (pending !== undefined) return Number(pending);
	const number = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(mirror.editor.state.doc.sliceString(from, from + 32))?.[0];
	return number === undefined ? undefined : Number(number);
}

/** Before the first evaluation: listen to MIDI as soon as the code has a knob. */
function listenIfTheCodeHasKnobs(): void {
	if (!listening && !evaluated && mirror && /\.knob\s*\(/.test(mirror.editor.state.doc.toString())) void listen();
}

onControlChange((cc, value) => {
	lastPosition.set(cc, value);
	if (!evaluated) {
		for (const knob of knobsOfTheCode()) {
			if (knob.binding.cc !== cc) continue;
			const now = valueInCode(knob.binding.from);
			if (now === undefined) continue;
			const step = pickup(knob.state, knob.binding, now, value);
			knob.state = step.state;
			ghost(knob.binding.from, step.write === undefined ? step.state.knob : undefined);
			if (step.write === undefined) continue;
			moveSlider(-1, knob.binding.from, String(step.write));
			post({ type: 'sliderLive', from: knob.binding.from, value: step.write });
		}
		return;
	}
	for (const knob of knobs) {
		if (knob.binding.cc !== cc) continue;
		const slider = sliderNow(`slider_${knob.binding.from}`);
		if (!slider) {
			if (Date.now() - (pickupSaid.get(cc) ?? 0) > 1000) {
				pickupSaid.set(cc, Date.now());
				log('warn', `knobs: CC ${cc} has no slider slider_${knob.binding.from} in this evaluation; the sliders are ${liveSliders.map((s) => s.id).join(', ') || 'none'}`);
			}
			continue;
		}
		const step = pickup(knob.state, knob.binding, slider.value, value);
		knob.state = step.state;
		ghost(slider.from, step.write === undefined ? step.state.knob : undefined);
		if (step.write !== undefined) moveSlider(-1, slider.from, String(step.write));
		else if (Date.now() - (pickupSaid.get(cc) ?? 0) > 1000) {
			pickupSaid.set(cc, Date.now());
			const at = knob.binding.min + value * (knob.binding.max - knob.binding.min);
			log('info', `knobs: CC ${cc} is at ${Number(at.toPrecision(4))}, the slider at ${slider.value}: turn the knob past ${slider.value} to take it over`);
		}
	}
});

/**
 * Line actions: a column left of the line numbers (`Prec.highest` puts it before upstream's
 * gutters). A knob button on every line with a slider; a click asks the host for MIDI
 * learn on the first slider of the line. Other lines keep the column empty, so the code
 * stays aligned. CodeMirror lays the gutter out per line, so a widget between two lines
 * leaves a gap here too and the button stays beside its line number.
 */
const KNOB_ICON =
	'<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8.5" r="5.5" fill="var(--knob-fill)" stroke="currentColor" stroke-width="1.5"/><path d="M8 8.5 5 5" stroke="var(--knob-mark)" stroke-width="1.5" stroke-linecap="round"/></svg>';

/** The slider waiting for a CC (its button is red), by where its number starts. The host says. */
let learningFrom: number | undefined;
const learningEffect = StateEffect.define<number | undefined>();

class KnobMarker extends GutterMarker {
	constructor(
		readonly cc: number | undefined,
		readonly learning = false,
	) {
		super();
	}
	eq(other: KnobMarker): boolean {
		return other.cc === this.cc && other.learning === this.learning;
	}
	toDOM(): Node {
		const button = document.createElement('span');
		button.className = `strdltn-knob${this.learning ? ' learning' : this.cc === undefined ? '' : ' on'}`;
		button.innerHTML = KNOB_ICON;
		button.title = this.cc === undefined ? 'Click, then turn a knob: it moves this slider' : `Knob on CC ${this.cc}. Click to take it off`;
		return button;
	}
}

function lineActions() {
	const sliderLine = (text: string) => /\bslider\s*\(/.exec(text);
	return Prec.highest(
		gutter({
			class: 'strdltn-actions',
			lineMarker(view, line) {
				const docLine = view.state.doc.lineAt(line.from);
				const text = docLine.text;
				if (!sliderLine(text)) return null;
				const cc = /\.knob\(\s*(\d+)\s*\)/.exec(text)?.[1];
				const learning = learningFrom !== undefined && learningFrom >= docLine.from && learningFrom <= docLine.to;
				return new KnobMarker(cc === undefined ? undefined : Number(cc), learning);
			},
			lineMarkerChange: (update) => update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(learningEffect))),
			initialSpacer: () => new KnobMarker(undefined),
			domEventHandlers: {
				mousedown(view, line, event) {
					if (!(event.target as HTMLElement).closest('.strdltn-knob')) return false;
					const docLine = view.state.doc.lineAt(line.from);
					const at = sliderLine(docLine.text);
					if (!at) return false;
					post({ type: 'knobLearnAt', from: sliderAt(view.state.doc.toString(), docLine.from + at.index + at[0].length), toggle: true });
					return true;
				},
			},
		}),
	);
}

/** Writes for sliders typed since the last evaluation, which have no id yet. */
let pendingWrites: LiveSlider[] = [];

/** Follows the text. Called for every change of the document, ours or anyone's. */
function mapSliders(changes: { mapPos(position: number, assoc?: number): number }): void {
	for (const slider of [...liveSliders, ...pendingWrites]) slider.from = changes.mapPos(slider.from, -1);
}

/**
 * The pump meter of the Mixer: a level per chain from the notes it plays, not from audio.
 * Per-chain audio was tried first, through each `._scope()`'s analyser, and gave silence:
 * a song with `all(x => x.scope())` (demo.strudel) sends every chain to analyser 1, and
 * `analyze` holds one id per note (see "Scopes" in doc/ARCHITECTURE.md). Notes carry their
 * chain's label (`tagChains`); the output sees each note with its gain and the audio time
 * it sounds; a timer sends each chain's level, which jumps on a note and then decays.
 */
const CHAIN_KEY = 'strdltnChain';
/** Notes waiting for their moment, by chain. */
let pendingHits: { chain: string; at: number; level: number }[] = [];
const levels = new Map<string, number>();
let levelTimer: ReturnType<typeof setInterval> | undefined;
let levelTime = 0;
/** Seconds for a level to fall to half. */
const HALF_LIFE = 0.12;

/**
 * Wraps upstream's `.p(label)` for this evaluation (the repl puts a fresh one in place just
 * before `beforeEval`), so the notes of each labeled chain carry the label. Anonymous `$:`
 * are numbered in order, as the Mixer numbers its strips. Our key is one more value in the
 * note, which superdough ignores. This is spike D1 of doc/DAW-PLAN.md, built.
 */
function tagChains(): void {
	const prototype = strudelCore.Pattern.prototype as any;
	const original = prototype.p;
	if (typeof original !== 'function' || original.strdltnWrapped) return;
	let anonymous = 0;
	const wrapped = function (this: any, id: unknown) {
		const label = typeof id === 'string' ? (id === '$' ? `$#${anonymous++}` : id) : String(id);
		const tagged = this.withValue((value: unknown) => (value && typeof value === 'object' ? { ...(value as object), [CHAIN_KEY]: label } : value));
		return original.call(tagged, id);
	};
	(wrapped as any).strdltnWrapped = true;
	prototype.p = wrapped;
}

/** A note on its way to superdough: its chain's level jumps by its gain when it sounds. */
function noteHit(hap: any, at: number): void {
	const value = hap?.value;
	if (!value || typeof value !== 'object') return;
	const gain = Number(value.gain ?? 1) * Number(value.velocity ?? 1);
	pendingHits.push({ chain: String(value[CHAIN_KEY] ?? ''), at, level: Math.max(0, Math.min(1.5, Number.isFinite(gain) ? gain : 1)) });
	sendLevels();
}

/** About 20 times a second while the song plays: each chain's level, decayed and lifted by the notes that sounded. */
function sendLevels(): void {
	if (!mirror?.repl?.scheduler?.started) {
		clearInterval(levelTimer);
		levelTimer = undefined;
		pendingHits = [];
		levels.clear();
		return;
	}
	levelTimer ??= setInterval(() => {
		if (!mirror?.repl?.scheduler?.started) return sendLevels();
		const now = strudelWebaudio.getAudioContext().currentTime;
		const decay = levelTime ? Math.pow(0.5, (now - levelTime) / HALF_LIFE) : 0;
		levelTime = now;
		for (const [chain, level] of levels) levels.set(chain, level * decay);
		pendingHits = pendingHits.filter((hit) => {
			if (hit.at > now) return true;
			levels.set(hit.chain, Math.max(levels.get(hit.chain) ?? 0, hit.level));
			return false;
		});
		const peaks = readMeters();
		const chains = new Set([...levels.keys(), ...peaks.keys()]);
		post({
			type: 'scopes',
			scopes: [...chains].map((chain) => ({ chain, level: Math.round((levels.get(chain) ?? 0) * 1000) / 1000, ...(peaks.has(chain) ? { peak: peaks.get(chain) } : {}) })),
		});
	}, 50);
}

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
	dockElement.replaceChildren();

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

/** Tells the host what the engine does. The status bar of VS Code shows it. */
function postState(): void {
	const context: AudioContext = strudelWebaudio.getAudioContext();
	post({
		type: 'state',
		state: { started: !!mirror?.repl?.scheduler?.started, audio: context.state, needsClick: unlockElement.classList.contains('visible') },
	});
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
		postState();
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

/**
 * For the test and the promo video (doc/VIDEO.md): records what superdough sends to the
 * speakers, as a 16-bit stereo WAV that a runner pulls through DevTools in base64 chunks.
 * It taps `destinationGain`, the node in front of `ac.destination`, so it hears the whole
 * mix, firmwares included, and nothing else of the machine.
 */
function recorder() {
	let left: Float32Array[] = [];
	let right: Float32Array[] = [];
	let node: ScriptProcessorNode | undefined;
	let wav: Uint8Array | undefined;
	const CHUNK = 1 << 20;
	return {
		start(): string {
			const ac = strudelWebaudio.getAudioContext();
			const tap = (strudelWebaudio.getSuperdoughAudioController() as any).output?.destinationGain as AudioNode | undefined;
			if (!tap) return 'no output yet: play first';
			left = [];
			right = [];
			wav = undefined;
			const processor = ac.createScriptProcessor(4096, 2, 2);
			processor.onaudioprocess = (e: AudioProcessingEvent) => {
				left.push(e.inputBuffer.getChannelData(0).slice());
				right.push(e.inputBuffer.getChannelData(1).slice());
			};
			tap.connect(processor);
			// A ScriptProcessorNode runs only when it is connected onward. Its output is silent.
			processor.connect(ac.destination);
			node = processor;
			return `recording at ${ac.sampleRate} Hz`;
		},
		/**
		 * Stops and builds the WAV. `normalize` (the promo video) scales it so its loudest sample sits at -0.4 dB: the
		 * mix can go past full scale, and a 16-bit file would clip. Without it (Record, Render) the take is what was
		 * heard: above full scale it clips, as the speakers did. `from` and `count` keep part of the take, in frames.
		 * Returns the chunks of 1 MB, the peak before any scaling (1 is full scale), and the length in seconds.
		 */
		stop(normalize = true, from = 0, count = Infinity): { chunks: number; peak: number; seconds: number } {
			node?.disconnect();
			node = undefined;
			const rate = strudelWebaudio.getAudioContext().sampleRate;
			const flat = (buffers: Float32Array[]) => {
				const all = new Float32Array(buffers.reduce((n, b) => n + b.length, 0));
				let at = 0;
				for (const b of buffers) {
					all.set(b, at);
					at += b.length;
				}
				return all.subarray(Math.min(from, all.length), Math.min(all.length, from + count));
			};
			const l = flat(left);
			const r = flat(right);
			left = [];
			right = [];
			let peak = 0;
			for (const c of [l, r]) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
			const scale = normalize && peak > 0 ? 0.95 / peak : 1;
			if (scale !== 1) for (const c of [l, r]) for (let i = 0; i < c.length; i++) c[i] *= scale;
			wav = wavOf(l, r, rate);
			return { chunks: Math.ceil(wav.length / CHUNK), peak, seconds: l.length / rate };
		},
		/** Frames recorded so far. */
		frames: () => left.reduce((n, b) => n + b.length, 0),
		/** The WAV the last stop built. */
		bytes(): Uint8Array | undefined {
			return wav;
		},
		recording: () => !!node,
		chunk(i: number): string {
			if (!wav) return '';
			let s = '';
			const part = wav.subarray(i * CHUNK, (i + 1) * CHUNK);
			for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode(...part.subarray(j, j + 0x8000));
			return btoa(s);
		},
	};
}

/** True while renderSong makes a render: firmwares hear that the song plays. */
let renderingNow = false;

/** One recorder for Record and for the test hook: both tap the same output. */
const takes = recorder();

/**
 * Record on: play the song if it does not, then record what superdough sends to the speakers. Off: stop recording and
 * send the take to the host, as heard (no scaling). The take starts when the tap is in place, so the first notes of a
 * song that was not playing may be a beat late.
 */
async function recordTake(on: boolean): Promise<void> {
	if (!on) {
		if (!takes.recording()) return;
		const { peak, seconds } = takes.stop(false);
		const wav = takes.bytes();
		if (wav) post({ type: 'audio', kind: 'record', wav, seconds, peak });
		return;
	}
	if (!mirror?.repl?.scheduler?.started) await play();
	// Give the output a moment to exist: superdough builds it with the first note.
	for (let i = 0; i < 20 && !(strudelWebaudio.getSuperdoughAudioController() as any)?.output?.destinationGain; i++) await new Promise((r) => setTimeout(r, 100));
	const started = takes.start();
	if (!started.startsWith('recording')) post({ type: 'audioError', kind: 'record', message: `${started}. Click in the editor to enable audio, then press Record again` });
	else log('info', `record: ${started}`);
}

/** A 16-bit stereo WAV of two channels, as the levels are: above full scale it clips, as the speakers would. */
function wavOf(left: Float32Array, right: Float32Array, rate: number): Uint8Array {
	const frames = left.length;
	const out = new DataView(new ArrayBuffer(44 + frames * 4));
	const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
	text(0, 'RIFF');
	out.setUint32(4, 36 + frames * 4, true);
	text(8, 'WAVEfmt ');
	out.setUint32(16, 16, true);
	out.setUint16(20, 1, true);
	out.setUint16(22, 2, true);
	out.setUint32(24, rate, true);
	out.setUint32(28, rate * 4, true);
	out.setUint16(32, 4, true);
	out.setUint16(34, 16, true);
	text(36, 'data');
	out.setUint32(40, frames * 4, true);
	const sample = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
	for (let i = 0; i < frames; i++) {
		out.setInt16(44 + i * 4, sample(left[i]), true);
		out.setInt16(46 + i * 4, sample(right[i]), true);
	}
	return new Uint8Array(out.buffer);
}

/** Seconds a render goes on past the song's last cycle, for the releases, rooms and delays. */
const RENDER_TAIL = 2;
/** Seconds kept before the first note: the take starts a moment before the song. */
const RENDER_PREROLL = 0.25;

/**
 * Render: the song from its first cycle, played by the live engine with the speakers muted, recorded from superdough's
 * output (the recorder of Record), for its length and a tail. It takes as long as the song, and the file is what the
 * song sounds like: every effect, ducking, the firmwares, as when it plays. An offline render (upstream's
 * renderPatternAudio) was tried first and dropped: the demo came out with most notes missing (see the drawer). MIDI
 * is muted meanwhile, so a synth does not play along unheard. Stop ends the render without a file.
 */
async function renderSong(cycles: number): Promise<void> {
	const context: AudioContext = strudelWebaudio.getAudioContext();
	let tap: AudioNode | undefined;
	try {
		if (takes.recording()) takes.stop(false);
		mirror.stop();
		if (context.state !== 'running') await Promise.race([context.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
		if (context.state !== 'running') throw new Error('audio is not on yet: click once in the editor, then press Render again');
		tap = (strudelWebaudio.getSuperdoughAudioController() as any).output?.destinationGain as AudioNode | undefined;
		if (!tap) throw new Error('the audio output is not there');
		const cps = mirror.repl.scheduler.cps;
		const rate = context.sampleRate;
		const seconds = cycles / cps;
		log('info', `render: ${cycles} cycles at ${(cps * 240).toFixed(1)} BPM, ${seconds.toFixed(1)} s, in real time with the speakers off`);
		tap.disconnect(context.destination);
		setMidiMuted(true);
		renderingNow = true;
		takes.start();
		await play();
		const scheduler = mirror.repl.scheduler;
		if (!scheduler.started) throw new Error('the song did not start: see the error in the editor');
		// Nothing past the song's length plays: stopped at the end, the scheduler had already queued the first notes of
		// the next round, and they were in the tail (measured with an 8-bar song on 2026-11-22).
		if (scheduler.pattern?.filterHaps) scheduler.setPattern(scheduler.pattern.filterHaps((hap: any) => (hap.whole?.begin.valueOf() ?? 0) < cycles));
		const from = Math.max(0, takes.frames() - Math.round(RENDER_PREROLL * rate));
		const count = Math.round((seconds + RENDER_TAIL + RENDER_PREROLL) * rate);
		// The song stops at its length, so it does not start again; the tail goes on recording what still sounds.
		const songEnd = from + Math.round((seconds + RENDER_PREROLL) * rate);
		let lastLog = 0;
		while (takes.frames() < songEnd) {
			if (!mirror.repl.scheduler.started) throw new Error('stopped before the end');
			const done = (takes.frames() - from) / (songEnd - from);
			if (done - lastLog >= 0.1) {
				lastLog = done;
				log('info', `render: ${Math.round(done * 100)}%`);
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		mirror.stop();
		while (takes.frames() < from + count) await new Promise((r) => setTimeout(r, 100));
		const { peak } = takes.stop(false, from, count);
		const wav = takes.bytes();
		if (!wav) throw new Error('the render made no audio');
		post({ type: 'audio', kind: 'render', wav, seconds, peak });
	} catch (error) {
		if (takes.recording()) takes.stop(false);
		post({ type: 'audioError', kind: 'render', message: String((error as Error)?.message ?? error) });
	} finally {
		renderingNow = false;
		setMidiMuted(false);
		try {
			tap?.connect(context.destination);
		} catch {
			// The context went away meanwhile.
		}
	}
}

// ---- level meters ----------------------------------------------------------------------
//
// The Mixer's meters show each chain's real audio, as Live's do. superdough plays a note through its own nodes and
// ends with `orbit.connectToOutput(post)`, where `post` is that note's last node, after its own effects and before
// the orbit's shared ones. superdough gets the orbit with `getOrbit` before its first await, so while defaultOutput
// runs it the note's chain is known (`meterChain`): the controller's getOrbit is wrapped to hand back the orbit with a
// connectToOutput that also feeds the chain's meter. Nothing in the song changes, unlike a per-chain `analyze`, which
// a song's own `.scope()` takes over (see the drawer, "Per-chain scopes from the analysers"). Chains on one orbit get
// meters of their own; the orbit's shared room and delay are not in them. Firmwares are metered where their node
// joins the orbit (`meter` of the firmware host).

/** The chain of the note superdough is being given right now, or undefined. */
let meterChain: string | undefined;

interface Meter {
	context: BaseAudioContext;
	input: GainNode;
	left: AnalyserNode;
	right: AnalyserNode;
}
const meters = new Map<string, Meter>();
let masterMeter: Meter | undefined;
const METER_BUFFER = new Float32Array(2048);

function makeMeter(context: BaseAudioContext): Meter {
	const input = context.createGain();
	// A note without pan is mono; mixed up to two channels, it shows on both bars, not on the left alone (measured:
	// the right bar of a plain sawtooth read silence).
	input.channelCount = 2;
	input.channelCountMode = 'explicit';
	input.channelInterpretation = 'speakers';
	const split = context.createChannelSplitter(2);
	const left = context.createAnalyser();
	const right = context.createAnalyser();
	left.fftSize = right.fftSize = 2048;
	input.connect(split);
	split.connect(left, 0);
	split.connect(right, 1);
	return { context, input, left, right };
}

/** The meter of a chain in the current AudioContext. A render makes a new context, so meters follow it. */
function meterFor(chain: string): Meter | undefined {
	const context = strudelWebaudio.getAudioContext();
	if (context instanceof OfflineAudioContext) return undefined;
	let meter = meters.get(chain);
	if (!meter || meter.context !== context) meters.set(chain, (meter = makeMeter(context)));
	return meter;
}

/** Wraps getOrbit of superdough's controller once per controller. */
function meterOrbits(): void {
	const controller = strudelWebaudio.getSuperdoughAudioController() as any;
	if (!controller || controller.strdltnMeters) return;
	controller.strdltnMeters = true;
	const getOrbit = controller.getOrbit.bind(controller);
	controller.getOrbit = (orbitNum: number, channels?: number) => {
		const orbit = getOrbit(orbitNum, channels);
		const chain = meterChain;
		if (chain === undefined) return orbit;
		return new Proxy(orbit, {
			get(target, prop) {
				if (prop === 'connectToOutput')
					return (node: AudioNode) => {
						target.connectToOutput(node);
						const meter = meterFor(chain);
						if (meter) node.connect(meter.input);
					};
				const value = Reflect.get(target, prop, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
	};
}

function readPeak(analyser: AnalyserNode): number | null {
	analyser.getFloatTimeDomainData(METER_BUFFER);
	let peak = 0;
	for (let i = 0; i < METER_BUFFER.length; i++) peak = Math.max(peak, Math.abs(METER_BUFFER[i]));
	return peak > 1e-6 ? Math.round(2000 * Math.log10(peak)) / 100 : null;
}

/** Each chain's peak of the last 2048 samples (about 43 ms) in dBFS, and the whole mix's as `@master`. */
function readMeters(): Map<string, [number | null, number | null]> {
	const out = new Map<string, [number | null, number | null]>();
	const context = strudelWebaudio.getAudioContext();
	for (const [chain, meter] of meters) if (meter.context === context) out.set(chain, [readPeak(meter.left), readPeak(meter.right)]);
	const tap = (strudelWebaudio.getSuperdoughAudioController() as any)?.output?.destinationGain as AudioNode | undefined;
	if (tap && !(context instanceof OfflineAudioContext)) {
		if (!masterMeter || masterMeter.context !== context) {
			masterMeter = makeMeter(context);
			tap.connect(masterMeter.input);
		}
		out.set('@master', [readPeak(masterMeter.left), readPeak(masterMeter.right)]);
	}
	return out;
}

/** For the firmware host: the input of a chain's meter, where a firmware's node joins in too. */
function meterInput(value: any): AudioNode | undefined {
	const chain = value?.[CHAIN_KEY];
	return chain === undefined ? undefined : meterFor(String(chain))?.input;
}
