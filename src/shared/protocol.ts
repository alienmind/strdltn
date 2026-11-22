// Messages between the extension host and a webview. Both sides import this file.
import type { DeviceInfo, DeviceRequest } from './devices';
import type { InsertArgument } from './context';
import type { FirmwareCacheMap } from './firmware';
import type { MidiOut, MidiPorts } from './midi';
import type { PackInfo } from './packs';
import type { SyncUpdate } from './sync';

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
	/**
	 * The files of a sample or wavetable, one per variation, as superdough has them (full
	 * addresses). A pitched map gives the files of its note closest to A3. For previews
	 * without the engine (src/shared/preview.ts).
	 */
	urls?: string[];
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
	/** `text` with `\n` line endings, as every text and offset between the two sides. `version` starts the sync, see src/shared/sync.ts. */
	| { type: 'init'; text: string; version: number; mode: Mode; samples: SampleMap; firmware: FirmwareInfo[]; settings: EditorSettings }
	| { type: 'settings'; settings: EditorSettings }
	/** Changes the host accepted, in order: the webview's own, confirmed, and everyone else's. */
	| { type: 'changes'; updates: SyncUpdate[] }
	/** The two sides could not be kept in step. The webview takes this text and version, and drops its unconfirmed changes. */
	| { type: 'reset'; text: string; version: number }
	| { type: 'samples'; samples: SampleMap }
	| { type: 'firmware'; firmware: FirmwareInfo[] }
	/** Which `firmware('https://...')` addresses of the song have a cached copy, and its URL. */
	| { type: 'firmwareCache'; map: FirmwareCacheMap }
	| { type: 'packs'; packs: PackInfo[] }
	| { type: 'play' }
	| { type: 'stop' }
	| { type: 'preview'; name: string; index: number }
	/** `bare` replaces `text` when the cursor is inside a string: the name alone, not a call. */
	| { type: 'insert'; text: string; bare?: string; argument?: InsertArgument }
	/** Puts the cursor at an offset of the code, from a click on a strip of the Mixer. */
	| { type: 'select'; offset: number }
	/**
	 * A fader of the Mixer moved the slider whose number starts at `from` in the code. The
	 * sound changes at once and the number in the code follows. `value` is the text to write.
	 */
	| { type: 'sliderValue'; index: number; from?: number; value: string }
	/** The answer to `cacheFiles`. `base` is the address of the cached folder when every file is in it. */
	| { type: 'cachedFiles'; id: number; base?: string }
	/** A request of the Devices view for one of this engine's firmware copies. */
	| { type: 'device'; request: DeviceRequest }
	/** Record on: play if it does not, and record what plays. Off: stop recording and send the audio. */
	| { type: 'record'; on: boolean }
	/** Render the song offline, `cycles` long, and send the audio. The song stops first. */
	| { type: 'render'; cycles: number }
	/** The MIDI ports of the machine, once the song uses MIDI and when they change. */
	| { type: 'midiPorts'; ports: MidiPorts }
	/** The answer to `midiPing`: the host's clock (`epochNow`) when it read the ping. */
	| { type: 'midiPong'; id: number; sent: number; now: number }
	/** A message from a MIDI input the song listens to. */
	| { type: 'midiIn'; port: string; bytes: number[] }
	/** A VS Code command bound to an editing key (Ctrl+F...) asks CodeMirror to run its action. */
	| { type: 'editorAction'; action: EditorAction }
	/** MIDI learn for the slider under the cursor: the next CC of any input goes into `.knob(...)`. */
	| { type: 'knobLearn' };

/** The editing actions of the Strudel editor that VS Code's keys reach through our commands. */
export type EditorAction = 'find' | 'replace' | 'gotoLine' | 'selectNextMatch' | 'selectAllMatches';

/**
 * The level of one chain at one moment, for the pump meter of the Mixer: it jumps by the
 * gain of each note the chain plays and decays between them. `chain` is the label as the
 * song writes it (`$kick`), `$#2` for the third anonymous `$:`, empty for a song without labels.
 */
export interface ScopeFrame {
	chain: string;
	level: number;
	/**
	 * The chain's real audio, left and right: the loudest sample of the last 50 ms in dBFS (0 is full scale, above 0
	 * clips at the speakers), null for silence. Read from a meter the engine puts after each of the chain's notes.
	 * `chain` is `@master` for the whole mix.
	 */
	peak?: [number | null, number | null];
}

export type FromWebview =
	| { type: 'ready' }
	/** The webview's unconfirmed changes, on top of `version`. Dropped by the host when it has moved on. */
	| { type: 'push'; version: number; updates: SyncUpdate[] }
	| { type: 'state'; state: EngineState }
	/** An evaluation ended. Without `error` it went well. `from` and `to` are offsets in the code. */
	| { type: 'evaluated'; error?: { message: string; from?: number; to?: number } }
	/** A song called `samples(map, base)` with a remote base. The host says whether it has these files. */
	| { type: 'cacheFiles'; id: number; base: string; files: string[] }
	| { type: 'sounds'; sounds: SoundInfo[] }
	/** The level of each chain while the song plays, about 20 times a second, for the Mixer. */
	| { type: 'scopes'; scopes: ScopeFrame[] }
	/** The firmware copies that run, for the Devices view. Sent when one starts or ends. */
	| { type: 'devices'; devices: DeviceInfo[] }
	/** A display frame (480 x 320 RGB565) and the parameters' values of a copy a panel shows. */
	| { type: 'frame'; key: string; px: Uint8Array; values: number[] }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
	/**
	 * A recording or a render, as a 16-bit stereo WAV. `peak` is the loudest sample before it was written, 1 being full
	 * scale: a recording keeps what was heard, so above 1 it clipped.
	 */
	| { type: 'audio'; kind: 'record' | 'render'; wav: Uint8Array; seconds: number; peak?: number }
	| { type: 'audioError'; kind: 'record' | 'render'; message: string }
	/** Measures the clock offset to the host, see ClockOffset in src/shared/midi.ts. The first one starts the MIDI bridge. */
	| { type: 'midiPing'; id: number; sent: number }
	/** Notes and messages with the host time they are due, sent about 100 ms early. */
	| { type: 'midiOut'; events: MidiOut[] }
	| { type: 'midiListen'; port: string }
	/** The song stopped: drop this engine's queued events and turn its notes off. */
	| { type: 'midiPanic' }
	/** A slider's value changed live (a drag, a knob, a fader): `from` is where its number is now. For the Mixer. */
	| { type: 'sliderLive'; from: number; value: number }
	/** Where MIDI learn is: waiting for a knob, done with a CC, no slider at the cursor, no knob moved, no MIDI. */
	| { type: 'knobLearn'; state: 'waiting' | 'done' | 'noSlider' | 'timeout' | 'noMidi'; cc?: number };

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
