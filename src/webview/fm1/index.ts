// Emulated FM-1 hardware firmwares (.fwsc) as a superdough instrument `fm1`, parallel to `vibefm1`:
// `note("c3 eb3 g3").s("fm1:felucca")`. Uses fm1-emu's WebAssembly emulator (MIT, fetched on demand and cached by
// the extension host) in `dist/fm1-worklet.js`.
import * as strudelWebaudio from '@strudel/webaudio';
import type { FirmwareInfo } from '../../shared/protocol';
import type { FromFm1Worklet, ToFm1Worklet } from './worklet';

export const FM1_INSTRUMENT = 'fm1';
const WORKLET_URL = new URL('fm1-worklet.js', import.meta.url).href;

interface Fm1Host {
	log(level: 'info' | 'warn' | 'error', message: string): void;
	/** Asks the extension host for the cached `fm1_web.wasm` URL (downloaded on demand into global storage). */
	emuWasmUrl(): Promise<string | undefined>;
	meter?(value: any): AudioNode | undefined;
}

interface Fm1Instance {
	key: string;
	id: string;
	orbit: number;
	node: AudioWorkletNode;
	gain: GainNode;
	timers: Set<ReturnType<typeof setTimeout>>;
	metered?: Set<AudioNode>;
}

let host: Fm1Host;
let emuModule: Promise<WebAssembly.Module> | undefined;
let workletLoaded: Promise<void> | undefined;
const firmware = new Map<string, FirmwareInfo>();
let order: string[] = [];
const pkgCache = new Map<string, Promise<ArrayBuffer>>();
const instances = new Map<string, Promise<Fm1Instance | undefined>>();
const reported = new Set<string>();
let activePreview: { stop(): void } | undefined;

export function initFm1(h: Fm1Host): void {
	host = h;
}

export function registerFm1Firmware(list: FirmwareInfo[]): void {
	const fwsc = list.filter((fw) => fw.runtime === 'fwsc');
	const ids = new Set(fwsc.map((fw) => fw.id));
	for (const id of [...firmware.keys()]) {
		if (!ids.has(id)) {
			forgetFm1(id);
			firmware.delete(id);
		}
	}
	for (const fw of fwsc) {
		const known = firmware.get(fw.id);
		if (known && known.url !== fw.url) forgetFm1(fw.id);
		firmware.set(fw.id, fw);
	}
	order = fwsc.map((fw) => fw.id);
	reported.clear();
	if (!fwsc.length) {
		strudelWebaudio.soundMap.setKey(FM1_INSTRUMENT, undefined);
		return;
	}
	strudelWebaudio.registerSound(FM1_INSTRUMENT, trigger, { type: 'firmware', tag: 'firmware', variations: order });
}

export function stopFm1Preview(): void {
	activePreview?.stop();
	activePreview = undefined;
}

function disposeInstance(inst: Fm1Instance): void {
	for (const t of inst.timers) clearTimeout(t);
	inst.timers.clear();
	try {
		inst.node.port.postMessage({ t: 'dispose' } satisfies ToFm1Worklet);
	} catch {
		// Port already closed.
	}
	try {
		inst.node.disconnect();
		inst.gain.disconnect();
	} catch {
		// Already disconnected.
	}
}

export function stopFm1Transport(): void {
	stopFm1Preview();
	for (const pending of instances.values()) {
		void pending.then((inst) => {
			if (!inst) return;
			for (const t of inst.timers) clearTimeout(t);
			inst.timers.clear();
			try {
				inst.node.port.postMessage({ t: 'stop' } satisfies ToFm1Worklet);
			} catch {
				// Port already closed.
			}
		});
	}
}

/**
 * Tears down any `.fwsc` worklet instances whose synth is no longer present in the evaluated Strudel code.
 * Prevents removed `.fwsc` lines from continuing to consume audio-thread CPU in the background.
 */
export function pruneFm1(code: string): void {
	if (!instances.size) return;
	const stripped = code
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1')
		.toLowerCase();
	const hasAnyFm1 = /\bfm1\b/.test(stripped);
	const hasIndexedFm1 = /\bfm1(?::\d+)?\b/.test(stripped.replace(/\bfm1:[a-z_][a-z0-9._-]*/g, ''));
	for (const [key, pending] of [...instances]) {
		const id = key.slice(0, key.lastIndexOf('@'));
		const stillUsed = hasAnyFm1 && (hasIndexedFm1 || stripped.includes(`fm1:${id}`));
		if (stillUsed) continue;
		instances.delete(key);
		void pending.then((inst) => {
			if (!inst) return;
			disposeInstance(inst);
			host.log('info', `fm1: disposed unused ${id}.fwsc on orbit ${inst.orbit}`);
		});
	}
}

