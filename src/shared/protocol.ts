// Messages between the extension host and a webview. Both sides import this file.
import type { FirmwareCacheMap } from './firmware';
import type { PackInfo } from './packs';

/** 'editor': the webview is the editor of the file. 'stage': code hidden, visuals only. */
export type Mode = 'editor' | 'stage';

/** Sound name -> list of absolute URLs, the shape upstream `samples()` accepts. */
export type SampleMap = Record<string, string[]>;

/** One entry of the engine's sound list, as shown in the Sounds view. */
export interface SoundInfo {
	name: string;
	/** superdough's own type: 'sample', 'synth', 'soundfont', 'wavetable'... */
	type: string;
	/** Set by whoever loaded the sound. We use 'local' and, like strudel.cc, 'drum-machines'. */
	tag?: string;
	/** Number of variations (`name:0`, `name:1`...). 1 for a synth. */
	count: number;
	/** Names for the variations, when they have names: the firmwares of `vibefm1`. Then `name:<variation>` is typed. */
	variations?: string[];
}

/** A VIBE FM firmware the song can play as `s("vibefm1:<id>")`. */
export interface FirmwareInfo {
	/** The firmware's own id, lower case. It is what follows `vibefm1:` in a song. */
	id: string;
	name: string;
	author?: string;
	version?: string;
	license?: string;
	description?: string;
	/** The .wasm, as a webview URL. */
	url: string;
}

/** How the Strudel editor looks. From the settings `strdltn.editor.*`, resolved by the host. */
export interface EditorSettings {
	/** The name of an upstream theme, as in `themes` of `@strudel/codemirror`. */
	theme: string;
	fontFamily: string;
	/** In pixels. */
	fontSize: number;
}

/** What a webview is doing, for the status bar. */
export interface EngineState {
	/** The scheduler runs. */
	started: boolean;
	/** `AudioContext.state`: 'running', 'suspended'... */
	audio: string;
	/** The overlay "Click to enable audio" is up. */
	needsClick: boolean;
}

export type ToWebview =
	| { type: 'init'; text: string; mode: Mode; samples: SampleMap; firmware: FirmwareInfo[]; settings: EditorSettings }
	| { type: 'settings'; settings: EditorSettings }
	| { type: 'update'; text: string }
	| { type: 'samples'; samples: SampleMap }
	| { type: 'firmware'; firmware: FirmwareInfo[] }
	/** Which `firmware('https://...')` addresses of the song have a cached copy, and its URL. */
	| { type: 'firmwareCache'; map: FirmwareCacheMap }
	| { type: 'packs'; packs: PackInfo[] }
	| { type: 'play' }
	| { type: 'stop' }
	| { type: 'preview'; name: string; index: number }
	/** `bare` replaces `text` when the cursor is inside a string: the name alone, not a call. */
	| { type: 'insert'; text: string; bare?: string }
	/** Puts the cursor at an offset of the code, from a click on a strip of the Mixer. */
	| { type: 'select'; offset: number }
	/** Moves a slider of the stage, by its position in the list. The same as dragging it. */
	| { type: 'slider'; index: number; value: number }
	/** The answer to `cacheFiles`. `base` is the address of the cached folder when every file is in it. */
	| { type: 'cachedFiles'; id: number; base?: string };

export type FromWebview =
	| { type: 'ready' }
	| { type: 'edit'; text: string }
	| { type: 'state'; state: EngineState }
	/** An evaluation ended. Without `error` it went well. `from` and `to` are offsets in the code. */
	| { type: 'evaluated'; error?: { message: string; from?: number; to?: number } }
	/** A song called `samples(map, base)` with a remote base. The host says whether it has these files. */
	| { type: 'cacheFiles'; id: number; base: string; files: string[] }
	| { type: 'sounds'; sounds: SoundInfo[] }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

/**
 * The smallest single replacement that turns `before` into `after`, or undefined when
 * they are equal. Both sides send whole texts and apply only this difference, so a
 * change far from the cursor does not move the cursor or reset the scroll position.
 */
export function diffText(before: string, after: string): TextChange | undefined {
	if (before === after) return undefined;
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
		endBefore--;
		endAfter--;
	}
	return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
