// AudioWorklet processor running real M-VAVE FM-1 hardware firmwares (.fwsc) via fm1-emu's WebAssembly emulator
// (github.com/joakimeriksson/fm1-emu, MIT). Built on its own into dist/fm1-worklet.js.
// @credits Joakim Eriksson (fm1-emu)
//
// Real-time audio thread safety rules (measured 2026-11-26):
// - Never run a 500ms blocking boot slice inside process() on Chromium's audio thread: slice boot across quanta.
// - Always sanitize outputs (no NaN/Infinity into superdough's summingNode/filters/reverb).
// - Trip an automatic overload circuit breaker if a heavy firmware (like SHRUB at 0.76x real time) repeatedly
//   exceeds the quantum deadline, so the rest of Strudel never gets starved or muted.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: { processorOptions?: { module?: WebAssembly.Module } });
}
declare function registerProcessor(name: string, ctor: unknown): void;

export type ToFm1Worklet =
	| { t: 'boot'; wasm?: ArrayBuffer; pkg: ArrayBuffer; mhz?: number }
	| { t: 'midi'; bytes: number[] }
	| { t: 'pause'; paused: boolean }
	| { t: 'stop' }
	| { t: 'dispose' };

export type FromFm1Worklet =
	| { t: 'ready' }
	| { t: 'overload'; message: string }
	| { t: 'error'; message: string };

interface Fm1Exports {
	memory: WebAssembly.Memory;
	__indirect_function_table: WebAssembly.Table;
	fm1_alloc(len: number): number;
	fm1_jit(on: number, cap: number): void;
	fm1_ahead?(frames: number): void;
	fm1_boot_fwsc(ptr: number, len: number, syxPtr: number, syxLen: number, mhz: number): number;
	fm1_render(frames: number, budget: number): number;
	fm1_out_l(): number;
	fm1_out_r(): number;
	fm1_midi(byte: number): void;
}

const AHEAD_FRAMES = 1024;
/** Max consecutive boot quanta without audio before giving up (~4 seconds at 48 kHz / 128 frames). */
const MAX_BOOT_QUANTA = 1500;
/** Overload window: if > OVERLOAD_LIMIT of the last OVERLOAD_WINDOW quanta exceed the deadline, self-stop. */
const OVERLOAD_WINDOW = 48;
const OVERLOAD_LIMIT = 28;

const nowMs = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function jitImports(getExports: () => Fm1Exports) {
	let next: number | undefined;
	return {
		fm1_jit_compile(ptr: number, len: number, hRead: number, hWrite: number, hOp: number): number {
			try {
				const x = getExports();
				const bytes = new Uint8Array(x.memory.buffer, ptr, len).slice();
				const table = x.__indirect_function_table;
				const env = { memory: x.memory, h_read: table.get(hRead), h_write: table.get(hWrite), h_op: table.get(hOp) };
				const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env });
				if (next === undefined || next >= table.length) {
					next = table.length;
					table.grow(256);
				}
				const slot = next++;
				table.set(slot, inst.exports.run as WebAssembly.ExportValue);
				return slot;
			} catch {
				return 0;
			}
		},
	};
}

class Fm1Processor extends AudioWorkletProcessor {
	private x?: Fm1Exports;
	private module?: WebAssembly.Module;
	private disposed = false;
	private paused = false;
	private mhz = 240;
	private playing = false;
	private bootQuanta = 0;
	private budget = 0;
	private views?: { l: Float32Array; r: Float32Array };
	private overrunRing = new Uint8Array(OVERLOAD_WINDOW);
	private overrunPos = 0;
	private overrunSum = 0;

	constructor(options?: { processorOptions?: { module?: WebAssembly.Module } }) {
		super(options);
		this.module = options?.processorOptions?.module;
		this.port.onmessage = (event: MessageEvent<ToFm1Worklet>) => {
			const m = event.data;
			if (m.t === 'boot') void this.boot(m);
			else if (m.t === 'pause') {
				this.paused = m.paused;
			} else if (m.t === 'midi' && this.x) {
				this.paused = false;
				for (const b of m.bytes) this.x.fm1_midi(b);
			} else if (m.t === 'stop' && this.x) {
				// All notes off (CC 123) on all 16 channels, then pause so stopped songs cost 0% CPU.
				for (let ch = 0; ch < 16; ch++) {
					this.x.fm1_midi(0xb0 | ch);
					this.x.fm1_midi(123);
					this.x.fm1_midi(0);
				}
				this.paused = true;
			} else if (m.t === 'dispose') {
				this.x = undefined;
				this.disposed = true;
			}
		};
	}

