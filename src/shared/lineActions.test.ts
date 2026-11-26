import assert from 'node:assert/strict';
import test from 'node:test';
import { lineActionMap } from './lineActions.ts';

test('maps M/S on labeled chains and C on slider lines (including combined lines)', () => {
	const code = [
		'const CUTOFF = slider(800, 200, 4000).knob(74)',
		'$kick: s("bd*4").gain(slider(0.9, 0, 1))',
		'_$pad: note("c3 eb3").s("sawtooth")',
		'Sbass: note("c2*4").s("sawtooth").lpf(CUTOFF)',
		'// plain comment',
	].join('\n');

	const map = lineActionMap(code);
	// Line 0: const slider with CC 74, no chain
	assert.equal(map.get(0)?.chain, undefined);
	assert.equal(map.get(0)?.cc, 74);
	assert.ok(typeof map.get(0)?.sliderFrom === 'number');

	// Line 1: $kick chain + gain slider (unmapped)
	assert.equal(map.get(1)?.chain, 0);
	assert.equal(map.get(1)?.muted, false);
	assert.equal(map.get(1)?.solo, false);
	assert.equal(map.get(1)?.cc, undefined);
	assert.ok(typeof map.get(1)?.sliderFrom === 'number');

	// Line 2: _$pad muted chain, no slider
	assert.equal(map.get(2)?.chain, 1);
	assert.equal(map.get(2)?.muted, true);
	assert.equal(map.get(2)?.solo, false);
	assert.equal(map.get(2)?.sliderFrom, undefined);

	// Line 3: Sbass solo chain, no inline slider
	assert.equal(map.get(3)?.chain, 2);
	assert.equal(map.get(3)?.muted, false);
	assert.equal(map.get(3)?.solo, true);

	// Line 4: comment has no actions
	assert.equal(map.get(4), undefined);
});

test('bare chain gets no M/S but keeps C if it has a slider', () => {
	const code = 's("bd sd").gain(slider(0.8, 0, 1))';
	const map = lineActionMap(code);
	assert.equal(map.get(0)?.chain, undefined);
	assert.ok(typeof map.get(0)?.sliderFrom === 'number');
});

test('falls back gracefully during mid-keystroke syntax error without dropping M/S', () => {
	const code = ['_$kick: s("bd*4")', '$bass: note("c2").lpf('].join('\n');
	const map = lineActionMap(code);
	assert.equal(map.get(0)?.chain, 0);
	assert.equal(map.get(0)?.muted, true);
	assert.equal(map.get(1)?.chain, 1);
	assert.equal(map.get(1)?.muted, false);
});