export function resetFm1(): void {
	stopFm1Preview();
	for (const pending of instances.values()) {
		void pending.then((inst) => {
			if (inst) disposeInstance(inst);
		});
	}
	instances.clear();
	workletLoaded = undefined;
}

function forgetFm1(id: string): void {
	pkgCache.delete(id);
	for (const [key, pending] of [...instances]) {
		if (!key.startsWith(`${id}@`)) continue;
		instances.delete(key);
		void pending.then((inst) => {
			if (inst) disposeInstance(inst);
		});
	}
}

async function getEmuModule(): Promise<WebAssembly.Module> {
	if (!emuModule) {
		emuModule = (async () => {
			const url = await host.emuWasmUrl();
			if (!url) throw new Error('fm1-emu emulator wasm is not available');
			const res = await fetch(url);
			if (!res.ok) throw new Error(`${res.status} fetching fm1-emu wasm`);
			return WebAssembly.compile(await res.arrayBuffer());
		})().catch((error) => {
			emuModule = undefined;
			throw error;
		});
	}
	return emuModule;
}

async function getPkgBytes(id: string): Promise<ArrayBuffer> {
	let p = pkgCache.get(id);
	if (!p) {
		const fw = firmware.get(id);
		if (!fw) throw new Error(`no such FM-1 .fwsc firmware: ${id}`);
		p = fetch(fw.url)
			.then((r) => {
				if (!r.ok) throw new Error(`${r.status} for ${fw.url}`);
				return r.arrayBuffer();
			})
			.catch((error) => {
				pkgCache.delete(id);
				throw error;
			});
		pkgCache.set(id, p);
	}
	return p;
}

function resolve(n: unknown): string | undefined {
	if (typeof n === 'string') {
		const id = n.toLowerCase();
		if (firmware.has(id)) return id;
		if (!reported.has(id)) {
			reported.add(id);
			host.log('error', `${FM1_INSTRUMENT}:${n}: no such .fwsc firmware. There are: ${order.join(', ') || 'none'}`);
		}
		return undefined;
	}
	if (!order.length) return undefined;
	const index = Math.floor(Number(n ?? 0)) || 0;
	return order[((index % order.length) + order.length) % order.length];
}

async function createNode(ac: AudioContext, id: string, onRuntimeError?: (kind: 'error' | 'overload', message: string) => void): Promise<AudioWorkletNode> {
	workletLoaded ??= ac.audioWorklet.addModule(WORKLET_URL).catch((error) => {
		workletLoaded = undefined;
		throw error;
	});
	const [, module, pkg] = await Promise.all([workletLoaded, getEmuModule(), getPkgBytes(id)]);
	const node = new AudioWorkletNode(ac, 'strdltn-fm1', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: { module },
	});
	await new Promise<void>((resolveReady, rejectReady) => {
		let settled = false;
		node.port.onmessage = (event: MessageEvent<FromFm1Worklet>) => {
			const msg = event.data;
			if (!settled) {
				settled = true;
				if (msg.t === 'ready') resolveReady();
				else rejectReady(new Error(msg.message));
				return;
			}
			if (msg.t === 'overload' || msg.t === 'error') {
				onRuntimeError?.(msg.t, msg.message);
			}
		};
		node.port.postMessage({ t: 'boot', pkg: pkg.slice(0) } satisfies ToFm1Worklet);
	});
	return node;
}

async function instanceFor(id: string, orbit: number): Promise<Fm1Instance | undefined> {
	const key = `${id}@${orbit}`;
	let pending = instances.get(key);
	if (!pending) {
		const created: Promise<Fm1Instance | undefined> = (async (): Promise<Fm1Instance> => {
			const ac = strudelWebaudio.getAudioContext();
			let instRef: Fm1Instance | undefined;
			const node = await createNode(ac, id, (kind, message) => {
				if (instRef) disposeInstance(instRef);
				instances.delete(key);
				if (!reported.has(`!${id}`)) {
					reported.add(`!${id}`);
					host.log('error', `fm1 ${id} (${kind}): ${message}`);
				}
			});
			const gain = ac.createGain();
			node.connect(gain);
			gain.connect(strudelWebaudio.getSuperdoughAudioController().getOrbit(orbit).summingNode);
			host.log('info', `fm1: booted ${id}.fwsc on orbit ${orbit}`);
			instRef = { key, id, orbit, node, gain, timers: new Set<ReturnType<typeof setTimeout>>() };
			return instRef;
		})().catch((error) => {
			if (!reported.has(`!${id}`)) host.log('error', `fm1 ${id}: ${(error as Error)?.message ?? error}`);
			reported.add(`!${id}`);
			instances.delete(key);
			return undefined;
		});
		instances.set(key, created);
		return created;
	}
	return pending;
}

