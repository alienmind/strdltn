// Standalone Browser preview engine for when no song is actively playing (including with no .strudel window open).
// Handles samples, wavetables, plain waves, noise, ALL Strudel synths/soundfonts (via lazily initialized superdough),
// and VIBE FM-1 firmwares (in a temporary AudioWorkletNode). Every preview is time-limited to one loop (120 BPM = 2 s
// by default), fades out smoothly over 0.5 s, and disposes its nodes cleanly.
import * as strudelSoundfonts from '@strudel/soundfonts';
import * as strudelWebaudio from '@strudel/webaudio';
import { unzipSync } from 'fflate';
import { PREVIEW_FADE, type PreviewPlan, previewCycleSeconds } from '../shared/preview.ts';
import type { FromFm1Worklet, ToFm1Worklet } from '../webview/fm1/worklet.ts';
import type { ToVibeWorklet } from '../webview/vibe/worklet.ts';

let audio: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const wasmModules = new Map<string, Promise<WebAssembly.Module>>();
const binaryCache = new Map<string, Promise<ArrayBuffer>>();
let vibeWorkletReady: Promise<void> | undefined;
let fm1WorkletReady: Promise<void> | undefined;
let superdoughReady: Promise<void> | undefined;
let activeStop: (() => void) | undefined;
let previewSeq = 0;

export interface ActiveSamplePlay {
	url: string;
	startedAt: number;
	playDuration: number;
	begin: number;
	end: number;
	ctx: AudioContext;
}

let activeSample: ActiveSamplePlay | undefined;
const stateListeners = new Set<(active: ActiveSamplePlay | undefined) => void>();

/** Subscribes to Browser sample playback start/end so waveform canvases can animate their playhead. */
export function onSamplePlay(listener: (active: ActiveSamplePlay | undefined) => void): () => void {
	stateListeners.add(listener);
	return () => stateListeners.delete(listener);
}

export function currentSamplePlay(): ActiveSamplePlay | undefined {
	return activeSample;
}

function setActiveSample(next: ActiveSamplePlay | undefined): void {
	activeSample = next;
	for (const listener of stateListeners) listener(next);
}

/** Fetches and decodes a sample URL once, reusing the Browser preview buffer cache for waveform rendering. */
export function decodeSampleUrl(url: string): Promise<AudioBuffer> {
	let buffer = buffers.get(url);
	if (!buffer) {
		const ctx = getContext();
		buffer = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`${response.status} for ${url}`);
				return response.arrayBuffer();
			})
			.then((bytes) => ctx.decodeAudioData(bytes));
		buffers.set(url, buffer);
		buffer.catch(() => buffers.delete(url));
	}
	return buffer;
}

/** Smoothly fades out and disposes whatever preview is currently playing in the Browser. */
export function stopPreview(): void {
	previewSeq++;
	activeStop?.();
	activeStop = undefined;
	if (activeSample) setActiveSample(undefined);
}

