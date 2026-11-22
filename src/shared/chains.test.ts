// Cases for the Mixer's model in chains.ts. Run with `pnpm test:unit`.
// When a strip of the Mixer is wrong, add the code that produced it here first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_BPM, duckEdits, type Edits, gainEdit, labelEdit, type MixerModel, readChains, scopeEdit, tempoEdit, toggledLabel, unduckEdits } from './chains.ts';

function model(code: string): MixerModel {
	const result = readChains(code);
	if ('error' in result) throw new Error(result.error);
	return result;
}

/** A chain as a short line: name, gain fader, sub-controls, orbit. */
function strips(m: MixerModel) {
	return m.chains.map((chain) => ({
		name: chain.name,
		gain: chain.gain === undefined ? undefined : `${m.sliders[chain.gain].label} (${m.sliders[chain.gain].constant ?? '-'})`,
		controls: chain.controls.map((i) => `${m.sliders[i].label} (${m.sliders[i].constant ?? '-'})`),
		orbit: chain.orbit,
	}));
}

test('demo.strudel gives the table of the plan', () => {
	const m = model(readFileSync(new URL('../../template/demo.strudel', import.meta.url), 'utf8'));
	assert.deepEqual(strips(m), [
		{ name: 'vocals', gain: 'gain (VOCALS_VOL)', controls: ['delay (VOCALS_ECHO)'], orbit: 6 },
		{ name: 'kick', gain: 'gain (KICK_VOL)', controls: [], orbit: 1 },
		{ name: 'snare', gain: 'gain (SNARE_VOL)', controls: [], orbit: 1 },
		{ name: 'clap', gain: 'gain (CLAP_VOL)', controls: [], orbit: 1 },
		{ name: 'hh', gain: 'gain (HH_VOL)', controls: [], orbit: 1 },
		{ name: 'hhr', gain: 'gain (HHR_VOL)', controls: ['lpf (HATS_OPEN)'], orbit: 1 },
		{ name: 'bass', gain: 'gain (BASS_VOL)', controls: ['acid (BASS_SQUELCH)', 'lpf (BASS_CUTOFF_MUL)'], orbit: 2 },
		{ name: 'acid', gain: 'gain (ACID_VOL)', controls: ['dist (ACID_DRIVE)'], orbit: 3 },
		{ name: 'riser', gain: 'gain (RISER_VOL)', controls: ['hpf (RISER_OPEN)'], orbit: 4 },
		{ name: 'pad', gain: 'gain (PAD_VOL)', controls: ['lpf (PAD_OPEN)', 'room (PAD_SPACE)'], orbit: 5 },
	]);
	const name = (i?: number) => (i === undefined ? undefined : m.chains[i].name);
	assert.deepEqual(
		m.ducks.map((d) => [name(d.from), name(d.to), d.orbit]),
		[
			['kick', 'bass', 2],
			['kick', 'acid', 3],
			['kick', 'riser', 4],
			['kick', 'pad', 5],
		],
	);
	assert.equal(m.sliders.length, 18);
	assert.deepEqual(m.global, []);
	assert.equal(m.sliders[0].detail, 'kick vol');
});

test('a slider that scales a curve names the call the curve feeds', () => {
	const m = model('const OPEN = slider(1, .5, 2)\n$pad: s("supersaw").lpf(saw.range(200, 900).mul(OPEN)).gain(slider(.3))');
	assert.deepEqual(strips(m), [{ name: 'pad', gain: 'gain (-)', controls: ['lpf (OPEN)'], orbit: 1 }]);
});

test('a slider written in the chain', () => {
	const m = model('$bass: note("c2").lpf(slider(800, 200, 4000)).gain(slider(.5))');
	assert.deepEqual(strips(m), [{ name: 'bass', gain: 'gain (-)', controls: ['lpf (-)'], orbit: 1 }]);
	assert.deepEqual([m.sliders[0].min, m.sliders[0].max, m.sliders[0].value], [200, 4000, 800]);
	assert.deepEqual([m.sliders[1].min, m.sliders[1].max], [0, 1]);
});

test('the call a slider feeds, through a method on it', () => {
	const m = model('const V = slider(.5)\n$a: s("bd").gain(V.mul(2))\n$b: s("hh").lpf(sine.range(200, slider(900, 0, 2000)))');
	assert.equal(m.chains[0].gain, 0);
	assert.equal(m.sliders[1].label, 'range');
});

test('a slider used by two chains shows in both', () => {
	const m = model('const V = slider(.5)\n$a: s("bd").gain(V)\n$b: s("hh").gain(V)');
	assert.deepEqual(m.sliders[0].chains, [0, 1]);
	assert.equal(m.chains[0].gain, 0);
	assert.equal(m.chains[1].gain, 0);
});

