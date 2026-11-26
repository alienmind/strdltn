// Hosts one VIBE FM firmware (.wasm) and renders its sound. Plain code with no Web Audio in it, so that the
// AudioWorklet (worklet.ts) and the unit tests run the same thing.
//
// Written from the Apache-2.0 VIBE FM SDK (sdk/include/vibe.h, sdk/src/vibe_sdk.c). The SDK's browser emulator is
// closed, all rights reserved: nothing here comes from it.
//
// @credits zvenson

/** Event types of vibe_wasm_event (enum in vibe.h). */
export const VIBE_EV = { BUTTON: 3, ENCODER: 4, MIDI: 5, TRANSPORT: 8, PARAM: 10 } as const;
/** Ids of VIBE_EV_TRANSPORT. */
export const VIBE_TRANSPORT = { PLAY: 0, TEMPO: 1 } as const;
/** The host never asks for more frames per call than this (VIBE_MAX_BLOCK). */
export const VIBE_MAX_BLOCK = 256;
/** vibe_sdk_version() is the host protocol. 7 in SDK 8 to 27. Later SDKs only add optional exports. */
const PROTOCOLS = [1, 8];

export type VibeEvent =
	| { frame: number; kind: 'midi'; status: number; d1: number; d2: number }
	| { frame: number; kind: 'param'; index: number; value: number }
	| { frame: number; kind: 'play'; on: boolean }
	| { frame: number; kind: 'tempo'; bpm: number }
	/** A button (VIBE_EV_BUTTON) or an encoder (VIBE_EV_ENCODER) of the device, as the Devices view sends them. */
	| { frame: number; kind: 'control'; type: number; id: number; down: number; value: number };

/** The display: VIBE_SCREEN_W x VIBE_SCREEN_H, RGB565, row by row. */
export const VIBE_SCREEN = { w: 480, h: 320 } as const;

export interface VibeParam {
	index: number;
	id: string;
	name: string;
	min: number;
	max: number;
	def: number;
	unit: string;
	steps: number;
}

export interface VibeHostCallbacks {
	log?: (text: string) => void;
	/** A firmware wrote or deleted one of its stored files (data null). */
	store?: (name: string, data: ArrayBuffer | null) => void;
}

interface Exports {
	memory: WebAssembly.Memory;
	vibe_sdk_version(): number;
	vibe_wasm_init(sampleRate: number): void;
	vibe_wasm_io(): number;
	vibe_wasm_audio(frames: number, hasInput: number): void;
	vibe_wasm_event(type: number, id: number, down: number, value: number, midi: number): void;
	vibe_wasm_param_count?(): number;
	vibe_wasm_param_info?(i: number): number;
	vibe_wasm_param_value?(i: number): number;
	vibe_wasm_param_set?(i: number, v: number): void;
	vibe_wasm_transport?(): number;
	vibe_wasm_draw?(): number;
}

/**
 * Exports of native-compiled FM-1 WebAssembly builds using the `ss_*` sim ABI (e.g. SHRUB's
 * `shrub_sim.wasm`, zero imports, 240x240 RGB565 LCD, interleaved stereo f32 render). Hosted inside
 * `VibeCore` automatically so no separate engine or worklet is needed.
 */
interface ShrubSimExports {
	memory: WebAssembly.Memory;
	_initialize?(): void;
	ss_flash(): number;
	ss_master(value: number): void;
	ss_boot(seed: number): void;
	ss_running(): number;
	ss_render(frames: number): number;
	ss_midi(status: number, d1: number, d2: number): void;
	ss_event?(kind: number, id: number, value: number): void;
	ss_lcd?(): number;
}

const SS_MAX_BLOCK = 128;
const SS_LCD_SIZE = 240;
const SS_PARAMS: { param: VibeParam; cc?: number }[] = [
	{ param: { index: 0, id: 'master', name: 'Master', min: 0, max: 1023, def: 900, unit: '', steps: 1024 } },
	{ param: { index: 1, id: 'cutoff', name: 'Cutoff (CC 74)', min: 0, max: 127, def: 100, unit: '', steps: 128 }, cc: 74 },
	{ param: { index: 2, id: 'macro1', name: 'Macro 1 (CC 16)', min: 0, max: 127, def: 0, unit: '', steps: 128 }, cc: 16 },
	{ param: { index: 3, id: 'macro2', name: 'Macro 2 (CC 17)', min: 0, max: 127, def: 0, unit: '', steps: 128 }, cc: 17 },
	{ param: { index: 4, id: 'macro3', name: 'Macro 3 (CC 18)', min: 0, max: 127, def: 0, unit: '', steps: 128 }, cc: 18 },
	{ param: { index: 5, id: 'macro4', name: 'Macro 4 (CC 19)', min: 0, max: 127, def: 0, unit: '', steps: 128 }, cc: 19 },
];

