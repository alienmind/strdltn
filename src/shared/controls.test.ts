import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleToBarBeat, parseArrangement, tapTempoBpm } from './controls.ts';

test('cycleToBarBeat converts cycles to 1-based bar and 4/4 beat', () => {
	assert.deepEqual(cycleToBarBeat(0), { bar: 1, beat: 1 });
	assert.deepEqual(cycleToBarBeat(0.25), { bar: 1, beat: 2 });
	assert.deepEqual(cycleToBarBeat(0.5), { bar: 1, beat: 3 });
	assert.deepEqual(cycleToBarBeat(0.99), { bar: 1, beat: 4 });
	assert.deepEqual(cycleToBarBeat(3.5), { bar: 4, beat: 3 });
	assert.deepEqual(cycleToBarBeat(-1), { bar: 1, beat: 1 });
});

test('tapTempoBpm averages 4+ tap intervals and rejects stale gaps', () => {
	assert.equal(tapTempoBpm([0, 500, 1000]), undefined);
	assert.equal(tapTempoBpm([0, 500, 1000, 1500]), 120);
	assert.equal(tapTempoBpm([0, 400, 800, 1200]), 150);
	assert.equal(tapTempoBpm([0, 3000, 3500, 4000]), undefined);
});

test('parseArrangement reads arrange() sections and // @length headers', () => {
	const arranged = [
		'const intro = s("bd*4")',
		'const drop = s("bd*4, hh*8")',
		'$main: arrange(',
		'  [8, intro], // Intro',
		'  [16, drop],',
		'  [4, silence]',
		')',
	].join('\n');
	assert.deepEqual(parseArrangement(arranged), {
		lengthCycles: 28,
		sections: [
			{ label: 'Intro', start: 0, cycles: 8 },
			{ label: 'drop', start: 8, cycles: 16 },
			{ label: 'silence', start: 24, cycles: 4 },
		],
	});

	const lengthOnly = '// @length 32\n$kick: s("bd*4")\n';
	assert.deepEqual(parseArrangement(lengthOnly), {
		lengthCycles: 32,
		sections: [{ label: '32 bars', start: 0, cycles: 32 }],
	});

	assert.deepEqual(parseArrangement('$kick: s("bd*4")'), { sections: [] });
});
