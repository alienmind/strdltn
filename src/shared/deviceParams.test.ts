import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceParam } from './devices.ts';
import { clampParamValue, classifyParamGroup, filterDeviceParams, formatVpSliderSnippet, formatVpSnippet, paramGroups } from './deviceParams.ts';

function p(index: number, id: string, name: string, min = 0, max = 1, def = 0.5, steps = 0, unit = ''): DeviceParam {
	return { index, id, name, min, max, def, steps, unit };
}

describe('Devices parameter grouping and formatting', () => {
	const params: DeviceParam[] = [
		p(0, 'osc1_wave', 'Osc 1 Wave', 0, 3, 0, 4),
		p(1, 'flt_cutoff', 'Filter Cutoff', 20, 18000, 1200, 0, 'Hz'),
		p(2, 'env_attack', 'Amp Attack', 0, 2, 0.02, 0, 's'),
		p(3, 'lfo_rate', 'LFO Rate', 0.1, 20, 2, 0, 'Hz'),
		p(4, 'fx_reverb', 'Reverb Mix', 0, 1, 0.2),
		p(5, 'master_vol', 'Master Volume', 0, 1, 0.8),
		p(6, 'custom_seed', 'Poly Seed', 0, 99, 7, 100),
	];

	it('classifies synth parameters by prefix and keyword', () => {
		assert.equal(classifyParamGroup(params[0]), 'OSC');
		assert.equal(classifyParamGroup(params[1]), 'FLT');
		assert.equal(classifyParamGroup(params[2]), 'ENV');
		assert.equal(classifyParamGroup(params[3]), 'MOD');
		assert.equal(classifyParamGroup(params[4]), 'FX');
		assert.equal(classifyParamGroup(params[5]), 'MIX');
		assert.equal(classifyParamGroup(params[6]), 'OTHER');
	});

	it('builds non-empty groups in signal-flow order and filters by group/query', () => {
		assert.deepEqual(paramGroups(params), [
			{ id: 'OSC', count: 1 },
			{ id: 'FLT', count: 1 },
			{ id: 'ENV', count: 1 },
			{ id: 'MOD', count: 1 },
			{ id: 'FX', count: 1 },
			{ id: 'MIX', count: 1 },
			{ id: 'OTHER', count: 1 },
		]);
		assert.deepEqual(
			filterDeviceParams(params, 'FLT', '').map((x) => x.id),
			['flt_cutoff'],
		);
		assert.deepEqual(
			filterDeviceParams(params, 'ALL', 'hz').map((x) => x.id),
			['flt_cutoff', 'lfo_rate'],
		);
	});

	it('clamps stepped values and formats .vp() and slider snippets', () => {
		assert.equal(clampParamValue(params[0], 1.7), 2);
		assert.equal(clampParamValue(params[0], 9), 3);
		assert.equal(formatVpSnippet(params[1], 1450.4), '.vp("flt_cutoff", 1450)');
		assert.equal(formatVpSliderSnippet(params[0], 2), '.vp("osc1_wave", slider(2, 0, 3, 1))');
		assert.equal(formatVpSliderSnippet(params[4], 0.35), '.vp("fx_reverb", slider(0.35, 0, 1))');
	});
});
