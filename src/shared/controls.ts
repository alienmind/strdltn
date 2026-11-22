// Music Controls: Play, Stop, Record and BPM, at the top of the Library view. They act on
// the song the Mixer shows. The Mixer's host keeps that song and its model; the Browser's
// host passes this state to the Library page and the clicks back. Both sides import this.

export type TransportAction = 'play' | 'stop' | 'record' | 'render';

/** Strudel's tempo when a song sets none: 0.5 cycles a second (cyclist.mjs of @strudel/core 1.2.6), 4 beats a cycle. */
export const DEFAULT_BPM = 120;

export interface ControlsState {
	/** The file name of the song, or undefined before any song was in front. */
	song?: string;
	/** True once the song's code has been read: before, there is nothing to set a tempo on. */
	known: boolean;
	/** The song's `setcpm()` or `setcps()`; undefined when it has none (Strudel's default plays). `bpm` undefined: not a plain number. */
	tempo?: { bpm?: number };
	playing: boolean;
	/** Record is on: what plays goes to a .wav and .mp3 next to the song. */
	recording?: boolean;
	/** A render of the whole song is being made, offline. */
	rendering?: boolean;
}

export type FromControls =
	/** Play, Stop, Record (on and off) and Render. */
	| { type: 'transport'; action: TransportAction }
	/** The BPM box: a number writes `setcpm(<bpm>/4)`, none (a double click) takes it out. */
	| { type: 'tempo'; bpm?: number };
