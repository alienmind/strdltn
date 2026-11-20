// The AudioWorklet processor that runs one firmware. Built on its own into dist/vibe-worklet.js, because
// audioWorklet.addModule() takes a script, not a function of the page.
import { VibeCore, type VibeEvent } from './core';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

/** Messages from the page. Frames are context frames (`AudioContext.currentTime * sampleRate`). */
export type ToVibeWorklet =
	| { t: 'events'; events: VibeEvent[] }
	| { t: 'clock'; frame: number; cycle: number; cps: number; playing: boolean }
	| { t: 'stop' };

export type FromVibeWorklet =
	| { t: 'ready'; sdk: number; params: { index: number; id: string; min: number; max: number }[] }
	| { t: 'log'; text: string }
	| { t: 'crash'; error: string };

class VibeProcessor extends AudioWorkletProcessor {
	private core?: VibeCore;
	private started = false;
	/** Where the song is, to fill the firmware's transport table: the cycle at a context frame, and the speed. */
	private clock = { frame: 0, cycle: 0, cps: 0.5, playing: false };

	constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
		super();
		const send = (m: FromVibeWorklet) => this.port.postMessage(m);
		try {
			this.core = new VibeCore(options.processorOptions.module, sampleRate, { log: (text) => send({ t: 'log', text }) });
			send({ t: 'ready', sdk: this.core.sdk, params: this.core.params.map(({ index, id, min, max }) => ({ index, id, min, max })) });
		} catch (error) {
			send({ t: 'crash', error: String((error as Error)?.message ?? error) });
		}
		this.port.onmessage = (event: MessageEvent<ToVibeWorklet>) => {
			const m = event.data;
			if (!this.core) return;
			if (m.t === 'events') for (const e of m.events) this.core.schedule(e);
			else if (m.t === 'clock') this.clock = m;
			else if (m.t === 'stop') this.core.stop();
		};
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const core = this.core;
		if (!core) return false;
		// The firmware's timeline starts at the context's frame, so the page can schedule in context frames.
		if (!this.started) {
			core.frame = currentFrame;
			this.started = true;
		}
		const [left, right] = outputs[0];
		const { frame, cycle, cps, playing } = this.clock;
		// Strudel counts cycles, a firmware quarter notes. A cycle is one bar of four, as setcpm(bpm / 4) assumes.
		const at = cycle + ((currentFrame - frame) / sampleRate) * cps;
		core.setTransport({ playing, bpm: cps * 240, beat: Math.max(0, at * 4) });
		try {
			core.render(left, right ?? new Float32Array(left.length));
		} catch (error) {
			// A trap leaves the firmware in an unknown state. Silence it rather than play garbage.
			this.port.postMessage({ t: 'crash', error: String((error as Error)?.message ?? error) } satisfies FromVibeWorklet);
			this.core = undefined;
			return false;
		}
		return true;
	}
}

registerProcessor('strdltn-vibe', VibeProcessor);
