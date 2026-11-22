// Messages between the extension host and the Mixer view. Both sides import this file.
import type { MixerModel } from './chains.ts';
import type { ScopeFrame } from './protocol.ts';

export type ToMixer =
	/**
	 * The song in front and its model. `model` is undefined when no song was in front yet.
	 * `error` says the code does not parse right now; `model` is then the last one that did.
	 */
	| { type: 'model'; song?: string; model?: MixerModel; error?: string }
	/** Folds and unfolds strips by name, as a click would. For the integration test. */
	| { type: 'show'; unfold: string[] }
	/** The waves of the song's inline scopes. The page draws each under the strip it is in. */
	| { type: 'scopes'; scopes: ScopeFrame[] }
	/** Whether the song shown plays. The scopes go flat when it stops. */
	| { type: 'playing'; on: boolean }
	/** A slider moved live in the song (a drag, a knob), before the code says so. By where its number starts. */
	| { type: 'sliderLive'; from: number; value: number };

export type FromMixer =
	| { type: 'ready' }
	/** Put the cursor of the editor at the start of a chain. */
	| { type: 'reveal'; chain: number }
	/** A cable from the duck jack of `from` dropped on the strip of `to`. `move`: the orbit of a cable pulled off another strip. */
	| { type: 'duck'; from: number; to: number; move?: number }
	/** A cable pulled off its strip and dropped on nothing. */
	| { type: 'unduck'; from: number; orbit: number }
	/** M or S of a chain clicked: the host flips `_` or `S` in its label. */
	| { type: 'toggle'; chain: number; button: 'mute' | 'solo' | 'gain' | 'scope' }
	/** A fader moved: the slider by its index in the model, and the number as it is to be written. */
	| { type: 'slider'; index: number; value: string }
	/** What the page shows, after it has drawn. For the integration test. */
	| { type: 'state'; strips: { name: string; unfolded: boolean; faders: number }[]; cables: number }
	| { type: 'log'; message: string };
