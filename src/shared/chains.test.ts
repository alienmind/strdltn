// Cases for the Mixer's model in chains.ts. Run with `pnpm test:unit`.
// When a strip of the Mixer is wrong, add the code that produced it here first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type MixerModel, readChains } from './chains.ts';

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
		{ name: 'vocals', gain: 'gain (VOCALS_VOL)', controls: [], orbit: 1 },
		{ name: 'kick', gain: 'gain (KICK_VOL)', controls: [], orbit: 1 },
		{ name: 'snare', gain: 'gain (SNARE_VOL)', controls: [], orbit: 1 },
		{ name: 'hh', gain: 'gain (HH_VOL)', controls: [], orbit: 1 },
		{ name: 'hhr', gain: 'gain (HHR_VOL)', controls: [], orbit: 1 },
		{ name: 'bass', gain: 'gain (BASS_VOL)', controls: ['lpenv (BASS_ENERGY)'], orbit: 2 },
		{ name: 'lowendbass', gain: 'gain (SUB_VOL)', controls: ['lpenv (SUB_ENERGY)'], orbit: 3 },
		{ name: 'riser', gain: undefined, controls: [], orbit: 4 },
	]);
	const name = (i?: number) => (i === undefined ? undefined : m.chains[i].name);
	assert.deepEqual(
		m.ducks.map((d) => [name(d.from), name(d.to), d.orbit]),
		[
			['kick', 'bass', 2],
			['kick', 'lowendbass', 3],
			['kick', 'riser', 4],
		],
	);
	assert.equal(m.sliders.length, 9);
	assert.deepEqual(m.global, []);
	assert.equal(m.sliders[0].detail, 'kick vol');
	assert.equal(m.sliders[0].value, 0.607);
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
