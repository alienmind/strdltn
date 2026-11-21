// Cases for what a preview plays without the engine. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewPlan } from './preview.ts';

test('samples play their file, wrapped like superdough', () => {
	const bd = { name: 'bd', type: 'sample', count: 2, urls: ['https://x/bd0.wav', 'https://x/bd1.wav'] };
	assert.deepEqual(previewPlan(bd, 0), { kind: 'sample', url: 'https://x/bd0.wav' });
	assert.deepEqual(previewPlan(bd, 3), { kind: 'sample', url: 'https://x/bd1.wav' });
});

test('plain waves and noise are made here, other synths need the engine', () => {
	assert.deepEqual(previewPlan({ name: 'sawtooth', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'sawtooth' });
	assert.deepEqual(previewPlan({ name: 'tri', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'triangle' });
	assert.deepEqual(previewPlan({ name: 'pink', type: 'synth', count: 1 }, 0), { kind: 'noise', color: 'pink' });
	assert.equal(previewPlan({ name: 'supersaw', type: 'synth', count: 1 }, 0), undefined);
	assert.equal(previewPlan({ name: 'gm_piano', type: 'soundfont', count: 1 }, 0), undefined);
	// A sample without addresses (a sound list cached before they were sent) needs the engine too.
	assert.equal(previewPlan({ name: 'bd', type: 'sample', count: 1 }, 0), undefined);
	assert.equal(previewPlan(undefined, 0), undefined);
});

test('a wavetable is one cycle, so it loops', () => {
	assert.deepEqual(previewPlan({ name: 'wt_x', type: 'wavetable', count: 1, urls: ['https://x/w.wav'] }, 0), { kind: 'sample', url: 'https://x/w.wav', loop: true });
});
