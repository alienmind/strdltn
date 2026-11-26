// Standalone Browser preview engine for when no song is actively playing (including with no .strudel window open).
// Handles samples, wavetables, plain waves, noise, ALL Strudel synths/soundfonts (via lazily initialized superdough),
// and VIBE FM-1 firmwares (in a temporary AudioWorkletNode). Every preview is time-limited to one loop (120 BPM = 2 s
// by default), fades out smoothly over 0.5 s, and disposes its nodes cleanly.
import * as strudelSoundfonts from '@strudel/soundfonts';
import * as strudelWebaudio from '@strudel/webaudio';
import { unzipSync } from 'fflate';
import { PREVIEW_FADE, type PreviewPlan, previewCycleSeconds } from '../shared/preview.ts';
import type { ToVibeWorklet } from '../webview/vibe/worklet.ts';

let audio: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const wasmModules = new Map<string, Promise<WebAssembly.Module>>();
let vibeWorkletReady: Promise<void> | undefined;
let superdoughReady: Promise<void> | undefined;
let activeStop: (() => void) | undefined;
let previewSeq = 0;

/** Smoothly fades out and disposes whatever preview is currently playing in the Browser. */
export function stopPreview(): void {
	previewSeq++;
	activeStop?.();
	activeStop = undefined;
}

function getContext(): AudioContext {
	if (!audio || audio.state === 'closed') {
		audio = new AudioContext();
		vibeWorkletReady = undefined;
		superdoughReady = undefined;
	}
	// Not awaited: without a click in the page (the integration test sends the message from the host) the promise may
	// never settle. With a real click, the context runs immediately.
	if (audio.state === 'suspended') void audio.resume();
	return audio;
}

async function ensureSuperdough(ctx: AudioContext): Promise<void> {
	if (!superdoughReady) {
		superdoughReady = (async () => {
			strudelWebaudio.setAudioContext(ctx);
			strudelWebaudio.setSuperdoughAudioController(undefined as any);
			await strudelWebaudio.initAudio();
			await Promise.all([
				strudelWebaudio.registerSynthSounds(),
				strudelWebaudio.registerZZFXSounds(),
				strudelSoundfonts.registerSoundfonts(),
			]);
		})().catch((error) => {
			superdoughReady = undefined;
			throw error;
		});
	}
	await superdoughReady;
}

async function loadFirmwareModule(url: string): Promise<WebAssembly.Module> {
	let pending = wasmModules.get(url);
	if (!pending) {
		pending = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`${response.status} for ${url}`);
				return response.arrayBuffer();
			})
			.then((buf) => {
				const bytes = new Uint8Array(buf);
				const magic = String.fromCharCode(...bytes.subarray(0, 4));
				if (magic === '\0asm') return WebAssembly.compile(bytes);
				if (magic.startsWith('PK')) {
					const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.wasm') && !f.name.endsWith('.aot.wasm') });
					const name = Object.keys(files).sort()[0];
					if (!name) throw new Error(`no .wasm in ${url}`);
					return WebAssembly.compile(files[name] as Uint8Array<ArrayBuffer>);
				}
				throw new Error(`not a VIBE FM .wasm or .zip: ${url}`);
			})
			.catch((error) => {
				wasmModules.delete(url);
				throw error;
			});
		wasmModules.set(url, pending);
	}
	return pending;
}

