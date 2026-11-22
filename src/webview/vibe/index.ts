// VIBE FM firmwares as one superdough instrument, `vibefm1`, with the firmware after the colon:
// `s("vibefm1:obervave")`. Mini-notation turns that into `{ s: 'vibefm1', n: 'obervave' }`, so the firmware is a
// value like any other and can change per step: `s("vibefm1:<obervave sloop>")`. A number picks by position, as
// `bd:3` does for samples. A firmware is a whole synth, often with its own sequencer, so it runs as one
// AudioWorkletNode per firmware and orbit, and each hap only sends it notes.
import * as strudelWebaudio from '@strudel/webaudio';
import { unzipSync } from 'fflate';
import type { DeviceInfo, DeviceParam, DeviceRequest } from '../../shared/devices';
import type { FirmwareCacheMap } from '../../shared/firmware';
import type { FirmwareInfo } from '../../shared/protocol';
import type { VibeEvent } from './core';
import type { FromVibeWorklet, ToVibeWorklet } from './worklet';

export interface VibeHost {
	log(level: 'info' | 'warn' | 'error', message: string): void;
	/** The scheduler's cycle now, and whether it plays. For the firmware's transport. */
	clock(): { cycle: number; cps: number; playing: boolean };
	/** The firmware copies that run now, for the Devices view. Sent when one starts or ends. */
	devices(list: DeviceInfo[]): void;
	/** A display frame of a copy, while a panel of the Devices view shows it. */
	frame(key: string, px: Uint8Array, values: number[]): void;
	/** The level meter of the chain a note comes from, for the Mixer. */
	meter?(value: any): AudioNode | undefined;
}

interface Instance {
	/** `<id>@<orbit>`. */
	key: string;
	id: string;
	orbit: number;
	params: DeviceParam[];
	node: AudioWorkletNode;
	post(message: ToVibeWorklet): void;
	/** The tempo last sent, so that it goes out only when it changes. */
	bpm?: number;
	/** The program last sent per channel. A program change reloads a sound, so it is not sent with every note. */
	programs: Map<number, number>;
	/** The chain meters this copy already feeds. */
	metered?: Set<AudioNode>;
}

/** The instrument's name in a song. */
export const INSTRUMENT = 'vibefm1';
const WORKLET_URL = new URL('vibe-worklet.js', import.meta.url).href;
const firmware = new Map<string, FirmwareInfo>();
/** From the firmware folder, sent by the extension host. */
let local: FirmwareInfo[] = [];
/** Added by songs with `firmware(...)`. A folder firmware of the same id wins. */
const remote = new Map<string, FirmwareInfo>();
/** In the folder's order, for `vibefm1:<number>` and the Sounds view. */
let order: string[] = [];
/** Ids already reported as unknown, so a pattern does not log the same line on every note. */
const reported = new Set<string>();
let lastLogged = '';
/** Cached copies of firmwares from an address, kept by the extension host. */
let cache: FirmwareCacheMap = {};
const modules = new Map<string, Promise<WebAssembly.Module>>();
const instances = new Map<string, Promise<Instance | undefined>>();
/** The copies that started and still run, by key. What the Devices view lists. */
const running = new Map<string, Instance>();
let workletLoaded: Promise<void> | undefined;
let host: VibeHost;

export function initFirmware(h: VibeHost): void {
	host = h;
}

/**
 * Sets the firmwares that `vibefm1` can play. A firmware already playing keeps playing when the list is sent again;
 * one whose file changed is loaded again on its next note; one that is gone stops.
 */
export function registerFirmware(list: FirmwareInfo[]): void {
	local = list;
	apply();
}

/**
 * `firmware(...)` in a song: firmwares from an address, next to the ones of the folder.
 *   firmware('https://example.com/obervave.wasm')            the id is the file name
 *   firmware({ obervave: 'https://...', boom: 'https://...zip' })
 * A `.wasm` or a package `.zip` from thefirmwarehub.com. The file is fetched on the first note, so the server has to
 * allow it (CORS). Not cached for offline use yet.
 */