/** UTF-8 without TextDecoder, which an AudioWorkletGlobalScope does not have. */
function decodeUtf8(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	try {
		return decodeURIComponent(escape(s));
	} catch {
		return s;
	}
}

function encodeUtf8(s: string): Uint8Array {
	const latin = unescape(encodeURIComponent(s));
	const out = new Uint8Array(latin.length);
	for (let i = 0; i < latin.length; i++) out[i] = latin.charCodeAt(i);
	return out;
}

export class VibeCore {
	readonly sdk: number;
	readonly params: VibeParam[] = [];
	/** Frames rendered since init. Events are scheduled on this timeline. */
	frame = 0;

	private readonly x?: Exports;
	private readonly ss?: ShrubSimExports;
	private readonly ssValues?: number[];
	private readonly io: number;
	private readonly transport: number;
	private readonly queue: VibeEvent[] = [];
	private readonly files = new Map<string, ArrayBuffer>();
	/** Notes on, as channel * 128 + note, so that a stop can end them. A firmware may ignore CC 123. */
	private readonly held = new Set<number>();

	constructor(module: WebAssembly.Module, sampleRate: number, callbacks: VibeHostCallbacks = {}, files?: Map<string, ArrayBuffer>) {
		if (files) for (const [k, v] of files) this.files.set(k, v);
		const exportNames = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
		if (exportNames.has('ss_render') && exportNames.has('ss_boot')) {
			const instance = new WebAssembly.Instance(module, {});
			const ss = instance.exports as unknown as ShrubSimExports;
			this.ss = ss;
			this.io = 0;
			this.transport = 0;
			this.sdk = 1;
			ss._initialize?.();
			ss.ss_flash();
			ss.ss_master(900);
			ss.ss_boot(1);
			// Fast-forward the boot splash (~4 s emulated = ~20 ms CPU) so the first note sounds immediately.
			for (let i = 0; i < 2000 && !ss.ss_running(); i++) ss.ss_render(SS_MAX_BLOCK);
			this.ssValues = SS_PARAMS.map((entry) => entry.param.def);
			for (const entry of SS_PARAMS) this.params.push({ ...entry.param });
			return;
		}
		let memory: WebAssembly.Memory | undefined;
		const bytes = (p: number, n: number) => new Uint8Array(memory!.buffer, p, n);
		const text = (p: number, n: number) => decodeUtf8(bytes(p, n));
		const env = {
			vibe_host_log: (p: number, n: number) => callbacks.log?.(text(p, n)),
			// Asks for things this host does not have: the firmware menu, the audio input.
			vibe_host_request: (_what: number) => {},
			vibe_host_store: (op: number, np: number, nl: number, dp: number, len: number) => this.store(op, text(np, nl), dp, len, bytes, callbacks),
		};
		const instance = new WebAssembly.Instance(module, { env });
		this.x = instance.exports as unknown as Exports;
		memory = this.x.memory;
		this.sdk = this.x.vibe_sdk_version();
		if (this.sdk < PROTOCOLS[0] || this.sdk > PROTOCOLS[1]) throw new Error(`firmware needs VIBE host protocol ${this.sdk}, we know ${PROTOCOLS.join(' to ')}`);
		this.x.vibe_wasm_init(sampleRate);
		this.io = this.x.vibe_wasm_io();
		this.transport = this.x.vibe_wasm_transport?.() ?? 0;
		this.readParams();
	}

	/** Queues an event. One with a frame already rendered runs at the start of the next block. */
	schedule(event: VibeEvent): void {
		let i = this.queue.length;
		while (i > 0 && this.queue[i - 1].frame > event.frame) i--;
		this.queue.splice(i, 0, event);
	}

	/** For a stop: drops every queued event and ends the notes that sound, at the next block. */
	stop(): void {
		this.queue.length = 0;
		for (const key of this.held) this.schedule({ frame: this.frame, kind: 'midi', status: 0x80 | (key >> 7), d1: key & 127, d2: 0 });
	}

	/** Index of a parameter by its id, or -1. */
	paramIndex(id: string): number {
		return this.params.find((p) => p.id === id)?.index ?? -1;
	}

	paramValue(index: number): number {
		if (this.ssValues) return this.ssValues[index] ?? NaN;
		return this.x?.vibe_wasm_param_value?.(index) ?? NaN;
	}