export async function playPreview(plan: PreviewPlan, log: (message: string) => void): Promise<void> {
	stopPreview();
	const seq = previewSeq;
	const ctx = getContext();
	const duration = plan.duration ?? previewCycleSeconds();

	if (plan.kind === 'firmware') {
		try {
			vibeWorkletReady ??= ctx.audioWorklet.addModule(plan.workletUrl).catch((error) => {
				vibeWorkletReady = undefined;
				throw error;
			});
			const [, module] = await Promise.all([vibeWorkletReady, loadFirmwareModule(plan.url)]);
			if (seq !== previewSeq) return;
			const node = new AudioWorkletNode(ctx, 'strdltn-vibe', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: { module },
			});
			const gain = ctx.createGain();
			node.connect(gain);
			gain.connect(ctx.destination);

			let disposed = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const disposeNow = () => {
				if (disposed) return;
				disposed = true;
				clearTimeout(timer);
				try {
					node.port.postMessage({ t: 'dispose' } satisfies ToVibeWorklet);
				} catch {
					// Already closed.
				}
				node.disconnect();
				gain.disconnect();
				if (activeStop === stop) activeStop = undefined;
			};
			const stop = () => {
				if (disposed) return;
				clearTimeout(timer);
				const t = ctx.currentTime;
				gain.gain.cancelScheduledValues(t);
				gain.gain.setValueAtTime(gain.gain.value, t);
				gain.gain.linearRampToValueAtTime(0, t + 0.03);
				timer = setTimeout(disposeNow, 50);
			};
			activeStop = stop;

			const startAt = ctx.currentTime + 0.02;
			const rate = ctx.sampleRate;
			const onFrame = Math.round(startAt * rate);
			const offFrame = Math.max(onFrame + 1, Math.round((startAt + duration) * rate));
			const cps = plan.bpm / 240;
			node.port.postMessage({ t: 'clock', frame: onFrame, cycle: 0, cps, playing: true } satisfies ToVibeWorklet);
			node.port.postMessage({
				t: 'events',
				events: [
					{ frame: onFrame, kind: 'tempo', bpm: plan.bpm },
					{ frame: onFrame, kind: 'play', on: true },
					{ frame: onFrame, kind: 'midi', status: 0x90, d1: 57, d2: 100 },
					{ frame: offFrame, kind: 'midi', status: 0x80, d1: 57, d2: 0 },
					{ frame: offFrame, kind: 'play', on: false },
				],
			} satisfies ToVibeWorklet);
			gain.gain.setValueAtTime(1, startAt);
			gain.gain.setValueAtTime(1, startAt + duration);
			gain.gain.linearRampToValueAtTime(0, startAt + duration + PREVIEW_FADE);
			timer = setTimeout(disposeNow, Math.ceil((duration + PREVIEW_FADE) * 1000) + 100);
			log(`preview: vibefm1:${plan.id} (${ctx.state})`);
		} catch (error) {
			log(`preview: ${(error as Error).message}`);
		}
		return;
	}

	if (plan.kind === 'superdough') {
		try {
			await ensureSuperdough(ctx);
			if (seq !== previewSeq) return;
			const startAt = ctx.currentTime + 0.03;
			const controller = strudelWebaudio.getSuperdoughAudioController();
			const orbit = controller.getOrbit(99);
			const outGain: GainNode | undefined = (orbit as any)?.outputGain ?? (orbit as any)?.postgain;
			if (outGain?.gain) {
				outGain.gain.cancelScheduledValues(startAt);
				outGain.gain.setValueAtTime(1, startAt);
				outGain.gain.setValueAtTime(1, startAt + duration);
				outGain.gain.linearRampToValueAtTime(0, startAt + duration + PREVIEW_FADE);
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const stop = () => {
				clearTimeout(timer);
				const t = ctx.currentTime;
				if (outGain?.gain) {
					outGain.gain.cancelScheduledValues(t);
					outGain.gain.setValueAtTime(outGain.gain.value, t);
					outGain.gain.linearRampToValueAtTime(0, t + 0.03);
				}
				if (activeStop === stop) activeStop = undefined;
			};
			activeStop = stop;
			await strudelWebaudio.superdough(
				{ s: plan.name, n: plan.index, orbit: 99, clip: 1, release: PREVIEW_FADE, ...(plan.pitched ? { note: 'a3' } : {}) },
				startAt,
				duration,
			);
			timer = setTimeout(() => {
				if (activeStop === stop) activeStop = undefined;
			}, Math.ceil((duration + PREVIEW_FADE) * 1000) + 120);
			log(`preview: ${plan.name}:${plan.index} (${ctx.state})`);
		} catch (error) {
			log(`preview: ${(error as Error).message}`);
		}
		return;
	}

	// Plain Web Audio: samples, wavetables, oscillators and noise.
	const now = ctx.currentTime + 0.01;
	const gain = ctx.createGain();
	gain.connect(ctx.destination);
	let source: AudioScheduledSourceNode;
	let length = duration;
	let fade = PREVIEW_FADE;
	try {
		if (plan.kind === 'sample') {
			let buffer = buffers.get(plan.url);
			if (!buffer) {
				const url = plan.url;
				buffer = fetch(url)
					.then((response) => {
						if (!response.ok) throw new Error(`${response.status} for ${url}`);
						return response.arrayBuffer();
					})
					.then((bytes) => ctx.decodeAudioData(bytes));
				buffers.set(url, buffer);
				buffer.catch(() => buffers.delete(url));
			}
			const decoded = await buffer;
			if (seq !== previewSeq) {
				gain.disconnect();
				return;
			}
			const node = ctx.createBufferSource();
			node.buffer = decoded;
			if (plan.loop) {
				// One cycle of a wavetable, looped at A3 for one preview loop, then faded out.
				node.loop = true;
				node.playbackRate.value = 220 * decoded.duration;
			} else if (decoded.duration <= duration) {
				// Short one-shot drum hit plays its natural length cleanly.
				length = decoded.duration;
				fade = Math.min(0.05, length * 0.2);
			}
			source = node;
		} else if (plan.kind === 'oscillator') {
			const node = ctx.createOscillator();
			node.type = plan.wave;
			node.frequency.value = 220;
			source = node;
			gain.gain.value = 0.25;
		} else {
			const node = ctx.createBufferSource();
			node.buffer = noise(ctx, plan.color, duration + PREVIEW_FADE);
			source = node;
			gain.gain.value = 0.25;
		}
	} catch (error) {
		gain.disconnect();
		log(`preview: ${(error as Error).message}`);
		return;
	}

	const level = gain.gain.value || 1;
	const stopAt = now + length + fade;
	gain.gain.setValueAtTime(level, now);
	gain.gain.setValueAtTime(level, now + Math.max(0, length));
	gain.gain.linearRampToValueAtTime(0, stopAt);
	source.connect(gain);
	source.start(now);
	source.stop(stopAt + 0.02);

	let disposed = false;
	const cleanup = () => {
		if (disposed) return;
		disposed = true;
		try {
			source.stop();
		} catch {
			// Already stopped.
		}
		source.disconnect();
		gain.disconnect();
		if (activeStop === stop) activeStop = undefined;
	};
	let timer = setTimeout(cleanup, Math.ceil((stopAt - ctx.currentTime) * 1000) + 60);
	const stop = () => {
		if (disposed) return;
		clearTimeout(timer);
		const t = ctx.currentTime;
		gain.gain.cancelScheduledValues(t);
		gain.gain.setValueAtTime(gain.gain.value, t);
		gain.gain.linearRampToValueAtTime(0, t + 0.03);
		timer = setTimeout(cleanup, 50);
	};
	activeStop = stop;
	log(`preview: ${plan.kind === 'sample' ? plan.url.split('/').pop() : plan.kind === 'oscillator' ? plan.wave : `${plan.color} noise`} (${ctx.state})`);
}

/** Noise buffer of `seconds` length. Pink and brown by the usual simple filters. */
function noise(context: AudioContext, color: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
	const buffer = context.createBuffer(1, Math.max(1, Math.ceil(context.sampleRate * seconds)), context.sampleRate);
	const data = buffer.getChannelData(0);
	let last = 0;
	let b0 = 0;
	let b1 = 0;
	let b2 = 0;
	for (let i = 0; i < data.length; i++) {
		const white = Math.random() * 2 - 1;
		if (color === 'white') data[i] = white;
		else if (color === 'brown') {
			last = (last + 0.02 * white) / 1.02;
			data[i] = last * 3.5;
		} else {
			b0 = 0.99765 * b0 + white * 0.099046;
			b1 = 0.963 * b1 + white * 0.2965164;
			b2 = 0.57 * b2 + white * 1.0526913;
			data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
		}
	}
	return buffer;
}