test('a second gain slider is a sub-control', () => {
	const m = model('$a: s("bd").gain(slider(.5)).gain(slider(.7))');
	assert.equal(m.chains[0].gain, 0);
	assert.deepEqual(m.chains[0].controls, [1]);
});

test('a slider of no chain goes to global', () => {
	const m = model('const T = slider(120, 60, 180)\nsetcps(T/60/4)\nconst U = slider(1)\n$: s("bd")');
	assert.deepEqual(m.global, [0, 1]);
	assert.equal(m.sliders[0].label, 'setcps');
	assert.equal(m.sliders[1].label, 'u');
});

test('a constant made of a constant', () => {
	const m = model('const V = slider(.5)\nconst LOUD = V.mul(2)\n$a: s("bd").gain(LOUD)');
	assert.equal(m.chains[0].gain, 0);
	assert.equal(m.sliders[0].constant, 'V');
});

test('names, mute and solo by upstream rules', () => {
	const m = model('_$kick: s("bd")\nhats_: s("hh")\nS$snare: s("sd")\nSnare: s("sd")\n// Rolling hats\n$: s("hh*16")');
	assert.deepEqual(
		m.chains.map((c) => [c.name, c.muted, c.solo]),
		[
			['kick', true, false],
			['hats', true, false],
			['snare', false, true],
			// Upstream solos any label that starts with S, so `Snare:` is a solo. We say so.
			['Snare', false, true],
			['Rolling hats', false, false],
		],
	);
	assert.equal(m.chains[4].nameRule, 'comment');
});

test('orbit and duck: literal, list forms, unknown', () => {
	const m = model(
		[
			'$k: s("bd").duck("2:3")',
			'$a: s("x").orbit(2)',
			'$b: s("x").orbit("3")',
			'$c: s("x").orbit(pick([1, 2], 0))',
			'$d: s("x").orbit(2).sometimes(x => x.orbit(5))',
			'$e: s("x").duck("<2 3>")',
			'$f: s("x").duck(7)',
		].join('\n'),
	);
	assert.deepEqual(
		m.chains.map((c) => c.orbit),
		[1, 2, 3, undefined, undefined, 1, 1],
	);
	assert.deepEqual(m.chains[0].ducks, [2, 3]);
	assert.equal(m.chains[5].duckUnknown, true);
	assert.deepEqual(
		m.ducks.map((d) => [d.from, d.to, d.orbit]),
		[
			[0, 1, 2],
			[0, 2, 3],
			[6, undefined, 7],
		],
	);
});

test('duck "1" reaches every chain on the default orbit, not itself', () => {
	const m = model('$k: s("bd").duck(1)\n$a: s("x")\n$b: s("y").orbit(2)');
	assert.deepEqual(
		m.ducks.map((d) => [d.from, d.to]),
		[[0, 1]],
	);
});

test('code that does not parse gives an error, not a model', () => {
	assert.ok('error' in readChains('$a: s("bd"'));
});

test('slider order is the order of the code, as the transpiler counts', () => {
	const m = model('$a: s("x").gain(slider(.1))\nconst B = slider(.2)\n$b: s("y").gain(B)');
	assert.deepEqual(
		m.sliders.map((s) => s.value),
		[0.1, 0.2],
	);
});

test('a top level await and comments in a chain parse', () => {
	const m = model('await initHydra()\n$kick: s("bd")\n  // a comment\n  .gain(slider(.5))\n.duck("2")');
	assert.equal(m.chains[0].gain, 0);
	assert.deepEqual(m.chains[0].ducks, [2]);
});

test('M and S write upstream labels and keep each other', () => {
	const cases: [string, 'mute' | 'solo', string][] = [
		['$kick', 'mute', '_$kick'],
		['_$kick', 'mute', '$kick'],
		['kick_', 'mute', 'kick'],
		['$kick', 'solo', 'S$kick'],
		['S$kick', 'solo', '$kick'],
		['_$kick', 'solo', 'S$kick_'],
		['S$kick', 'mute', 'S$kick_'],
		['S$kick_', 'mute', 'S$kick'],
		['S$kick_', 'solo', '_$kick'],
		['$', 'mute', '_$'],
		['$', 'solo', 'S$'],
		['lowendbass', 'solo', 'Slowendbass'],
	];
	for (const [label, button, expected] of cases) assert.equal(toggledLabel(label, button), expected, `${label} ${button}`);
	// What upstream reads from the result, by the parser's own rules.
	const both = model('S$kick_: s("bd")');
	assert.deepEqual([both.chains[0].muted, both.chains[0].solo], [true, true]);
});