	/**
	 * Paints the display (vibe_wasm_draw runs the firmware's vibe_on_draw) and returns a copy of it, or undefined for
	 * a firmware without one. The SDK calls drawing "the host's drawing thread", never inside vibe_on_audio: we call it
	 * between two blocks. OBERVAVE takes 0.05 to 0.08 ms (spike F1, ARCHITECTURE "Firmware").
	 */
	draw(): Uint16Array | undefined {
		if (this.ss) {
			const ptr = this.ss.ss_lcd?.();
			if (!ptr) return undefined;
			const src = new Uint16Array(this.ss.memory.buffer, ptr, SS_LCD_SIZE * SS_LCD_SIZE);
			const dst = new Uint16Array(VIBE_SCREEN.w * VIBE_SCREEN.h);
			// Scale 240x240 square LCD to 320x320 centered inside the 480x320 VIBE display.
			const ox = (VIBE_SCREEN.w - VIBE_SCREEN.h) >> 1;
			for (let y = 0; y < VIBE_SCREEN.h; y++) {
				const sy = ((y * SS_LCD_SIZE) / VIBE_SCREEN.h) | 0;
				const srcRow = sy * SS_LCD_SIZE;
				const dstRow = y * VIBE_SCREEN.w + ox;
				for (let x = 0; x < VIBE_SCREEN.h; x++) {
					dst[dstRow + x] = src[srcRow + (((x * SS_LCD_SIZE) / VIBE_SCREEN.h) | 0)];
				}
			}
			return dst;
		}
		const p = this.x?.vibe_wasm_draw?.();
		if (!p || !this.x) return undefined;
		return new Uint16Array(this.x.memory.buffer, p, VIBE_SCREEN.w * VIBE_SCREEN.h).slice();
	}

	/**
	 * The host's position, read by sequencers (vibe_transport_info, SDK 8). Written before the next block.
	 * Layout on wasm32: has i32 @0, playing i32 @4, bpm f32 @8, sig_num i32 @12, sig_den i32 @16, beat f64 @24,
	 * bar_start f64 @32, loop i32 @40, loop_start f64 @48, loop_end f64 @56.
	 */
	setTransport(t: { playing: boolean; bpm: number; beat: number; beatsPerBar?: number }): void {
		if (!this.transport || !this.x) return;
		const dv = new DataView(this.x.memory.buffer, this.transport, 64);
		const perBar = t.beatsPerBar ?? 4;
		dv.setInt32(0, 1, true);
		dv.setInt32(4, t.playing ? 1 : 0, true);
		dv.setFloat32(8, t.bpm, true);
		dv.setInt32(12, perBar, true);
		dv.setInt32(16, 4, true);
		dv.setFloat64(24, t.beat, true);
		dv.setFloat64(32, Math.floor(t.beat / perBar) * perBar, true);
		dv.setInt32(40, 0, true);
	}

	/**
	 * Renders left.length frames. The block is cut at each queued event so that the event lands on its own frame:
	 * the SDK allows 1 to 256 frames a call (128 for `ss_render`) and says to split at events.
	 */
	render(left: Float32Array, right: Float32Array): void {
		const total = left.length;
		const end = this.frame + total;
		const maxBlock = this.ss ? SS_MAX_BLOCK : VIBE_MAX_BLOCK;
		let done = 0;
		while (done < total) {
			while (this.queue.length && this.queue[0].frame <= this.frame) this.apply(this.queue.shift()!);
			let n = Math.min(total - done, maxBlock);
			if (this.queue.length && this.queue[0].frame < end) n = Math.min(n, this.queue[0].frame - this.frame);
			if (this.ss) {
				const ptr = this.ss.ss_render(n);
				const interleaved = new Float32Array(this.ss.memory.buffer, ptr, 2 * n);
				for (let i = 0; i < n; i++) {
					const lv = interleaved[2 * i];
					const rv = interleaved[2 * i + 1];
					left[done + i] = Number.isFinite(lv) ? lv : 0;
					right[done + i] = Number.isFinite(rv) ? rv : 0;
				}
			} else if (this.x) {
				this.x.vibe_wasm_audio(n, 0);
				// A new view each time: the firmware's memory may grow, and then the old buffer is detached.
				const io = new Float32Array(this.x.memory.buffer, this.io, VIBE_MAX_BLOCK * 4);
				left.set(io.subarray(VIBE_MAX_BLOCK, VIBE_MAX_BLOCK + n), done);
				right.set(io.subarray(VIBE_MAX_BLOCK * 2, VIBE_MAX_BLOCK * 2 + n), done);
			}
			done += n;
			this.frame += n;
		}
	}

