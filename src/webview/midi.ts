// MIDI for songs, under upstream's names: `.midi()`, `midin()`, `midikeys()`, `midimaps()`
// and `defaultmidimap()`. Upstream's `@strudel/midi` needs WebMIDI, which a webview may
// not use, so these do what it does with the device calls replaced by messages to the
// extension host (src/extension/midi.ts). A note leaves here when the scheduler triggers
// it, about 100 ms before it sounds, with the host time it is due; the host's worker
// sends it then. Pure rules are in src/shared/midi.ts.
// @credits Strudel contributors
import { getControlName, getCps, getIsStarted, getPattern, getTime, getTriggerFunc, Hap, isPattern, noteToMidi, Pattern, ref, reify, TimeSpan } from '@strudel/core';
import { getAudioContext } from '@strudel/webaudio';
import { ClockOffset, epochNow, findPort, hapMessages, MIDI_DEFAULTS, unifyMap, type MidiConfig, type MidiMap, type MidiOut, type MidiPorts } from '../shared/midi';
import type { FromWebview, ToWebview } from '../shared/protocol';

let post: (message: FromWebview) => void = () => undefined;
let log: (level: 'info' | 'warn' | 'error', message: string) => void = () => undefined;
const clock = new ClockOffset();
const maps = new Map<string, MidiMap>();
let ports: MidiPorts | undefined;
let portsWaiting: ((ports: MidiPorts) => void)[] = [];
let started = false;
let pingId = 0;
let outbox: MidiOut[] = [];

export function initMidi(postMessage: (message: FromWebview) => void, logLine: typeof log): void {
	post = postMessage;
	log = logLine;
}

/** The scope of a song: these replace nothing upstream, as `@strudel/midi` is not loaded. */
export const midiScope = { midin, midikeys, midimaps, defaultmidimap };

/** A message of the host for MIDI. False when it is not one. */
export function midiMessage(message: ToWebview): boolean {
	switch (message.type) {
		case 'midiPorts':
			ports = message.ports;
			for (const resolve of portsWaiting.splice(0)) resolve(message.ports);
			return true;
		case 'midiPong':
			clock.add(message.sent, message.now, epochNow());
			return true;
		case 'midiIn':
			received(message.port, message.bytes);
			return true;
		default:
			return false;
	}
}

/** The song stopped: the host drops our queued events and turns our notes off. */
export function midiStopped(): void {
	if (started) post({ type: 'midiPanic' });
}

/** The first MIDI call of a song starts the bridge, and from then the clock is measured. */
function start(): void {
	if (started) return;
	started = true;
	const ping = () => post({ type: 'midiPing', id: ++pingId, sent: epochNow() });
	// A few close together for a first good guess, then one every few seconds.
	for (let i = 0; i < 5; i++) setTimeout(ping, i * 40);
	setInterval(ping, 5000);
}

function portList(): Promise<MidiPorts> {
	start();
	if (ports) return Promise.resolve(ports);
	return new Promise((resolve, reject) => {
		portsWaiting.push(resolve);
		setTimeout(() => reject(new Error('[midi] the extension host gave no MIDI ports. MIDI works on desktop VS Code only.')), 5000);
	});
}

/**
 * Host time of an AudioContext time, as heard: `getOutputTimestamp` says which context
 * time the speakers play at which performance time, so MIDI lines up with the sound and
 * not with the moment superdough schedules it.
 */
function hostTime(audioTime: number): number {
	const ac = getAudioContext();
	const stamp = ac.getOutputTimestamp?.();
	const perf =
		stamp?.performanceTime && stamp.contextTime !== undefined
			? stamp.performanceTime + (audioTime - stamp.contextTime) * 1000
			: performance.now() + (audioTime - ac.currentTime + (ac.outputLatency || 0) + (ac.baseLatency || 0)) * 1000;
	return performance.timeOrigin + perf + clock.offset;
}

function queue(events: MidiOut[]): void {
	if (!outbox.length) {
		// The haps of one scheduler tick go in one message.
		queueMicrotask(() => {
			post({ type: 'midiOut', events: outbox });
			outbox = [];
		});
	}
	outbox.push(...events);
}