async function trigger(t: number, value: any): Promise<undefined> {
	const id = resolve(value.n);
	if (!id) return undefined;
	const ac = strudelWebaudio.getAudioContext();
	if (ac instanceof OfflineAudioContext) return undefined;
	const orbit = Number(value.orbit ?? 1);
	const inst = await instanceFor(id, orbit);
	if (!inst) return undefined;
	const meter = host.meter?.(value);
	if (meter && !(inst.metered ??= new Set()).has(meter)) {
		inst.metered.add(meter);
		inst.gain.connect(meter);
	}
	const freq = strudelWebaudio.getFrequencyFromValue(value);
	const note = Math.max(0, Math.min(127, Math.round(12 * Math.log2(freq / 440) + 69)));
	const ch = Math.max(0, Math.min(15, Math.round(Number(value.midichan ?? 1)) - 1));
	const vel = Math.max(1, Math.min(127, Math.round(127 * Number(value.velocity ?? 1))));
	const dur = Number(value.duration ?? 0.25);
	const onMs = Math.max(0, (t - ac.currentTime) * 1000);
	const offMs = Math.max(onMs + 10, (t + dur - ac.currentTime) * 1000);
	const tOn = setTimeout(() => {
		inst.timers.delete(tOn);
		inst.node.port.postMessage({ t: 'midi', bytes: [0x90 | ch, note, vel] } satisfies ToFm1Worklet);
	}, onMs);
	const tOff = setTimeout(() => {
		inst.timers.delete(tOff);
		inst.node.port.postMessage({ t: 'midi', bytes: [0x80 | ch, note, 0] } satisfies ToFm1Worklet);
	}, offMs);
	inst.timers.add(tOn);
	inst.timers.add(tOff);
	return undefined;
}

/** Plays a 1-loop disposable preview of a local `.fwsc` firmware synced to `at`, then fades out and disposes. */
export async function previewFm1(n: string | number, at: number, duration: number, fade: number): Promise<void> {
	stopFm1Preview();
	const id = resolve(n);
	if (!id) return;
	const ac = strudelWebaudio.getAudioContext();
	let node: AudioWorkletNode;
	try {
		node = await createNode(ac, id, (kind, message) => {
			host.log('warn', `preview fm1:${id} (${kind}): ${message}`);
			activePreview?.stop();
		});
	} catch (error) {
		host.log('error', `preview fm1:${id}: ${(error as Error)?.message ?? error}`);
		return;
	}
	const gain = ac.createGain();
	node.connect(gain);
	gain.connect(ac.destination);

	let disposed = false;
	const timers: ReturnType<typeof setTimeout>[] = [];
	const disposeNow = () => {
		if (disposed) return;
		disposed = true;
		timers.forEach(clearTimeout);
		try {
			node.port.postMessage({ t: 'dispose' } satisfies ToFm1Worklet);
		} catch {
			// Closed.
		}
		node.disconnect();
		gain.disconnect();
		if (activePreview === handle) activePreview = undefined;
	};
	const handle = {
		stop: () => {
			if (disposed) return;
			timers.forEach(clearTimeout);
			const now = ac.currentTime;
			gain.gain.cancelScheduledValues(now);
			gain.gain.setValueAtTime(gain.gain.value, now);
			gain.gain.linearRampToValueAtTime(0, now + 0.03);
			timers.push(setTimeout(disposeNow, 50));
		},
	};
	activePreview = handle;

	const startAt = Math.max(at, ac.currentTime + 0.05);
	const onMs = Math.max(0, (startAt - ac.currentTime) * 1000);
	const offMs = Math.max(onMs + 100, (startAt + duration - ac.currentTime) * 1000);
	timers.push(setTimeout(() => node.port.postMessage({ t: 'midi', bytes: [0x90, 57, 100] } satisfies ToFm1Worklet), onMs));
	timers.push(setTimeout(() => node.port.postMessage({ t: 'midi', bytes: [0x80, 57, 0] } satisfies ToFm1Worklet), offMs));
	gain.gain.setValueAtTime(1, startAt);
	gain.gain.setValueAtTime(1, startAt + duration);
	gain.gain.linearRampToValueAtTime(0, startAt + duration + fade);
	timers.push(setTimeout(disposeNow, Math.ceil((startAt + duration + fade - ac.currentTime) * 1000) + 100));
}
