// Messages between the extension host and the Mixer view. Both sides import this file.
import type { MixerModel } from './chains.ts';

export type ToMixer =
	/**
	 * The song in front and its model. `model` is undefined when no song was in front yet.
	 * `error` says the code does not parse right now; `model` is then the last one that did.
	 */
	| { type: 'model'; song?: string; model?: MixerModel; error?: string }
	/** Folds and unfolds strips by name, as a click would. For the integration test. */
	| { type: 'show'; unfold: string[] };

export type FromMixer =
	| { type: 'ready' }
	/** Put the cursor of the editor at the start of a chain. */
	| { type: 'reveal'; chain: number }
	/** A fader moved: the slider by its index in the model, and the number as it is to be written. */
	| { type: 'slider'; index: number; value: string }
	/** What the page shows, after it has drawn. For the integration test. */
	| { type: 'state'; strips: { name: string; unfolded: boolean; faders: number }[]; cables: number }
	| { type: 'log'; message: string };
