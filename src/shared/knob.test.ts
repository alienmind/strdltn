// Cases for sliders on knobs (knob.ts). Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findKnobs, hasKnobSnippet, KNOB_SNIPPET, knobEdits, type Pickup, pickup, removeKnobEdits, sliderAt, snap, unmapKnobEdit } from './knob.ts';

const apply = (code: string, edits: { from: number; to: number; insert: string }[]) =>
	[...edits].sort((a, b) => b.from - a.from).reduce((text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to), code);

test('a knob after a slider is found with the slider range', () => {
	const code = 'const CUT = slider(800, 200, 4000, 10).knob(74)\n$: s("saw").lpf(CUT).gain(slider(.5).knob(1))';
	assert.deepEqual(findKnobs(code), [
		{ from: code.indexOf('800'), cc: 74, min: 200, max: 4000, step: 10 },
		{ from: code.indexOf('.5'), cc: 1, min: 0, max: 1, step: undefined },
	]);
});

test('no knob: a slider alone, a knob on something else, a CC out of range, half typed code', () => {
	assert.deepEqual(findKnobs('$: s("bd").gain(slider(.5))'), []);
	assert.deepEqual(findKnobs('$: s("bd").gain(sine.knob(3))'), []);
	assert.deepEqual(findKnobs('$: s("bd").gain(slider(.5).knob(200))'), []);
	assert.deepEqual(findKnobs('$: s("bd").gain(slider(.5).knob('), []);
});

test('learning a knob adds .knob(cc) after the slider and the snippet after the header', () => {
	const code = '// @title Test\n// @by me\n$: s("bd").gain(slider(0.31, 0, 1))\n';
	const done = apply(code, knobEdits(code, code.indexOf('0.31'), 7)!);
	assert.equal(done, `// @title Test\n// @by me\n${KNOB_SNIPPET}$: s("bd").gain(slider(0.31, 0, 1).knob(7))\n`);
	assert.ok(hasKnobSnippet(done));
	assert.deepEqual(findKnobs(done).map((k) => k.cc), [7]);
});

test('learning again changes the CC and does not add the snippet twice', () => {
	const code = `${KNOB_SNIPPET}$: s("bd").gain(slider(0.31).knob(7))`;
	assert.equal(apply(code, knobEdits(code, code.indexOf('0.31'), 12)!), `${KNOB_SNIPPET}$: s("bd").gain(slider(0.31).knob(12))`);
});

test('removing every knob takes out each .knob(cc) and the snippet, and nothing else', () => {
	const code = `// @title Test\n${KNOB_SNIPPET}const A = slider(0.3).knob(1)\n$: s("bd").gain(A).lpf(slider(800, 200, 4000).knob(74)).room(sine.knob(3))`;
	assert.equal(apply(code, removeKnobEdits(code)), '// @title Test\nconst A = slider(0.3)\n$: s("bd").gain(A).lpf(slider(800, 200, 4000)).room(sine.knob(3))');
	assert.deepEqual(removeKnobEdits('$: s("bd").gain(slider(.5))'), []);
});

test('a second click takes the knob off that slider only', () => {
	const code = `${KNOB_SNIPPET}$: s("bd").gain(slider(0.3).knob(1)).lpf(slider(800, 200, 4000).knob(74))`;
	assert.equal(apply(code, [unmapKnobEdit(code, code.indexOf('0.3'))!]), `${KNOB_SNIPPET}$: s("bd").gain(slider(0.3)).lpf(slider(800, 200, 4000).knob(74))`);
	assert.equal(unmapKnobEdit('$: s("bd").gain(slider(0.3))', 22), undefined);
});

test('learning where no slider starts does nothing', () => {
	assert.equal(knobEdits('$: s("bd").gain(slider(0.31))', 3, 7), undefined);
});

const range = { from: 0, cc: 1, min: 0, max: 1 };

test('pickup: a knob away from the slider does not move it until it passes the value', () => {
	let state: Pickup = { engaged: false };
	let step = pickup(state, range, 0.5, 0.1);
	assert.equal(step.write, undefined);
	step = pickup((state = step.state), range, 0.5, 0.3);
	assert.equal(step.write, undefined);
	// Passes 0.5 between two messages: caught.
	step = pickup((state = step.state), range, 0.5, 0.6);
	assert.equal(step.write, 0.6);
	step = pickup((state = step.state), range, 0.6, 0.2);
	assert.equal(step.write, 0.2);
});

test('pickup: a knob that sat on the slider value before a new evaluation is caught as it moves away', () => {
	// The page carries the CC's last position over (`lastPosition` in the webview), here 0.5.
	assert.equal(pickup({ engaged: false, knob: 0.5 }, range, 0.5, 0.55).write, 0.55);
	assert.equal(pickup({ engaged: false, knob: 0.5 }, range, 0.5, 0.45).write, 0.45);
});

test('pickup: the first message on the slider value catches it at once', () => {
	assert.equal(pickup({ engaged: false }, range, 0.5, 64 / 127).write, snap(64 / 127, range));
});

test('pickup: a slider moved by something else drops the knob until it catches up again', () => {
	let { state } = pickup({ engaged: false }, range, 0.5, 0.5);
	assert.equal(state.engaged, true);
	// A drag set the slider to 0.9.
	const step = pickup(state, range, 0.9, 0.55);
	assert.equal(step.write, undefined);
	assert.equal(pickup(step.state, range, 0.9, 0.95).write, 0.95);
});

test('pickup: a slider value that lags behind the knob does not make it let go', () => {
	// The page reads the slider a few steps late during a fast turn (2026-11-22).
	let state: Pickup = { engaged: false };
	const written: number[] = [];
	for (let cc = 109; cc <= 127; cc++) {
		const lagging = written.length > 3 ? written[written.length - 4] : 0.858;
		const step = pickup(state, range, lagging, cc / 127);
		state = step.state;
		assert.notEqual(step.write, undefined, `CC ${cc} wrote nothing`);
		written.push(step.write!);
	}
	assert.equal(written.at(-1), 1);
});

test('pickup works in the slider units and its step', () => {
	const cutoff = { from: 0, cc: 74, min: 200, max: 4000, step: 10 };
	const { state } = pickup({ engaged: false }, cutoff, 2100, 0.5);
	assert.equal(state.engaged, true);
	assert.equal(pickup(state, cutoff, 2100, 1).write, 4000);
	assert.equal(snap(1234.5, cutoff), 1230);
});

test('the slider under the cursor, the inner one when two are nested', () => {
	const code = '$: s("bd").gain(slider(0.31, 0, 1)).lpf(slider(800, 200, 4000))';
	assert.equal(sliderAt(code, code.indexOf('0, 1')), code.indexOf('0.31'));
	assert.equal(sliderAt(code, code.indexOf('slider(800')), code.indexOf('800'));
	assert.equal(sliderAt(code, 2), undefined);
});