/** Said once per text, so a missing map does not fill the log at every note. */
const said = new Set<string>();
function sayOnce(message: string): void {
	if (said.has(message)) return;
	said.add(message);
	log('warn', message);
}

/**
 * A device name in double quotes, which Strudel reads as mini-notation: "MPK mini 3" is a pattern of three words in one
 * cycle. Its words joined again are the name. Upstream refuses such a pattern; we take it, as the name is what the
 * user meant. Undefined for a pattern that is not a plain list of words.
 */
function nameOf(value: unknown): unknown {
	if (!isPattern(value)) return value;
	const words = (value as any).firstCycle().map((hap: any) => hap.value);
	return words.length && words.every((w: unknown) => typeof w === 'string' || typeof w === 'number') ? words.join(' ') : undefined;
}

(Pattern.prototype as any).midi = function (this: any, midiport?: string | number | Record<string, any>, options: Partial<MidiConfig> = {}) {
	midiport = nameOf(midiport) as typeof midiport;
	if (midiport === undefined && arguments.length && isPattern(arguments[0])) throw new Error(`.midi does not accept a pattern for the port. Pass the device name in single quotes, for example .midi('${ports?.outputs[0] ?? 'IAC Driver Bus 1'}')`);
	// For backward compatibility, as upstream: .midi({ port, isController, ... })
	if (midiport && typeof midiport === 'object') {
		const { port, isController = false, ...rest } = midiport;
		options = { isController, ...rest, ...options };
		midiport = port;
	}
	const config: MidiConfig = { ...MIDI_DEFAULTS, midiport: midiport as string | number | undefined, ...options };
	start();
	return this.onTrigger((hap: any, _now: number, cps: number, targetTime: number) => {
		hap.ensureObjectValue?.();
		const value = hap.value;
		try {
			const durationMs = (hap.duration.valueOf() / cps) * 1000;
			const cycleStart = hap.whole?.begin.valueOf() === 0;
			const messages = hapMessages(value, config, durationMs, maps, (n) => noteToMidi(n), cycleStart);
			const at = hostTime(targetTime) + config.latencyMs;
			const port = value.midiport ?? config.midiport;
			queue(messages.map((m) => ({ port, bytes: m.bytes, at: at + m.offset })));
		} catch (error) {
			sayOnce(`[midi] ${(error as Error).message}`);
		}
	});
};

/**
 * Configures the default midimap, used when no `midimap` is set.
 * @example defaultmidimap({ lpf: 74 })
 */
export function defaultmidimap(mapping: Record<string, any>): void {
	maps.set('default', unifyMap(mapping, getControlName));
}

const mapLoads: Record<string, Promise<any>> = {};

/** Named midimaps, picked with `.midimap('name')`. A string loads a `midimap.json`; `github:user/repo` from that repository. */
export async function midimaps(map: string | Record<string, Record<string, any>>): Promise<void> {
	if (typeof map === 'string') {
		let url = map;
		if (url.startsWith('github:')) {
			let repo = url.slice('github:'.length).replace(/\/$/, '');
			if (repo.split('/').length === 2) repo += '/main';
			url = `https://raw.githubusercontent.com/${repo}/midimap.json`;
		}
		mapLoads[url] ??= fetch(url).then((r) => r.json());
		map = await mapLoads[url];
	}
	if (map && typeof map === 'object') for (const [name, mapping] of Object.entries(map)) maps.set(name, unifyMap(mapping, getControlName));
}

/** The last value of each CC per input, 0 to 1, as a whole and per channel (1 to 16). */
const ccs: Record<string, Record<number, number>> = {};
const ccsByChannel: Record<string, Record<number, Record<number, number>>> = {};
/** What each midikeys() input does with a note. */
const keyListeners: Record<string, (note: number, velocity: number) => void> = {};

function received(port: string, bytes: number[]): void {
	const [statusByte, a, b] = bytes;
	const kind = statusByte & 0xf0;
	const channel = (statusByte & 15) + 1;
	if (kind === 0xb0 && ccs[port]) {
		ccs[port][a] = b / 127;
		(ccsByChannel[port][a] ??= {})[channel] = b / 127;
	} else if (kind === 0x90 && b > 0) keyListeners[port]?.(a, b);
}

