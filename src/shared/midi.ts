// MIDI through the extension host: what the webview, the host and its worker thread share.
// A webview may not use WebMIDI (see the drawer), so our `.midi()` turns each hap into
// bytes with the time they are due, and the worker sends them on that time (spike S5,
// "MIDI" in doc/ARCHITECTURE.md). Pure functions, so the rules have unit tests.
// @credits Strudel contributors

/** Bytes for one port, due at `at`: milliseconds on the host's clock (`epochNow`). */
export interface MidiEvent {
	port: string;
	bytes: number[];
	at: number;
}

/** What an engine sends: the port as the song names it (see findPort), resolved by the worker. */
export interface MidiOut {
	port?: string | number;
	bytes: number[];
	at: number;
}

export interface MidiPorts {
	outputs: string[];
	inputs: string[];
}

/** The same clock on both sides of the bridge: epoch milliseconds with sub-millisecond steps. */
export function epochNow(): number {
	return performance.timeOrigin + performance.now();
}

/** The second argument of a knob of `midin`: a channel, as upstream, or ours with a starting value. */
export interface KnobOptions {
	channel?: number;
	/** The value until the knob first sends one. 0 when not given, as upstream. */
	start?: number;
}

/** `cc(n, 2)` and `cc(n, { channel: 2, start: .5 })` alike. A start outside 0 to 1 is clamped, as a CC value is. */
export function knobOptions(second: number | KnobOptions | undefined): { channel?: number; start: number } {
	if (typeof second === 'number') return { channel: second, start: 0 };
	const start = typeof second?.start === 'number' && Number.isFinite(second.start) ? Math.min(1, Math.max(0, second.start)) : 0;
	return { channel: typeof second?.channel === 'number' ? second.channel : undefined, start };
}

/**
 * The port a song means, as upstream picks it: a number is an index, a name matches
 * exactly or as a part of the port's name, nothing means the first IAC port or else the
 * first port. Undefined when there is no such port.
 */
export function findPort(names: string[], want: string | number | undefined): string | undefined {
	if (!names.length) return undefined;
	if (typeof want === 'number') return names[want];
	if (typeof want === 'string' && want) return names.find((n) => n === want) ?? names.find((n) => n.includes(want));
	return names.find((n) => n.includes('IAC')) ?? names[0];
}

/** One mapping of a midimap: a control name to a CC number, with the range of the control. */
export interface CcMapping {
	ccn: number;
	min?: number;
	max?: number;
	exp?: number;
}

export type MidiMap = Record<string, CcMapping>;

/** Upstream's normalization: the value in its range to 0..1, then the curve. */
export function normalize(value = 0, min = 0, max = 1, exp = 1): number {
	if (min === max) throw new Error('min and max cannot be the same value');
	const n = Math.min(1, Math.max(0, (value - min) / (max - min)));
	return Math.pow(n, exp);
}

/** `{ lpf: 74 }` to `{ lpf: { ccn: 74 } }`, with each key as the control's main name. */
export function unifyMap(map: Record<string, number | CcMapping>, controlName: (key: string) => string = (k) => k): MidiMap {
	return Object.fromEntries(Object.entries(map).map(([key, m]) => [controlName(key), typeof m === 'number' ? { ccn: m } : m]));
}

/** What `.midi()` was called with, merged with upstream's defaults. */
export interface MidiConfig {
	isController: boolean;
	/** The note off goes this much before the end of the note, so a repeated note is not cut. */
	noteOffsetMs: number;
	midichannel: number;
	velocity: number;
	gain: number;
	midimap: string;
	midiport?: string | number;
	/** Added to every event's time, to line MIDI up with the sound. */
	latencyMs: number;
}

export const MIDI_DEFAULTS: MidiConfig = {
	isController: false,
	noteOffsetMs: 10,
	midichannel: 1,
	velocity: 0.9,
	gain: 1,
	midimap: 'default',
	latencyMs: 0,
};

/** Bytes with an offset in milliseconds from the hap's start. */
export interface Timed {
	bytes: number[];
	offset: number;
}

const byte7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
const status = (kind: number, channel: number) => kind | ((Math.max(1, Math.min(16, Math.round(channel))) - 1) & 15);