test('a click on M edits the label of that chain only', () => {
	const code = '$kick: s("bd*4")\n$hat: s("hh*8")\n';
	const edit = labelEdit(code, 1, 'mute');
	assert.deepEqual(edit, { from: 17, to: 21, insert: '_$hat' });
	assert.equal(labelEdit('$kick: s("bd"', 0, 'mute'), undefined);
});

test('G adds a gain fader and takes it out again', () => {
	const apply = (code: string, e?: { from: number; to: number; insert: string }) => (e ? code.slice(0, e.from) + e.insert + code.slice(e.to) : code);
	// No gain: one at the end of the chain, before the semicolon.
	const plain = '$riser: s("pulse").orbit(4);\n';
	const on = apply(plain, gainEdit(plain, 0));
	assert.equal(on, '$riser: s("pulse").orbit(4).gain(slider(1, 0, 1));\n');
	assert.notEqual(model(on).chains[0].gain, undefined);
	// Off again gives the text back.
	assert.equal(apply(on, gainEdit(on, 0)), plain);
	// A fixed gain keeps its level as the slider's.
	assert.equal(apply('$a: s("bd").gain(0.8)', gainEdit('$a: s("bd").gain(0.8)', 0)), '$a: s("bd").gain(slider(0.8, 0, 1))');
	// A constant: the call goes, the const stays.
	const constant = 'const V = slider(0.5)\n$a: s("bd")\n  .gain(V)\n  .room(0.2)\n';
	assert.equal(apply(constant, gainEdit(constant, 0)), 'const V = slider(0.5)\n$a: s("bd")\n  .room(0.2)\n');
	// A gain from a knob or a pattern is scaled by the fader, and G off gives it back.
	const knob = '$kick: s("bd*4").gain(KICK)';
	const scaledOn = apply(knob, gainEdit(knob, 0));
	assert.equal(scaledOn, '$kick: s("bd*4").gain(KICK.mul(slider(1, 0, 1)))');
	assert.notEqual(model(scaledOn).chains[0].gain, undefined);
	assert.equal(apply(scaledOn, gainEdit(scaledOn, 0)), knob);
	const pattern = '$a: s("bd").gain("1 .5")';
	assert.equal(apply(pattern, gainEdit(pattern, 0)), '$a: s("bd").gain("1 .5".mul(slider(1, 0, 1)))');
	// A gain inside a function is not the chain's own.
	const inner = '$a: s("bd").sometimes(x => x.gain(slider(0.5)))';
	assert.equal(model(inner).chains[0].gain === undefined || gainEdit(inner, 0) === undefined, true);
});

test('a song without labels is one bare chain: its last expression, setup calls skipped', () => {
	const snippet = 'samples("github:tidalcycles/dirt-samples")\nnote("c2*8").s("sawtooth").gain(slider(0.8))\nsetcps(0.5)\n';
	const m = model(snippet);
	assert.equal(m.chains.length, 1);
	assert.equal(m.chains[0].bare, true);
	assert.equal(m.chains[0].label, '');
	assert.notEqual(m.chains[0].gain, undefined);
	// No label to mute or solo; G still works.
	assert.equal(labelEdit(snippet, 0, 'mute'), undefined);
	const off = gainEdit(snippet, 0)!;
	assert.equal(snippet.slice(0, off.from) + off.insert + snippet.slice(off.to), 'samples("github:tidalcycles/dirt-samples")\nnote("c2*8").s("sawtooth")\nsetcps(0.5)\n');
	// With one label, the labels are the chains, as the transpiler plays them.
	assert.deepEqual(model('s("hh*8")\n$kick: s("bd*4")\n').chains.map((c) => c.label), ['$kick']);
});

test('the BPM box reads and writes setcpm, and its default is 120', () => {
	const apply = (code: string, bpm: number | undefined) => {
		const e = tempoEdit(code, bpm);
		return e ? code.slice(0, e.from) + e.insert + code.slice(e.to) : code;
	};
	assert.equal(DEFAULT_BPM, 120);
	assert.equal(model('setcpm(140/4)\n$: s("bd")').tempo?.bpm, 140);
	assert.equal(model('setcps(0.5)\n$: s("bd")').tempo?.bpm, 120);
	assert.equal(model('setCpm(30)\n$: s("bd")').tempo?.bpm, 120);
	assert.equal(model('$: s("bd")').tempo, undefined);
	// A slider as tempo is not a number we can show.
	assert.equal(model('setcpm(slider(30, 20, 40))\n$: s("bd")').tempo?.bpm, undefined);
	// Typed: into the call, or as the first statement after the header comments.
	assert.equal(apply('// @title x\nsetcps(0.5)\n$: s("bd")', 128), '// @title x\nsetcpm(128/4)\n$: s("bd")');
	assert.equal(apply('// @title x\n$: s("bd")', 90), '// @title x\nsetcpm(90/4)\n$: s("bd")');
	// Double click: the line goes, so Strudel's default plays.
	assert.equal(apply('// @title x\nsetcpm(128/4)\n$: s("bd")', undefined), '// @title x\n$: s("bd")');
	assert.equal(tempoEdit('$: s("bd")', undefined), undefined);
	assert.equal(tempoEdit('$: s("bd")', -3), undefined);
});