function getContext(): AudioContext {
	if (!audio || audio.state === 'closed') {
		audio = new AudioContext();
		vibeWorkletReady = undefined;
		fm1WorkletReady = undefined;
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

	if (plan.kind === 'fm1') {
		try {
			fm1WorkletReady ??= ctx.audioWorklet.addModule(plan.workletUrl).catch((error) => {
				fm1WorkletReady = undefined;
				throw error;
			});
			const fetchBin = (url: string) => {
				let p = binaryCache.get(url);
				if (!p) {
					p = fetch(url)
						.then((r) => {
							if (!r.ok) throw new Error(`${r.status} for ${url}`);
							return r.arrayBuffer();
						})
						.catch((error) => {
							binaryCache.delete(url);
							throw error;
						});
					binaryCache.set(url, p);
				}
				return p;
			};
			const [, emu, pkg] = await Promise.all([fm1WorkletReady, fetchBin(plan.emuUrl), fetchBin(plan.url)]);
			if (seq !== previewSeq) return;
			const node = new AudioWorkletNode(ctx, 'strdltn-fm1', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
			});
			const gain = ctx.createGain();
			node.connect(gain);
			gain.connect(ctx.destination);

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
				if (activeStop === stop) activeStop = undefined;
			};
			const stop = () => {
				if (disposed) return;
				timers.forEach(clearTimeout);
				const t = ctx.currentTime;
				gain.gain.cancelScheduledValues(t);
				gain.gain.setValueAtTime(gain.gain.value, t);
				gain.gain.linearRampToValueAtTime(0, t + 0.03);
				timers.push(setTimeout(disposeNow, 50));
			};
			activeStop = stop;

			await new Promise<void>((resolveReady, rejectReady) => {
				node.port.onmessage = (event: MessageEvent<FromFm1Worklet>) => {
					if (event.data.t === 'ready') resolveReady();
					else rejectReady(new Error(event.data.message));
				};
				node.port.postMessage({ t: 'boot', wasm: emu.slice(0), pkg: pkg.slice(0) } satisfies ToFm1Worklet);
			});
			if (seq !== previewSeq || disposed) return disposeNow();

			const startAt = ctx.currentTime + 0.05;
			timers.push(setTimeout(() => node.port.postMessage({ t: 'midi', bytes: [0x90, 57, 100] } satisfies ToFm1Worklet), 50));
			timers.push(setTimeout(() => node.port.postMessage({ t: 'midi', bytes: [0x80, 57, 0] } satisfies ToFm1Worklet), Math.ceil(duration * 1000) + 50));
			gain.gain.setValueAtTime(1, startAt);
			gain.gain.setValueAtTime(1, startAt + duration);
			gain.gain.linearRampToValueAtTime(0, startAt + duration + PREVIEW_FADE);
			timers.push(setTimeout(disposeNow, Math.ceil((duration + PREVIEW_FADE) * 1000) + 140));
			log(`preview: fm1:${plan.id} (${ctx.state})`);
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
			// superdough's Orbit exposes `output` (stereo GainNode) in superdoughoutput.mjs.
			const outGain: GainNode | undefined = (orbit as any)?.output;
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
				{ s: plan.name, n: plan.index, orbit: 99, gain: 0.7, clip: 1, release: PREVIEW_FADE, ...(plan.pitched ? { note: 'a3' } : {}) },
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
	let sampleOffset = 0;
	let sampleRangeDuration: number | undefined;
	let sampleUrl: string | undefined;
	let sampleBegin = 0;
	let sampleEnd = 1;
	try {
		if (plan.kind === 'sample') {
			const decoded = await decodeSampleUrl(plan.url);
			if (seq !== previewSeq) {
				gain.disconnect();
				return;
			}
			const node = ctx.createBufferSource();
			node.buffer = decoded;
			sampleUrl = plan.url;
			sampleBegin = Math.max(0, Math.min(0.98, plan.begin ?? 0));
			sampleEnd = Math.max(sampleBegin + 0.02, Math.min(1, plan.end ?? 1));
			if (plan.loop) {
				// One cycle of a wavetable, looped at A3 for one preview loop, then faded out.
				node.loop = true;
				node.playbackRate.value = 220 * decoded.duration;
			} else {
				sampleOffset = sampleBegin * decoded.duration;
				const sliceLen = Math.max(0.02, (sampleEnd - sampleBegin) * decoded.duration);
				if (sliceLen <= duration) {
					length = sliceLen;
					fade = Math.min(0.05, length * 0.2);
				}
				sampleRangeDuration = Math.min(sliceLen, length + fade);
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
	if (source instanceof AudioBufferSourceNode && sampleRangeDuration !== undefined) {
		source.start(now, sampleOffset, sampleRangeDuration);
	} else {
		source.start(now);
		source.stop(stopAt + 0.02);
	}
	if (sampleUrl && !(plan.kind === 'sample' && plan.loop)) {
		setActiveSample({ url: sampleUrl, startedAt: now, playDuration: Math.max(0.02, length), begin: sampleBegin, end: sampleEnd, ctx });
	}

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
		if (sampleUrl && activeSample?.url === sampleUrl && activeSample.startedAt === now) setActiveSample(undefined);
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