	private apply(e: VibeEvent): void {
		if (this.ss) {
			if (e.kind === 'midi') {
				const type = e.status & 0xf0;
				const key = ((e.status & 15) << 7) | (e.d1 & 127);
				if (type === 0x90 && e.d2 > 0) this.held.add(key);
				else if (type === 0x80 || type === 0x90) this.held.delete(key);
				this.ss.ss_midi(e.status & 255, e.d1 & 127, e.d2 & 127);
			} else if (e.kind === 'param') {
				const spec = SS_PARAMS[e.index];
				if (!spec || !this.ssValues) return;
				const clamped = Math.max(spec.param.min, Math.min(spec.param.max, e.value));
				this.ssValues[e.index] = clamped;
				if (spec.cc !== undefined) this.ss.ss_midi(0xb0, spec.cc, Math.round(clamped));
				else this.ss.ss_master(Math.round(clamped));
			} else if (e.kind === 'control') {
				if (e.type === VIBE_EV.BUTTON) this.ss.ss_event?.(2, e.id, e.down ? 1 : 0);
				else if (e.type === VIBE_EV.ENCODER) this.ss.ss_event?.(3, e.id, Math.round(e.value));
			}
			return;
		}
		const x = this.x!;
		if (e.kind === 'midi') {
			const type = e.status & 0xf0;
			const key = ((e.status & 15) << 7) | (e.d1 & 127);
			if (type === 0x90 && e.d2 > 0) this.held.add(key);
			else if (type === 0x80 || type === 0x90) this.held.delete(key);
			x.vibe_wasm_event(VIBE_EV.MIDI, 0, 0, 0, (e.status & 255) | ((e.d1 & 127) << 8) | ((e.d2 & 127) << 16));
		} else if (e.kind === 'param') {
			// vibe_wasm_param_set clamps and tells the firmware with VIBE_EV_PARAM.
			if (x.vibe_wasm_param_set) x.vibe_wasm_param_set(e.index, e.value);
			else x.vibe_wasm_event(VIBE_EV.PARAM, e.index, 0, e.value, 0);
		} else if (e.kind === 'control') x.vibe_wasm_event(e.type, e.id, e.down, e.value, 0);
		else if (e.kind === 'play') x.vibe_wasm_event(VIBE_EV.TRANSPORT, VIBE_TRANSPORT.PLAY, e.on ? 1 : 0, 0, 0);
		else x.vibe_wasm_event(VIBE_EV.TRANSPORT, VIBE_TRANSPORT.TEMPO, 0, e.bpm, 0);
	}

	/** vibe_param on wasm32: id @0, name @4, min @8, max @12, def @16, unit @20, steps @24, choices @28. */
	private readParams(): void {
		const x = this.x;
		if (!x || !x.vibe_wasm_param_count || !x.vibe_wasm_param_info) return;
		const mem = () => x.memory.buffer;
		const cstr = (p: number) => {
			if (!p) return '';
			const b = new Uint8Array(mem());
			let e = p;
			while (b[e]) e++;
			return decodeUtf8(b.subarray(p, e));
		};
		for (let i = 0, n = x.vibe_wasm_param_count(); i < n; i++) {
			const q = x.vibe_wasm_param_info(i);
			if (!q) continue;
			const dv = new DataView(mem(), q, 32);
			this.params.push({
				index: i,
				id: cstr(dv.getUint32(0, true)),
				name: cstr(dv.getUint32(4, true)),
				min: dv.getFloat32(8, true),
				max: dv.getFloat32(12, true),
				def: dv.getFloat32(16, true),
				unit: cstr(dv.getUint32(20, true)),
				steps: dv.getInt32(24, true),
			});
		}
	}

	/** vibe_host_store. The SDK has checked the name. Media (op 6 and up) is not offered. */
	private store(op: number, name: string, dp: number, len: number, bytes: (p: number, n: number) => Uint8Array, cb: VibeHostCallbacks): number {
		const f = this.files.get(name);
		switch (op) {
			case 0: {
				if (!f) return -1;
				const n = Math.min(len, f.byteLength);
				bytes(dp, n).set(new Uint8Array(f, 0, n));
				return n;
			}
			case 1: {
				const copy = bytes(dp, len).slice().buffer;
				this.files.set(name, copy);
				cb.store?.(name, copy.slice(0));
				return 0;
			}
			case 2:
				return f ? f.byteLength : -1;
			case 3:
				this.files.delete(name);
				cb.store?.(name, null);
				return f ? 0 : -1;
			case 4: {
				// The names, one per line, as many whole ones as fit.
				const out = bytes(dp, len);
				let w = 0;
				for (const k of [...this.files.keys()].sort()) {
					const b = encodeUtf8(k + '\n');
					if (w + b.length > len) break;
					out.set(b, w);
					w += b.length;
				}
				return w;
			}
			case 5: {
				// Read at an offset, which the firmware puts in the first 4 bytes of the buffer.
				if (!f) return -1;
				const off = new DataView(bytes(dp, 4).slice().buffer).getUint32(0, true);
				const n = Math.max(0, Math.min(len, f.byteLength - off));
				if (n) bytes(dp, n).set(new Uint8Array(f, off, n));
				return n;
			}
			default:
				return -1;
		}
	}
}
