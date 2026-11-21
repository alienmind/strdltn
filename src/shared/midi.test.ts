// Cases for the MIDI rules in midi.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClockOffset, findPort, hapMessages, MIDI_DEFAULTS, MidiQueue, normalize, unifyMap, type MidiMap } from './midi.ts';

const none = new Map<string, MidiMap>();
const toMidi = (name: string) => ({ c4: 60, a4: 69 })[name] ?? NaN;

test('a port is found by index, by name, by part of a name, or the first IAC', () => {
	const ports = ['Microsoft GS Wavetable Synth', 'IAC Driver Bus 1', 'UMC404HD 192k MIDI Out'];
	assert.equal(findPort(ports, 2), 'UMC404HD 192k MIDI Out');
	assert.equal(findPort(ports, 'UMC404HD'), 'UMC404HD 192k MIDI Out');
	assert.equal(findPort(ports, undefined), 'IAC Driver Bus 1');
	assert.equal(findPort(['a', 'b'], undefined), 'a');
	assert.equal(findPort(ports, 'MPK mini 3'), undefined);
	assert.equal(findPort([], undefined), undefined);
});

test('a note gives a note on with the velocity and a note off before its end', () => {
	const m = hapMessages({ note: 'c4', midichan: 2 }, MIDI_DEFAULTS, 500, none, toMidi);
	assert.deepEqual(m, [
		{ bytes: [0x91, 60, 114], offset: 0 },
		{ bytes: [0x81, 60, 0], offset: 490 },
	]);
	// gain scales the velocity; a velocity that rounds to 0 stays a note on.
	assert.equal(hapMessages({ note: 60, gain: 0.5, velocity: 1 }, MIDI_DEFAULTS, 100, none, toMidi)[0].bytes[2], 64);
	assert.equal(hapMessages({ note: 60, velocity: 0.001 }, MIDI_DEFAULTS, 100, none, toMidi)[0].bytes[2], 1);
	// A controller sends no notes.
	assert.deepEqual(hapMessages({ note: 60 }, { ...MIDI_DEFAULTS, isController: true }, 100, none, toMidi), []);
	assert.throws(() => hapMessages({ note: 60, velocity: 2 }, MIDI_DEFAULTS, 100, none, toMidi), /velocity/);
});

test('controls become their messages', () => {
	const bytes = (value: Record<string, unknown>) => hapMessages(value, MIDI_DEFAULTS, 100, none, toMidi).map((t) => t.bytes);
	assert.deepEqual(bytes({ ccn: 74, ccv: 0.5 }), [[0xb0, 74, 64]]);
	assert.deepEqual(bytes({ progNum: 5, midichan: 10 }), [[0xc9, 5]]);
	assert.deepEqual(bytes({ midibend: 0 }), [[0xe0, 0, 64]]);
	assert.deepEqual(bytes({ midibend: 1 }), [[0xe0, 127, 127]]);
	assert.deepEqual(bytes({ miditouch: 1 }), [[0xd0, 127]]);
	assert.deepEqual(bytes({ sysexid: 0x43, sysexdata: [1, 2] }), [[0xf0, 0x43, 1, 2, 0xf7]]);
	assert.deepEqual(bytes({ nrpnn: 130, nrpv: 5 }), [[0xb0, 99, 1], [0xb0, 98, 2], [0xb0, 6, 0], [0xb0, 38, 5]]);
	assert.deepEqual(bytes({ midicmd: 'clock' }), [[0xf8]]);
	assert.deepEqual(bytes({ midicmd: 'stop' }), [[0xfc]]);
	assert.deepEqual(bytes({ midicmd: ['cc', 7, 100] }), [[0xb0, 7, 100]]);
	assert.throws(() => bytes({ ccn: 1, ccv: 3 }), /ccv/);
	assert.throws(() => bytes({ progNum: 200 }), /progNum/);
	assert.throws(() => bytes({ sysexid: 300, sysexdata: [1] }), /sysexid/);
});

test('a midimap turns named controls into CCs, scaled into the range', () => {
	assert.equal(normalize(500, 0, 1000), 0.5);
	assert.equal(normalize(2000, 0, 1000), 1);
	assert.equal(normalize(0.25, 0, 1, 0.5), 0.5);
	const maps = new Map([['synth', unifyMap({ lpf: { ccn: 74, min: 0, max: 1000 }, room: 91 })]]);
	const m = hapMessages({ lpf: 500, room: 1, midimap: 'synth' }, MIDI_DEFAULTS, 100, maps, toMidi);
	assert.deepEqual(m.map((t) => t.bytes), [[0xb0, 74, 64], [0xb0, 91, 127]]);
	assert.throws(() => hapMessages({ midimap: 'nope' }, MIDI_DEFAULTS, 100, maps, toMidi), /not found/);
});

test('the clock offset trusts the shortest round trip', () => {
	const clock = new ClockOffset();
	assert.equal(clock.known, false);
	clock.add(0, 1050, 100); // slow: guesses 1000
	clock.add(200, 1205, 210); // fast: guesses 1000
	clock.add(300, 1400, 310); // fast and later: guesses 1095
	assert.equal(clock.offset, 1000);
	assert.equal(clock.known, true);
});

test('the queue keeps time order and turns held notes off on a panic', () => {
	const q = new MidiQueue();
	q.add('a', [{ port: 'p', bytes: [0x90, 60, 100], at: 20 }, { port: 'p', bytes: [0x80, 60, 0], at: 120 }]);
	q.add('b', [{ port: 'p', bytes: [0x91, 62, 100], at: 10 }]);
	assert.equal(q.next(0), 10);
	assert.deepEqual(q.take(25).map((e) => e.at), [10, 20]);
	assert.equal(q.size, 1);
	// The engine a stops: its note off in the queue goes, and its held note is turned off now.
	assert.deepEqual(q.panic('a'), [{ port: 'p', bytes: [0x80, 60, 0], at: 0 }]);
	assert.equal(q.size, 0);
	assert.deepEqual(q.panic(), [{ port: 'p', bytes: [0x81, 62, 0], at: 0 }]);
	assert.deepEqual(q.panic(), []);
});
