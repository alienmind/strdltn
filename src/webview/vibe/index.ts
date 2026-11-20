// VIBE FM firmwares as superdough sounds: `s("vibe_obervave")`. A firmware is a whole synth, often with its own
// sequencer, so it runs as one AudioWorkletNode per firmware and orbit, and each hap only sends it notes.
import * as strudelWebaudio from '@strudel/webaudio';
import type { FirmwareInfo } from '../../shared/protocol';
import type { VibeEvent } from './core';
import type { FromVibeWorklet, ToVibeWorklet } from './worklet';

export interface VibeHost {
	log(level: 'info' | 'warn' | 'error', message: string): void;
	/** The scheduler's cycle now, and whether it plays. For the firmware's transport. */
	clock(): { cycle: number; cps: number; playing: boolean };
}

interface Instance {
	node: AudioWorkletNode;
	post(message: ToVibeWorklet): void;
}

const WORKLET_URL = new URL('vibe-worklet.js', import.meta.url).href;
const firmware = new Map<string, FirmwareInfo>();
const modules = new Map<string, Promise<WebAssembly.Module>>();
const instances = new Map<string, Promise<Instance | undefined>>();
let workletLoaded: Promise<void> | undefined;
let host: VibeHost;

/**
 * The sound name of a firmware. One word: in mini-notation `vibe:obervave` would be the sound `vibe`, variation
 * `obervave`, and `-` or `.` would split it too. The `gm_` soundfonts use the same form.
 */
export function firmwareSound(id: string): string {
	return `vibe_${id.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

export function initFirmware(h: VibeHost): void {
	host = h;
}

/**
 * Registers each firmware as a sound, and removes the sounds of firmwares no longer in the list. A firmware already
 * playing keeps playing when the list is sent again; one whose file changed is loaded again on its next note.
 */
export function registerFirmware(list: FirmwareInfo[]): void {
	const ids = new Set(list.map((fw) => fw.id));
	for (const id of [...firmware.keys()]) {
		if (ids.has(id)) continue;
		forget(id);
		firmware.delete(id);
		// soundMap is a nanostores map: setting a key to undefined removes it.
		strudelWebaudio.soundMap.setKey(firmwareSound(id), undefined);
	}
	for (const fw of list) {
		const known = firmware.get(fw.id);
		if (known && known.url !== fw.url) forget(fw.id);
		firmware.set(fw.id, fw);
		strudelWebaudio.registerSound(firmwareSound(fw.id), (t: number, value: any) => trigger(fw.id, t, value), {
			type: 'firmware',
			tag: 'firmware',
			name: fw.name,
		});
	}
	if (list.length) host.log('info', `firmware: ${list.map((fw) => fw.id).join(', ')}`);
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
	}
}

/** onTrigger of superdough. Returns nothing: the firmware's node is already on its orbit, and superdough then skips the hap's own chain. */
async function trigger(id: string, t: number, value: any): Promise<undefined> {
	const orbit = Number(value.orbit ?? 1);
	const instance = await instanceFor(id, orbit);
	if (!instance) return undefined;
	const ac = context();
	const rate = ac.sampleRate;
	// A firmware that just loaded should not play the first notes late: drop what is already more than a block past.
	if (t < ac.currentTime - 128 / rate) return undefined;
	const freq = strudelWebaudio.getFrequencyFromValue(value);
	const note = Math.max(0, Math.min(127, Math.round(12 * Math.log2(freq / 440) + 69)));
	const channel = Math.max(0, Math.min(15, Math.round(Number(value.midichan ?? 1)) - 1));
	const velocity = Math.max(1, Math.min(127, Math.round(127 * Number(value.velocity ?? 1))));
	const on = Math.round(t * rate);
	// At least one frame between on and off, or the firmware sees both in one call and never sounds.
	const off = Math.max(on + 1, Math.round((t + Number(value.duration ?? 0.25)) * rate));
	const events: VibeEvent[] = [
		{ frame: on, kind: 'midi', status: 0x90 | channel, d1: note, d2: velocity },
		{ frame: off, kind: 'midi', status: 0x80 | channel, d1: note, d2: 0 },
	];
	sendClock(instance);
	instance.post({ t: 'events', events });
	return undefined;
}

function sendPlay(instance: Instance, on: boolean): void {
	sendClock(instance);
	const frame = Math.round(context().currentTime * context().sampleRate);
	instance.post({ t: 'events', events: [{ frame, kind: 'play', on }] });
}

function sendClock(instance: Instance): void {
	const ac = context();
	const { cycle, cps, playing } = host.clock();
	instance.post({ t: 'clock', frame: Math.round(ac.currentTime * ac.sampleRate), cycle, cps, playing });
}

function instanceFor(id: string, orbit: number): Promise<Instance | undefined> {
	const key = `${id}@${orbit}`;
	let pending = instances.get(key);
	if (!pending) {
		pending = start(id, orbit).catch((error) => {
			host.log('error', `firmware ${id}: ${error?.message ?? error}`);
			instances.delete(key);
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
	let module = modules.get(id);
	if (!module) {
		module = fetch(fw.url).then(async (response) => {
			if (!response.ok) throw new Error(`${response.status} for ${fw.url}`);
			return WebAssembly.compile(await response.arrayBuffer());
		});
		modules.set(id, module);
	}
	const node = new AudioWorkletNode(ac, 'vstrudel-vibe', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: { module: await module },
	});
	const ready = new Promise<boolean>((resolve) => {
		node.port.onmessage = (event: MessageEvent<FromVibeWorklet>) => {
			const m = event.data;
			if (m.t === 'ready') {
				host.log('info', `firmware ${id} on orbit ${orbit}: host protocol ${m.sdk}, ${m.params.length} parameters`);
				resolve(true);
			} else if (m.t === 'log') host.log('info', `[${id}] ${m.text}`);
			else if (m.t === 'crash') {
				host.log('error', `firmware ${id} stopped: ${m.error}`);
				node.disconnect();
				instances.delete(`${id}@${orbit}`);
				resolve(false);
			}
		};
	});
	if (!(await ready)) return undefined;
	// Into the orbit's sum: the orbit's filter (djf) and ducking apply. A hap's own effects (room, lpf, pan) do not,
	// because superdough builds those per hap and the firmware's sound is one stream.
	node.connect(strudelWebaudio.getSuperdoughAudioController().getOrbit(orbit).summingNode);
	const instance: Instance = { node, post: (message) => node.port.postMessage(message) };
	// Started by the first note of a song that already plays: its sequencer has to know.
	if (host.clock().playing) sendPlay(instance, true);
	return instance;
}
