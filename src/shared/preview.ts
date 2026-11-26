// What the Browser plays for a preview when no song is playing, and the timing rules shared with the song's engine.
// Any preview is time-limited (one cycle of the active song, or one cycle at 120 BPM when no song plays), fades out
// smoothly, and disposes its nodes so nothing keeps sounding. See "Previews without a song" in doc/ARCHITECTURE.md.
import type { SoundInfo } from './protocol.ts';

/** Standard tempo when no song sets one (120 BPM, 4 beats/cycle -> 2.0 s per loop). */
export const DEFAULT_PREVIEW_BPM = 120;
/** Smooth fade-out after the preview loop ends, in seconds. */
export const PREVIEW_FADE = 0.5;
/** Bounds on one preview loop so extreme tempos stay practical. */
const MIN_CYCLE_SECONDS = 0.5;
const MAX_CYCLE_SECONDS = 4;

export type PreviewPlan =
	/** A sample file: drum machines, the project's samples, packs. `loop` for a one-cycle wavetable. */
	| { kind: 'sample'; url: string; loop?: boolean; duration?: number; begin?: number; end?: number }
	/** One of the plain waveforms of superdough. */
	| { kind: 'oscillator'; wave: OscillatorType; duration?: number }
	| { kind: 'noise'; color: 'white' | 'pink' | 'brown'; duration?: number }
	/** Any other Strudel synth or soundfont played through superdough in the Browser (supersaw, gm_*, zzfx...). */
	| { kind: 'superdough'; name: string; index: number; pitched: boolean; duration?: number }
	/** A VIBE FM firmware (.wasm or .zip) run in a temporary AudioWorklet in the Browser and disposed after. */
	| { kind: 'firmware'; id: string; url: string; workletUrl: string; bpm: number; duration?: number }
	/** A real FM-1 hardware firmware (.fwsc) emulated in a temporary fm1-emu AudioWorklet and disposed after. */
	| { kind: 'fm1'; id: string; url: string; emuUrl: string; workletUrl: string; bpm: number; duration?: number };

/** Length of one preview loop (1 cycle), clamped to [0.5, 4] s. Defaults to 120 BPM (2.0 s). */
export function previewCycleSeconds(tempo?: { bpm?: number; cps?: number }): number {
	const raw =
		tempo?.cps && tempo.cps > 0
			? 1 / tempo.cps
			: tempo?.bpm && tempo.bpm > 0
				? 240 / tempo.bpm
				: 240 / DEFAULT_PREVIEW_BPM;
	return Math.max(MIN_CYCLE_SECONDS, Math.min(MAX_CYCLE_SECONDS, raw));
}

/** superdough's names of the plain waveforms, as Web Audio calls them. */
const WAVES: Record<string, OscillatorType> = {
	sine: 'sine',
	sin: 'sine',
	square: 'square',
	sqr: 'square',
	sawtooth: 'sawtooth',
	saw: 'sawtooth',
	triangle: 'triangle',
	tri: 'triangle',
};
const NOISES = new Set(['white', 'pink', 'brown']);

/**
 * How to play a sound directly in the Browser when no song is playing. Samples, wavetables, plain waves and noise
 * use plain Web Audio; every other Strudel synth and soundfont uses a lazily initialized superdough preview context.
 * Firmwares are planned separately from their `.wasm` / `.zip` file.
 */
export function previewPlan(sound: SoundInfo | undefined, index: number): PreviewPlan | undefined {
	if (!sound) return undefined;
	if (sound.type === 'synth') {
		if (WAVES[sound.name]) return { kind: 'oscillator', wave: WAVES[sound.name] };
		if (NOISES.has(sound.name)) return { kind: 'noise', color: sound.name as 'white' | 'pink' | 'brown' };
		return { kind: 'superdough', name: sound.name, index, pitched: true };
	}
	if ((sound.type === 'sample' || sound.type === 'wavetable') && sound.urls?.length) {
		// The same wrap as superdough's getSoundIndex: n past the end starts again.
		const i = ((index % sound.urls.length) + sound.urls.length) % sound.urls.length;
		return { kind: 'sample', url: sound.urls[i], ...(sound.type === 'wavetable' ? { loop: true } : {}) };
	}
	if (sound.type === 'soundfont') return { kind: 'superdough', name: sound.name, index, pitched: true };
	if (sound.type === 'sample') return { kind: 'superdough', name: sound.name, index, pitched: false };
	return undefined;
}
