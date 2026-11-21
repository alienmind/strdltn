// Messages between the extension host and the Mixer view. Both sides import this file.
import type { MixerModel } from './chains.ts';
import type { ScopeFrame } from './protocol.ts';

/** Strudel's tempo when a song sets none: 0.5 cycles a second (cyclist.mjs of @strudel/core 1.2.6), 4 beats a cycle. */
export const DEFAULT_BPM = 120;

/** The two views of the page: the strips (Mixer), and Play, Stop, Record and BPM (Music Controls). */
export type MixerRole = 'mixer' | 'controls';

export type ToMixer =
	/** Which of the two views this page is. Sent first, after `ready`. */
	| { type: 'role'; role: MixerRole }
	/**
	 * The song in front and its model. `model` is undefined when no song was in front yet.
	 * `error` says the code does not parse right now; `model` is then the last one that did.
	 */
	| { type: 'model'; song?: string; model?: MixerModel; error?: string }
	/** Folds and unfolds strips by name, as a click would. For the integration test. */
	| { type: 'show'; unfold: string[] }
	/** The waves of the song's inline scopes. The page draws each under the strip it is in. */
	| { type: 'scopes'; scopes: ScopeFrame[] }
	/** Whether the song shown plays, for the Play and Stop buttons. */
	| { type: 'playing'; on: boolean };

export type FromMixer =
	| { type: 'ready' }
	/** Put the cursor of the editor at the start of a chain. */
	| { type: 'reveal'; chain: number }
	/** The BPM box: a number writes `setcpm(<bpm>/4)`, none (a double click) takes it out. */
	| { type: 'tempo'; bpm?: number }
	/** The Play and Stop buttons of the top bar. */
	| { type: 'transport'; action: 'play' | 'stop' }
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
