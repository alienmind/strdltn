// What the Browser plays for a preview when no song is playing. The Results page plays it
// itself with plain Web Audio: the click on the row is a click inside that page, which is
// what a webview needs to start sound. No song, no stage, no Strudel engine. See "Previews
// without a song" in doc/ARCHITECTURE.md.
import type { SoundInfo } from './protocol.ts';

export type PreviewPlan =
	/** A sample file: drum machines, the project's samples, packs. `loop` for a one-cycle wavetable. */
	| { kind: 'sample'; url: string; loop?: boolean }
	/** One of the plain waveforms of superdough. */
	| { kind: 'oscillator'; wave: OscillatorType }
	| { kind: 'noise'; color: 'white' | 'pink' | 'brown' };

/** superdough's names of the plain waveforms, as Web Audio calls them. */
const WAVES: Record<string, OscillatorType> = {
	sine: 'sine',
	square: 'square',
	sawtooth: 'sawtooth',
	saw: 'sawtooth',
	triangle: 'triangle',
	tri: 'triangle',
};
const NOISES = new Set(['white', 'pink', 'brown']);

/**
 * How to play a sound without the engine, or undefined when it needs the engine:
 * soundfonts, supersaw, firmwares and the other synths of superdough.
 */
export function previewPlan(sound: SoundInfo | undefined, index: number): PreviewPlan | undefined {
	if (!sound) return undefined;
	if (sound.type === 'synth') {
		if (WAVES[sound.name]) return { kind: 'oscillator', wave: WAVES[sound.name] };
		if (NOISES.has(sound.name)) return { kind: 'noise', color: sound.name as 'white' | 'pink' | 'brown' };
		return undefined;
	}
	if ((sound.type === 'sample' || sound.type === 'wavetable') && sound.urls?.length) {
		// The same wrap as superdough's getSoundIndex: n past the end starts again.
		const i = ((index % sound.urls.length) + sound.urls.length) % sound.urls.length;
		return { kind: 'sample', url: sound.urls[i], ...(sound.type === 'wavetable' ? { loop: true } : {}) };
	}
	return undefined;
}
