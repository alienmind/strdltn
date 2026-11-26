import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREVIEW_BPM, previewCycleSeconds, previewPlan } from './preview.ts';

test('samples play their file, wrapped like superdough', () => {
	const bd = { name: 'bd', type: 'sample', count: 2, urls: ['https://example/bd0.wav', 'https://example/bd1.wav'] };
	assert.deepEqual(previewPlan(bd, 0), { kind: 'sample', url: 'https://example/bd0.wav' });
	assert.deepEqual(previewPlan(bd, 3), { kind: 'sample', url: 'https://example/bd1.wav' });
});

test('plain waves and noise use plain Web Audio; other synths and soundfonts use superdough in Browser', () => {
	assert.deepEqual(previewPlan({ name: 'sawtooth', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'sawtooth' });
	assert.deepEqual(previewPlan({ name: 'sin', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'sine' });
	assert.deepEqual(previewPlan({ name: 'sqr', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'square' });
	assert.deepEqual(previewPlan({ name: 'tri', type: 'synth', count: 1 }, 0), { kind: 'oscillator', wave: 'triangle' });
	assert.deepEqual(previewPlan({ name: 'pink', type: 'synth', count: 1 }, 0), { kind: 'noise', color: 'pink' });
	assert.deepEqual(previewPlan({ name: 'supersaw', type: 'synth', count: 1 }, 0), { kind: 'superdough', name: 'supersaw', index: 0, pitched: true });
	assert.deepEqual(previewPlan({ name: 'gm_acoustic_bass', type: 'soundfont', count: 1 }, 0), { kind: 'superdough', name: 'gm_acoustic_bass', index: 0, pitched: true });
});

test('a wavetable is one cycle, so it loops', () => {
	const wt = { name: 'wt_digital', type: 'wavetable', count: 1, urls: ['https://example/wt.wav'] };
	assert.deepEqual(previewPlan(wt, 0), { kind: 'sample', url: 'https://example/wt.wav', loop: true });
});

test('previewCycleSeconds computes one loop clamped to [0.5, 4] s', () => {
	assert.equal(previewCycleSeconds(), 240 / DEFAULT_PREVIEW_BPM);
	assert.equal(previewCycleSeconds({ bpm: 120 }), 2);
	assert.equal(previewCycleSeconds({ cps: 0.5 }), 2);
	assert.equal(previewCycleSeconds({ bpm: 128 }), 240 / 128);
	assert.equal(previewCycleSeconds({ bpm: 30 }), 4);
	assert.equal(previewCycleSeconds({ bpm: 600 }), 0.5);
});