export function addFirmware(spec: string | Record<string, string>): void {
	const entries = typeof spec === 'string' ? [[idFromUrl(spec), spec]] : Object.entries(spec ?? {});
	for (const [id, url] of entries) {
		if (!id || typeof url !== 'string') {
			host.log('error', `firmware(): give an address, or { name: address }. Got ${JSON.stringify(spec)}`);
			continue;
		}
		const key = id.toLowerCase();
		remote.set(key, { id: key, name: id, url });
	}
	apply();
}

/** The host has cached copies. A firmware not loaded yet is loaded from its copy. One already running keeps running. */
export function setFirmwareCache(map: FirmwareCacheMap): void {
	cache = map;
}

function idFromUrl(url: string): string {
	const file = url.split(/[?#]/)[0].split('/').pop() ?? '';
	return file.replace(/\.[^.]*$/, '').replace(/-vibe$/, '');
}

function apply(): void {
	const list = [...local, ...[...remote.values()].filter((fw) => !local.some((l) => l.id === fw.id))];
	const ids = new Set(list.map((fw) => fw.id));
	for (const id of [...firmware.keys()]) {
		if (ids.has(id)) continue;
		forget(id);
		firmware.delete(id);
	}
	for (const fw of list) {
		const known = firmware.get(fw.id);
		if (known && known.url !== fw.url) forget(fw.id);
		firmware.set(fw.id, fw);
	}
	order = list.map((fw) => fw.id);
	reported.clear();
	if (!list.length) {
		// soundMap is a nanostores map: setting a key to undefined removes it.
		strudelWebaudio.soundMap.setKey(INSTRUMENT, undefined);
		return;
	}
	const text = order.join(', ');
	strudelWebaudio.registerSound(INSTRUMENT, trigger, { type: 'firmware', tag: 'firmware', variations: order });
	// A song that calls firmware() runs that on every evaluation. Say it once.
	if (text !== lastLogged) host.log('info', `${INSTRUMENT}: ${text}`);
	lastLogged = text;
}

/** Tells every running firmware where the song is, and that it plays or stopped. */
export function transport(playing: boolean): void {
	for (const pending of instances.values()) {
		void pending.then((instance) => {
			if (!instance) return;
			// Stop first: it empties the queue, which would take the "play off" with it.
			if (!playing) instance.post({ t: 'stop' });
			sendPlay(instance, playing);
		});
	}
}

function context(): AudioContext {
	return strudelWebaudio.getAudioContext();
}

function forget(id: string): void {
	modules.delete(id);
	for (const [key, pending] of instances) {
		if (!key.startsWith(`${id}@`)) continue;
		void pending.then((instance) => instance?.node.disconnect());
		instances.delete(key);
		running.delete(key);
	}
	announce();
}

/**
 * Drops every firmware copy and the loaded worklet module: they belong to the AudioContext they were made in. A render
 * (renderPatternAudio) closes the live context and makes an offline one, then leaves none; the next note starts fresh
 * copies in whatever context is current.
 */
export function resetFirmware(): void {
	for (const pending of instances.values()) void pending.then((instance) => instance?.node.disconnect());
	instances.clear();
	running.clear();
	offline.clear();
	workletLoaded = undefined;
	announce();
}

/** Tells the host which copies run. */
function announce(): void {
	host.devices([...running.values()].map(({ key, id, orbit, params }) => ({ key, id, orbit, params })));
}

/**
 * A request of the Devices view for one copy: draw or not, the last frame painted, a parameter, a button or encoder.
 * Controls go into the firmware's queue at the current frame, like a note played now.
 */
export function deviceRequest(request: DeviceRequest): void {
	const instance = running.get(request.key);
	if (!instance) return;
	if (request.action === 'draw') return instance.post({ t: 'draw', on: request.on });
	if (request.action === 'painted') return instance.post({ t: 'painted' });
	const ac = context();
	const frame = Math.round(ac.currentTime * ac.sampleRate);
	if (request.action === 'param') instance.post({ t: 'events', events: [{ frame, kind: 'param', index: request.index, value: request.value }] });
	else instance.post({ t: 'events', events: [{ frame, kind: 'control', type: request.event, id: request.id, down: request.down, value: request.value }] });
}

/** The firmware a hap asks for: `n` is its id, or its position in the folder. Without `n`, the first one. */
function resolve(n: unknown): string | undefined {
	if (typeof n === 'string') {
		const id = n.toLowerCase();
		if (firmware.has(id)) return id;
		if (!reported.has(id)) {
			reported.add(id);
			host.log('error', `${INSTRUMENT}:${n}: no such firmware. There are: ${order.join(', ') || 'none'}`);
		}
		return undefined;
	}
	// Wraps around like the variations of a sample.
	const index = Math.floor(Number(n ?? 0)) || 0;
	return order[((index % order.length) + order.length) % order.length];
}

/** onTrigger of superdough. Returns nothing: the firmware's node is already on its orbit, and superdough then skips the hap's own chain. */
async function trigger(t: number, value: any): Promise<undefined> {
	const id = resolve(value.n);
	if (!id) return undefined;
	precompile();
	const orbit = Number(value.orbit ?? 1);
	const ac = context();
	if (ac instanceof OfflineAudioContext) {
		// A render: the notes are kept for the copy that prepareOfflineFirmware makes when the render starts.
		await moduleFor(id);
		const key = `${id}@${orbit}`;
		let copy = offline.get(key);
		if (!copy) offline.set(key, (copy = { id, orbit, events: [], programs: new Map() }));
		copy.events.push(...noteEvents(t, value, ac.sampleRate, copy.programs));
		return undefined;
	}
	const instance = await instanceFor(id, orbit);
	if (!instance) return undefined;
	const rate = ac.sampleRate;
	// A firmware that just loaded should not play the first notes late: drop what is already more than a block past.
	if (t < ac.currentTime - 128 / rate) return undefined;
	const events = noteEvents(t, value, rate, instance.programs);
	// The firmware's sound joins its orbit here, not through superdough's notes, so its chain's meter is fed here. Two
	// chains on one copy both see the whole copy.
	const meter = host.meter?.(value);
	if (meter && !(instance.metered ??= new Set()).has(meter)) {
		instance.metered.add(meter);
		instance.node.connect(meter);
	}
	sendClock(instance);
	instance.post({ t: 'events', events });
	return undefined;
}

/** A hap as firmware events: a program change when `.progNum()` changed, then note on and note off, in frames. */
function noteEvents(t: number, value: any, rate: number, programs: Map<number, number>): VibeEvent[] {
	const freq = strudelWebaudio.getFrequencyFromValue(value);
	const note = Math.max(0, Math.min(127, Math.round(12 * Math.log2(freq / 440) + 69)));
	const channel = Math.max(0, Math.min(15, Math.round(Number(value.midichan ?? 1)) - 1));
	const velocity = Math.max(1, Math.min(127, Math.round(127 * Number(value.velocity ?? 1))));
	const on = Math.round(t * rate);
	// At least one frame between on and off, or the firmware sees both in one call and never sounds.
	const off = Math.max(on + 1, Math.round((t + Number(value.duration ?? 0.25)) * rate));
	const events: VibeEvent[] = [];
	// `.progNum(n)` picks a firmware's program (its patch), the way it would from a MIDI keyboard. OBERVAVE has 99.
	if (value.progNum != null) {
		const program = Math.max(0, Math.min(127, Math.round(Number(value.progNum))));
		if (programs.get(channel) !== program) {
			programs.set(channel, program);
			events.push({ frame: on, kind: 'midi', status: 0xc0 | channel, d1: program, d2: 0 });
		}
	}
	events.push(
		{ frame: on, kind: 'midi', status: 0x90 | channel, d1: note, d2: velocity },
		{ frame: off, kind: 'midi', status: 0x80 | channel, d1: note, d2: 0 },
	);
	return events;
}

/**
 * The firmware copies of a render, with every note they will play. An offline render runs seconds of audio in
 * milliseconds and a worklet reads its port only between render steps, so notes posted to it would arrive after the
 * render ended (measured: a firmware-only song rendered silent). So the notes wait here, and the copy is made with
 * all of them in its options when the render starts.
 */
const offline = new Map<string, { id: string; orbit: number; events: VibeEvent[]; programs: Map<number, number> }>();

/** Called by the render just before startRendering: makes the copies of the render with their notes. */
export async function prepareOfflineFirmware(ac: OfflineAudioContext): Promise<void> {
	if (!offline.size) return;
	await ac.audioWorklet.addModule(WORKLET_URL);
	const { cps } = host.clock();
	for (const copy of offline.values()) {
		const events: VibeEvent[] = [{ frame: 0, kind: 'tempo', bpm: cps * 240 }, { frame: 0, kind: 'play', on: true }, ...copy.events];
		const node = new AudioWorkletNode(ac, 'strdltn-vibe', {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			// The song plays from cycle 0 at frame 0, with its tempo, as a live play tells a firmware.
			processorOptions: { module: await moduleFor(copy.id), clock: { frame: 0, cycle: 0, cps, playing: true }, events },
		});
		node.connect(strudelWebaudio.getSuperdoughAudioController().getOrbit(copy.orbit).summingNode);
	}
	offline.clear();
}

function sendPlay(instance: Instance, on: boolean): void {
	sendClock(instance);
	const frame = Math.round(context().currentTime * context().sampleRate);
	instance.post({ t: 'events', events: [{ frame, kind: 'play', on }] });
}

/**
 * The song's position for the transport table, and its tempo as VIBE_EV_TRANSPORT TEMPO. Both are needed: OBERVAVE's
 * arp and sequencer take the tempo only from the event, others read the table (read in its main.c).
 */
function sendClock(instance: Instance): void {
	const ac = context();
	const frame = Math.round(ac.currentTime * ac.sampleRate);
	const { cycle, cps, playing } = host.clock();
	instance.post({ t: 'clock', frame, cycle, cps, playing });
	const bpm = cps * 240;
	if (instance.bpm !== bpm) {
		instance.bpm = bpm;
		instance.post({ t: 'events', events: [{ frame, kind: 'tempo', bpm }] });
	}
}

/**
 * Compiles every firmware of the list the first time `vibefm1` plays, so that a pattern that switches firmware does not
 * wait for a download and a compile on its first note there. Only compiled: a running firmware costs CPU even when
 * silent, so it starts with its first note.
 */
function precompile(): void {
	for (const id of order) void moduleFor(id).catch(() => undefined);
}

function moduleFor(id: string): Promise<WebAssembly.Module> {
	let module = modules.get(id);
	if (!module) {
		const fw = firmware.get(id);
		if (!fw) return Promise.reject(new Error('not registered'));
		module = load(fw.url).then((bytes) => WebAssembly.compile(wasmOf(bytes, fw.url)));
		// A failed download may work on the next try. A file that is not a firmware will not, so it stays failed.
		module.catch((error) => {
			if (!(error instanceof NotFirmware)) modules.delete(id);
		});
		modules.set(id, module);
	}
	return module;
}

/** The bytes of a firmware: from the host's cached copy when there is one, else from the address. */
async function load(url: string): Promise<Uint8Array> {
	const copy = cache[url];
	if (copy) {
		try {
			const response = await fetch(copy);
			if (response.ok) return new Uint8Array(await response.arrayBuffer());
		} catch {
			// The copy was deleted. The address may still work.
		}
	}
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return new Uint8Array(await response.arrayBuffer());
}

/** The firmware's .wasm: the file itself, or the one inside a package .zip from the hub. */
function wasmOf(bytes: Uint8Array, url: string): Uint8Array<ArrayBuffer> {
	const magic = String.fromCharCode(...bytes.subarray(0, 4));
	if (magic === '\0asm') return bytes as Uint8Array<ArrayBuffer>;
	if (magic.startsWith('PK')) {
		const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.wasm') && !f.name.endsWith('.aot.wasm') });
		const name = Object.keys(files).sort()[0];
		if (!name) throw new NotFirmware(`no .wasm in ${url}`);
		return files[name] as Uint8Array<ArrayBuffer>;
	}
	// An FM-1 update package (.fwsc) is native code for the FM-1's own chip. Only VIBE FM firmwares are wasm.
	if (/\.fwsc$/i.test(url.split(/[?#]/)[0])) throw new NotFirmware(`${url} is an FM-1 hardware firmware (.fwsc), not a VIBE FM firmware. Only VIBE FM .wasm files can play here`);
	throw new NotFirmware(`${url} is not a .wasm or a .zip with one`);
}

/** The file came, but it is no firmware we can play. Trying again will not help. */
class NotFirmware extends Error {}

function instanceFor(id: string, orbit: number): Promise<Instance | undefined> {
	const key = `${id}@${orbit}`;
	let pending = instances.get(key);
	if (!pending) {
		pending = start(id, orbit).catch((error) => {
			// Logged once per firmware, not once per note and orbit.
			if (!reported.has(`!${id}`)) host.log('error', `firmware ${id}: ${error?.message ?? error}`);
			reported.add(`!${id}`);
			// Keep a firmware that can never play as failed; anything else is tried again on the next note.
			if (!(error instanceof NotFirmware)) instances.delete(key);
			return undefined;
		});
		instances.set(key, pending);
	}
	return pending;
}

async function start(id: string, orbit: number): Promise<Instance | undefined> {
	const fw = firmware.get(id);
	if (!fw) throw new Error('not registered');
	const ac = context();
	workletLoaded ??= ac.audioWorklet.addModule(WORKLET_URL);
	await workletLoaded;
	const module = moduleFor(id);
	const node = new AudioWorkletNode(ac, 'strdltn-vibe', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: { module: await module },
	});
	const key = `${id}@${orbit}`;
	let params: DeviceParam[] = [];
	const ready = new Promise<boolean>((resolve) => {
		node.port.onmessage = (event: MessageEvent<FromVibeWorklet>) => {
			const m = event.data;
			if (m.t === 'frame') host.frame(key, new Uint8Array(m.px), m.values);
			else if (m.t === 'ready') {
				host.log('info', `firmware ${id} on orbit ${orbit}: host protocol ${m.sdk}, ${m.params.length} parameters`);
				params = m.params;
				resolve(true);
			} else if (m.t === 'log') host.log('info', `[${id}] ${m.text}`);
			else if (m.t === 'crash') {
				host.log('error', `firmware ${id} stopped: ${m.error}`);
				node.disconnect();
				instances.delete(key);
				if (running.delete(key)) announce();
				resolve(false);
			}
		};
	});
	if (!(await ready)) return undefined;
	// Into the orbit's sum: the orbit's filter (djf) and ducking apply. A hap's own effects (room, lpf, pan) do not,
	// because superdough builds those per hap and the firmware's sound is one stream.
	node.connect(strudelWebaudio.getSuperdoughAudioController().getOrbit(orbit).summingNode);
	const instance: Instance = { key, id, orbit, params, node, post: (message) => node.port.postMessage(message), programs: new Map() };
	running.set(key, instance);
	announce();
	// Started by the first note of a song that already plays: its sequencer has to know.
	if (host.clock().playing) sendPlay(instance, true);
	return instance;
}
