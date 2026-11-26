// AudioWorklet processor running real M-VAVE FM-1 hardware firmwares (.fwsc) via fm1-emu's WebAssembly emulator
// (github.com/joakimeriksson/fm1-emu, MIT). Built on its own into dist/fm1-worklet.js.
// @credits Joakim Eriksson (fm1-emu)

declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

export type ToFm1Worklet =
	| { t: 'boot'; wasm: ArrayBuffer; pkg: ArrayBuffer; mhz?: number }
	| { t: 'midi'; bytes: number[] }
	| { t: 'stop' }
	| { t: 'dispose' };

export type FromFm1Worklet =
	| { t: 'ready' }
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
	private mhz = 240;
	private playing = false;
	private budget = 240e6 * 0.02;
	private views?: { l: Float32Array; r: Float32Array };

	constructor() {
		super();
		this.port.onmessage = (event: MessageEvent<ToFm1Worklet>) => {
			const m = event.data;
			if (m.t === 'boot') void this.boot(m);
			else if (m.t === 'midi' && this.x) {
				for (const b of m.bytes) this.x.fm1_midi(b);
			} else if (m.t === 'stop' && this.x) {
				// All notes off (CC 123) on all 16 channels.
				for (let ch = 0; ch < 16; ch++) {
					this.x.fm1_midi(0xb0 | ch);
					this.x.fm1_midi(123);
					this.x.fm1_midi(0);
				}
			} else if (m.t === 'dispose') {
				this.x = undefined;
				this.disposed = true;
			}
		};
	}

	private async boot(m: Extract<ToFm1Worklet, { t: 'boot' }>): Promise<void> {
		try {
			this.module ??= await WebAssembly.compile(m.wasm);
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
			this.budget = mhz * 1e6 * 0.02;
			this.views = undefined;
			this.port.postMessage({ t: 'ready' } satisfies FromFm1Worklet);
		} catch (error) {
			this.port.postMessage({ t: 'error', message: String((error as Error)?.message ?? error) } satisfies FromFm1Worklet);
		}
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		if (this.disposed) return false;
		const x = this.x;
		if (!x) return true;
		const out = outputs[0];
		const n = out[0].length;
		let have: number;
		try {
			have = x.fm1_render(n, this.budget);
		} catch (error) {
			this.x = undefined;
			this.port.postMessage({ t: 'error', message: `fm1 render trap: ${String((error as Error)?.message ?? error)}` } satisfies FromFm1Worklet);
			return false;
		}
		const buffer = x.memory.buffer;
		const lp = x.fm1_out_l();
		const rp = x.fm1_out_r();
		if (!this.views || this.views.l.buffer !== buffer || this.views.l.length !== n || this.views.l.byteOffset !== lp || this.views.r.byteOffset !== rp) {
			this.views = { l: new Float32Array(buffer, lp, n), r: new Float32Array(buffer, rp, n) };
		}
		out[0].set(this.views.l);
		if (out[1]) out[1].set(this.views.r);
		if (have > 0 && !this.playing) {
			this.playing = true;
			this.budget = (this.mhz * 1e6 * 1.5 * n) / sampleRate;
		}
		return true;
	}
}

registerProcessor('strdltn-fm1', Fm1Processor);