function checkBytes(list: unknown, what: string): number[] {
	const array = Array.isArray(list) ? list : [list];
	if (!array.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error(`${what}: every byte must be an integer from 0 to 255`);
	return array as number[];
}

/**
 * The MIDI messages of one hap, as upstream's `.midi()` sends them: the note with its
 * note off, the CCs of the midimap and of `ccn`/`ccv`, program change, sysex, NRPN, pitch
 * bend, aftertouch, and `midicmd`. `durationMs` is the hap's length. `toMidi` turns a note
 * name into a number. Throws on a value upstream refuses, with upstream's reason.
 */
export function hapMessages(value: Record<string, any>, config: MidiConfig, durationMs: number, maps: Map<string, MidiMap>, toMidi: (note: string) => number, cycleStart = false): Timed[] {
	const out: Timed[] = [];
	const at0 = (bytes: number[]) => out.push({ bytes, offset: 0 });
	const chan = value.midichan ?? config.midichannel;
	const velocity = (value.gain ?? config.gain) * (value.velocity ?? config.velocity);
	const cc = (ccn: number, ccv: number) => {
		if (typeof ccv !== 'number' || ccv < 0 || ccv > 1) throw new Error('expected ccv to be a number between 0 and 1');
		at0([status(0xb0, chan), byte7(ccn), byte7(ccv * 127)]);
	};

	const mapName = value.midimap ?? config.midimap;
	const map = maps.get(mapName);
	if (map) {
		for (const key of Object.keys(value)) {
			const m = map[key];
			if (m && typeof value[key] === 'number') cc(m.ccn, normalize(value[key], m.min, m.max, m.exp));
		}
	} else if (mapName !== 'default') {
		throw new Error(`midimap "${mapName}" not found. Maps: ${[...maps.keys()].join(', ') || 'none'}`);
	}

	if (value.note !== undefined && !config.isController) {
		if (value.note === null || value.note === '') throw new Error('note cannot be null or empty');
		if (velocity < 0 || velocity > 1) throw new Error('velocity must be a number between 0 and 1');
		const note = byte7(typeof value.note === 'number' ? value.note : toMidi(value.note));
		// A velocity that rounds to 0 would be a note off.
		out.push({ bytes: [status(0x90, chan), note, Math.max(1, byte7(velocity * 127))], offset: 0 });
		out.push({ bytes: [status(0x80, chan), note, 0], offset: Math.max(0, durationMs - config.noteOffsetMs) });
	}

	if (value.progNum !== undefined) {
		if (typeof value.progNum !== 'number' || value.progNum < 0 || value.progNum > 127) throw new Error('expected progNum (program change) to be a number between 0 and 127');
		at0([status(0xc0, chan), byte7(value.progNum)]);
	}
	if (value.sysexid !== undefined && value.sysexdata !== undefined) at0(sysex(value.sysexid, value.sysexdata));
	if (value.ccn !== undefined && value.ccv !== undefined) cc(value.ccn, value.ccv);
	if (value.nrpnn !== undefined && value.nrpv !== undefined) {
		const [pm, pl] = Array.isArray(value.nrpnn) ? value.nrpnn : [value.nrpnn >> 7, value.nrpnn & 127];
		const [vm, vl] = Array.isArray(value.nrpv) ? value.nrpv : [value.nrpv >> 7, value.nrpv & 127];
		const s = status(0xb0, chan);
		for (const [n, v] of [[99, pm], [98, pl], [6, vm], [38, vl]]) at0([s, n, byte7(v)]);
	}
	if (value.midibend !== undefined) {
		if (typeof value.midibend !== 'number' || value.midibend < -1 || value.midibend > 1) throw new Error('expected midibend to be a number between -1 and 1');
		const v = Math.round(((value.midibend + 1) / 2) * 16383);
		at0([status(0xe0, chan), v & 127, v >> 7]);
	}
	if (value.miditouch !== undefined) {
		if (typeof value.miditouch !== 'number' || value.miditouch < 0 || value.miditouch > 1) throw new Error('expected miditouch to be a number between 0 and 1');
		at0([status(0xd0, chan), byte7(value.miditouch * 127)]);
	}

	// Upstream sends a start at the song's first cycle, where it has the time for it.
	if (cycleStart) at0([0xfa]);
	const cmd = value.midicmd;
	if (cmd === 'clock' || cmd === 'midiClock') at0([0xf8]);
	else if (cmd === 'start') at0([0xfa]);
	else if (cmd === 'stop') at0([0xfc]);
	else if (cmd === 'continue') at0([0xfb]);
	else if (Array.isArray(cmd)) {
		if (cmd[0] === 'progNum') at0([status(0xc0, chan), byte7(cmd[1])]);
		else if (cmd[0] === 'cc' && cmd.length === 3) at0([status(0xb0, chan), byte7(cmd[1]), byte7(cmd[2])]);
		else if (cmd[0] === 'sysex' && cmd.length === 3) at0(sysex(cmd[1], cmd[2]));
	}
	return out;
}

function sysex(id: unknown, data: unknown): number[] {
	if (!Array.isArray(data)) throw new Error('expected sysex to be an array of numbers (0-255)');
	return [0xf0, ...checkBytes(id, 'sysexid'), ...checkBytes(data, 'sysexdata'), 0xf7];
}

/**
 * The offset from the webview's clock to the host's, from pings. Each ping gives a guess
 * and its round trip; the guess with the shortest round trip of the last ones wins, as
 * a slow answer says little about when the host read its clock.
 */
export class ClockOffset {
	private samples: { rtt: number; offset: number }[] = [];
	private readonly keep: number;
	constructor(keep = 8) {
		this.keep = keep;
	}

	add(sent: number, hostNow: number, received: number): void {
		this.samples.push({ rtt: received - sent, offset: hostNow - (sent + received) / 2 });
		if (this.samples.length > this.keep) this.samples.shift();
	}

	get known(): boolean {
		return this.samples.length > 0;
	}

	get offset(): number {
		let best = this.samples[0];
		for (const s of this.samples) if (s.rtt < best.rtt) best = s;
		return best?.offset ?? 0;
	}
}

/** A note that sounds, to be turned off on a panic. */
interface Held {
	port: string;
	channel: number;
	note: number;
	source: string;
}

/**
 * The worker's queue: events ordered by time, each with the engine it came from, and the
 * notes that are on, so a stop leaves no note hanging.
 */
export class MidiQueue {
	private events: (MidiEvent & { source: string })[] = [];
	private held: Held[] = [];

	get size(): number {
		return this.events.length;
	}

	/** Milliseconds until the next event, or undefined when the queue is empty. */
	next(now: number): number | undefined {
		return this.events.length ? this.events[0].at - now : undefined;
	}

	add(source: string, list: MidiEvent[]): void {
		for (const e of list) {
			// Mostly in order already: walk from the end.
			let i = this.events.length;
			while (i > 0 && this.events[i - 1].at > e.at) i--;
			this.events.splice(i, 0, { ...e, source });
		}
	}

	/** Takes the events due before `until`, and keeps track of the notes they turn on and off. */
	take(until: number): (MidiEvent & { source: string })[] {
		let n = 0;
		while (n < this.events.length && this.events[n].at <= until) n++;
		const due = this.events.splice(0, n);
		for (const e of due) this.track(e);
		return due;
	}

	/** Drops the events of `source` (all when undefined) and gives the note offs for its held notes. */
	panic(source?: string): MidiEvent[] {
		const mine = (s: string) => source === undefined || s === source;
		this.events = this.events.filter((e) => !mine(e.source));
		const off = this.held.filter((h) => mine(h.source));
		this.held = this.held.filter((h) => !mine(h.source));
		return off.map((h) => ({ port: h.port, bytes: [0x80 | (h.channel & 15), h.note, 0], at: 0 }));
	}

	private track(e: MidiEvent & { source: string }): void {
		const [s, note, velocity] = e.bytes;
		const kind = s & 0xf0;
		const channel = s & 15;
		if (kind !== 0x80 && kind !== 0x90) return;
		const at = this.held.findIndex((h) => h.port === e.port && h.channel === channel && h.note === note);
		if (at >= 0) this.held.splice(at, 1);
		if (kind === 0x90 && velocity > 0) this.held.push({ port: e.port, channel, note, source: e.source });
	}
}

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/** One MIDI message as text, for the debug lines in the Output: `CC 70 = 64 (ch 1)`, `note on c3 (48) vel 100 (ch 1)`. */
export function describeMidi(bytes: number[]): string {
	const [s, a = 0, b = 0] = bytes;
	const ch = ` (ch ${(s & 15) + 1})`;
	const note = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1} (${n})`;
	switch (s & 0xf0) {
		case 0x80:
			return `note off ${note(a)}${ch}`;
		case 0x90:
			return b === 0 ? `note off ${note(a)}${ch}` : `note on ${note(a)} vel ${b}${ch}`;
		case 0xa0:
			return `aftertouch ${note(a)} = ${b}${ch}`;
		case 0xb0:
			return `CC ${a} = ${b}${ch}`;
		case 0xc0:
			return `program ${a}${ch}`;
		case 0xd0:
			return `aftertouch = ${a}${ch}`;
		case 0xe0:
			return `pitch bend ${(((b << 7) | a) / 8191.5 - 1).toFixed(2)}${ch}`;
	}
	const system: Record<number, string> = { 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop', 0xfe: 'active sensing' };
	if (s === 0xf0) return `sysex ${bytes.length} bytes`;
	return system[s] ?? bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ');
}