test('a cable dropped on a strip writes the duck, and a new orbit when the target has none', () => {
	const apply = (code: string, result: Edits) => {
		if ('refused' in result) throw new Error(result.refused);
		// The edits come last first, so each keeps the offsets of the ones before it.
		return result.edits.reduce((text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to), code);
	};
	const song = '$kick: s("bd*4")\n$bass: note("c2").s("saw").orbit(2)\n$pad: note("c4").s("sine")\n';
	// Onto a chain with its own orbit: .duck("2") on the kick.
	const one = apply(song, duckEdits(song, 0, 1));
	assert.equal(one, '$kick: s("bd*4").duck("2")\n$bass: note("c2").s("saw").orbit(2)\n$pad: note("c4").s("sine")\n');
	// Onto a chain on orbit 1 by default: it gets orbit 3, the next free one, and the list grows.
	// The list is "2:3": "2,3" would be a stack and play the kick once per orbit.
	const two = apply(one, duckEdits(one, 0, 2));
	assert.equal(two, '$kick: s("bd*4").duck("2:3")\n$bass: note("c2").s("saw").orbit(2)\n$pad: note("c4").s("sine").orbit(3)\n');
	assert.deepEqual(model(two).ducks.map((d) => `${d.from}>${d.to}@${d.orbit}`), ['0>1@2', '0>2@3']);
	// Again on the same target changes nothing.
	assert.deepEqual(duckEdits(two, 0, 1), { edits: [] });
	// Pulled off: the orbit leaves the list, and .duck() goes with the last one.
	const three = apply(two, unduckEdits(two, 0, 2));
	assert.equal(three.split('\n')[0], '$kick: s("bd*4").duck("3")');
	assert.equal(apply(three, unduckEdits(three, 0, 3)).split('\n')[0], '$kick: s("bd*4")');
	// Moved from the pad to the bass: one edit of the list.
	assert.equal(apply(three, duckEdits(three, 0, 1, 3)).split('\n')[0], '$kick: s("bd*4").duck("2")');
	// Refused: itself, an orbit that is not a plain number, a duck that is a pattern.
	assert.ok('refused' in duckEdits(song, 0, 0));
	assert.ok('refused' in duckEdits('$a: s("bd")\n$b: s("hh").orbit(pick([1,2], 0))', 0, 1));
	assert.ok('refused' in duckEdits('$a: s("bd").duck("<2 3>")\n$b: s("hh").orbit(2)', 0, 1));
});

test('the scope box adds ._scope() to a chain and takes it out again', () => {
	const apply = (code: string, e?: { from: number; to: number; insert: string }) => (e ? code.slice(0, e.from) + e.insert + code.slice(e.to) : code);
	const song = '$kick: s("bd*4").gain(.8)\n$hh: s("hh*8")._scope() // hats\n  .delay(.2)\n';
	assert.deepEqual(model(song).chains.map((c) => !!c.scope), [false, true]);
	const on = apply(song, scopeEdit(song, 0));
	assert.equal(on.split('\n')[0], '$kick: s("bd*4").gain(.8)._scope()');
	assert.equal(model(on).chains[0].scope, true);
	// Off from the middle of a chain: the comment and the calls after it stay.
	assert.equal(apply(song, scopeEdit(song, 1)), '$kick: s("bd*4").gain(.8)\n$hh: s("hh*8") // hats\n  .delay(.2)\n');
	// A scope inside a function is not the chain's own: the box stays gray and does nothing.
	const inner = '$a: s("bd").sometimes(x => x._scope())';
	assert.equal(model(inner).chains[0].scope, undefined);
	assert.equal(apply(inner, scopeEdit(inner, 0)), '$a: s("bd").sometimes(x => x._scope())._scope()');
});

test('a slider with a knob says its CC', () => {
	const song = 'const CUT = slider(800, 200, 4000).knob(74)\n$bass: note("c2").lpf(CUT).gain(slider(.5))';
	assert.deepEqual(model(song).sliders.map((s) => s.knob), [74, undefined]);
	assert.deepEqual(
		model(song).sliders.map(({ line, code }) => ({ line, code })),
		[{ line: 1, code: 'const CUT = slider(800, 200, 4000).knob(74)' }, { line: undefined, code: undefined }],
	);
});