	private async boot(m: Extract<ToFm1Worklet, { t: 'boot' }>): Promise<void> {
		try {
			if (!this.module) {
				if (!m.wasm) throw new Error('missing fm1-emu wasm module');
				this.module = await WebAssembly.compile(m.wasm);
			}
			let x!: Fm1Exports;
			const inst = await WebAssembly.instantiate(this.module, { env: jitImports(() => x) });
			x = inst.exports as unknown as Fm1Exports;
			x.fm1_jit(1, 16);
			x.fm1_ahead?.(AHEAD_FRAMES);
			const pkgPtr = x.fm1_alloc(m.pkg.byteLength);
			new Uint8Array(x.memory.buffer, pkgPtr, m.pkg.byteLength).set(new Uint8Array(m.pkg));
			const mhz = m.mhz ?? 240;
			if (x.fm1_boot_fwsc(pkgPtr, m.pkg.byteLength, 0, 0, mhz) !== 0) {
				throw new Error('not a valid FM-1 .fwsc firmware package');
			}
			this.x = x;
			this.mhz = mhz;
			this.playing = false;
			this.paused = false;
			this.bootQuanta = 0;
			// Small boot chunk (~0.6x quantum of emulated time per audio block) so booting never blocks
			// Chromium's real-time audio render thread for 500ms and never stalls Strudel's mix.
			this.budget = (mhz * 1e6 * 0.6 * 128) / (sampleRate || 48000);
			this.views = undefined;
			this.overrunRing.fill(0);
			this.overrunPos = 0;
			this.overrunSum = 0;
			this.port.postMessage({ t: 'ready' } satisfies FromFm1Worklet);
		} catch (error) {
			this.port.postMessage({ t: 'error', message: String((error as Error)?.message ?? error) } satisfies FromFm1Worklet);
		}
	}

	private recordTiming(tookMs: number, quantumMs: number): boolean {
		const over = tookMs > quantumMs * 1.15 ? 1 : 0;
		this.overrunSum -= this.overrunRing[this.overrunPos];
		this.overrunRing[this.overrunPos] = over;
		this.overrunSum += over;
		this.overrunPos = (this.overrunPos + 1) % OVERLOAD_WINDOW;
		return this.overrunSum >= OVERLOAD_LIMIT;
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		if (this.disposed) return false;
		const out = outputs[0];
		const leftOut = out[0];
		const rightOut = out[1];
		const n = leftOut.length;
		const x = this.x;
		if (!x || this.paused) {
			leftOut.fill(0);
			rightOut?.fill(0);
			return true;
		}
		const t0 = nowMs();
		let have: number;
		try {
			have = x.fm1_render(n, this.budget);
		} catch (error) {
			leftOut.fill(0);
			rightOut?.fill(0);
			this.x = undefined;
			this.disposed = true;
			this.port.postMessage({ t: 'error', message: `fm1 render trap: ${String((error as Error)?.message ?? error)}` } satisfies FromFm1Worklet);
			return false;
		}
		const took = nowMs() - t0;
		const quantumMs = (n / (sampleRate || 48000)) * 1000;

		if (!this.playing) {
			leftOut.fill(0);
			rightOut?.fill(0);
			if (have > 0) {
				this.playing = true;
				this.budget = (this.mhz * 1e6 * 1.2 * n) / (sampleRate || 48000);
				this.overrunRing.fill(0);
				this.overrunPos = 0;
				this.overrunSum = 0;
			} else if (++this.bootQuanta > MAX_BOOT_QUANTA) {
				this.x = undefined;
				this.disposed = true;
				this.port.postMessage({
					t: 'overload',
					message: 'firmware did not start audio in time in WebAssembly - use Run Native (fm1-live) instead',
				} satisfies FromFm1Worklet);
				return false;
			}
			return true;
		}

		if (this.recordTiming(took, quantumMs)) {
			leftOut.fill(0);
			rightOut?.fill(0);
			this.x = undefined;
			this.disposed = true;
			this.port.postMessage({
				t: 'overload',
				message: `exceeded real-time audio budget (${took.toFixed(1)} ms > ${quantumMs.toFixed(1)} ms) - use Run Native (fm1-live) for smooth 240 MHz JIT`,
			} satisfies FromFm1Worklet);
			return false;
		}

		if (have <= 0) {
			leftOut.fill(0);
			rightOut?.fill(0);
			return true;
		}

		const buffer = x.memory.buffer;
		const lp = x.fm1_out_l();
		const rp = x.fm1_out_r();
		if (!this.views || this.views.l.buffer !== buffer || this.views.l.length !== n || this.views.l.byteOffset !== lp || this.views.r.byteOffset !== rp) {
			this.views = { l: new Float32Array(buffer, lp, n), r: new Float32Array(buffer, rp, n) };
		}
		// Sanitize every sample: a single NaN/Infinity injected into superdough's summingNode would
		// permanently latch downstream filters/reverb/delay to silence until the AudioContext restarts.
		const srcL = this.views.l;
		const srcR = this.views.r;
		for (let i = 0; i < n; i++) {
			const lv = srcL[i];
			leftOut[i] = Number.isFinite(lv) ? (lv > 2 ? 2 : lv < -2 ? -2 : lv) : 0;
			if (rightOut) {
				const rv = srcR[i];
				rightOut[i] = Number.isFinite(rv) ? (rv > 2 ? 2 : rv < -2 ? -2 : rv) : 0;
			}
		}
		return true;
	}
}

registerProcessor('strdltn-fm1', Fm1Processor);