async function openInput(given: string | number | undefined): Promise<string> {
	const input = nameOf(given) as string | number | undefined;
	if (input === undefined && isPattern(given)) throw new Error(`[midi] an input cannot be a pattern. Pass the device name in single quotes, for example midin('${ports?.inputs[0] ?? 'IAC Driver Bus 1'}')`);
	const list = await portList();
	const name = findPort(list.inputs, input);
	if (!name) throw new Error(`[midi] MIDI device "${input ?? ''}" not found. Connected: ${list.inputs.map((n) => `'${n}'`).join(' | ') || 'none'}`);
	post({ type: 'midiListen', port: name });
	return name;
}

/**
 * Opens a MIDI input. Returns `cc(n, channel?)`, a pattern with the last value of CC `n`, 0 to 1.
 * @example const cc = await midin('MPK mini 3'); note("c a f e").lpf(cc(0).range(0, 1000))
 */
export async function midin(input?: string | number): Promise<(cc: number, channel?: number) => unknown> {
	const name = await openInput(input);
	ccs[name] ??= {};
	ccsByChannel[name] ??= {};
	return (cc: number, channel?: number) => (channel !== undefined ? ref(() => ccsByChannel[name][cc]?.[channel] || 0) : ref(() => ccs[name][cc] || 0));
}

/** Notes played on a midikeys() input since the scheduler last asked. */
const keyHaps: Record<string, any[]> = {};

/**
 * Plays the notes of the haps that came from a key at once, as upstream does, rather than
 * waiting for the scheduler's next tick.
 */
function triggerKeys(name: string, cps: number, now: number, latencyCycles: number): boolean {
	const pattern = getPattern() as any;
	const trigger = getTriggerFunc() as any;
	if (!pattern || !trigger) return false;
	const t = now + latencyCycles;
	const haps = pattern.queryArc(t - 1e-6, t + 1e-6, { _cps: cps }).filter((hap: any) => hap.value?.midikey?.startsWith(`${name}_`));
	if (!haps.length) return false;
	const audioNow = getAudioContext().currentTime;
	for (const hap of haps) {
		if (!hap.hasOnset()) continue;
		const at = audioNow + (hap.whole.begin - now) / cps;
		trigger(hap, at - audioNow, hap.duration / cps, cps, at);
	}
	return true;
}

/**
 * Opens a MIDI keyboard. Returns `kb(noteLength?)`, a pattern of the notes being played,
 * each `noteLength` cycles long (superdough needs the length when a note starts).
 * @example const kb = await midikeys('KeyStep'); kb().s("tri")
 */
export async function midikeys(input?: string | number): Promise<(noteLength?: unknown) => unknown> {
	const name = await openInput(input);
	keyHaps[name] ??= [];
	keyListeners[name] = (note, velocity) => {
		if (!getIsStarted()) return;
		const cps = (getCps() as number | undefined) ?? 0.5;
		const canTrigger = !!(getPattern() && getTriggerFunc());
		const latencySeconds = canTrigger ? 0.01 : 0.06;
		const now = getTime() as number;
		const t = now + latencySeconds * cps;
		const span = new TimeSpan(t, t);
		keyHaps[name].push(new Hap(span, span, { midikey: `${name}_${note}`, note, velocity: velocity / 127 }, {}));
		if (canTrigger && triggerKeys(name, cps, now, latencySeconds * cps)) keyHaps[name] = [];
	};
	return (noteLength: unknown = 0.5) => {
		const lengths = reify(noteLength) as any;
		return new Pattern((state: any) => {
			const haps = keyHaps[name].flatMap((hap: any) =>
				lengths.query(state.setSpan(hap.wholeOrPart())).map((lengthHap: any) => {
					const length = lengthHap.value ?? 0.5;
					const whole = new TimeSpan(hap.whole.begin, hap.whole.begin.add(length));
					const part = new TimeSpan(hap.part.begin, hap.part.begin.add(length));
					return new Hap(whole, part, hap.value, hap.combineContext(lengthHap));
				}),
			);
			if (state.controls.cyclist) keyHaps[name] = [];
			return haps;
		});
	};
}
