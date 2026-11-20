// Cases for the tag rules in tags.ts. Run with `pnpm test:unit`.
// When a sound lands under the wrong chip in the Browser, add it here first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { functionGroup, makerOf, snippetTags, soundTags } from './tags.ts';

const drum = (name: string) => soundTags({ name, type: 'sample', tag: 'drum-machines', count: 1 });
const sample = (name: string, tag?: string) => soundTags({ name, type: 'sample', tag, count: 1 });

test('drum machines: the part after the bank, and the maker', () => {
	assert.deepEqual(drum('rolandtr909_bd').sort(), ['Drums/Kick', 'Maker/Roland', 'Source/Default']);
	assert.deepEqual(drum('linndrum_oh').sort(), ['Drums/Hihat', 'Maker/Linn', 'Source/Default']);
	assert.deepEqual(drum('sequentialcircuitsdrumtracks_cp').sort(), ['Drums/Clap', 'Maker/Sequential', 'Source/Default']);
	// The short aliases name no maker.
	assert.deepEqual(drum('tr909_sd').sort(), ['Drums/Snare', 'Source/Default']);
});

test('makers: longest prefix, any case', () => {
	assert.equal(makerOf('RolandTR909'), 'Roland');
	assert.equal(makerOf('emusp12'), 'E-mu');
	assert.equal(makerOf('tr808'), undefined);
});

test('plain samples: drums by word, else an instrument family', () => {
	assert.ok(sample('bd').includes('Drums/Kick'));
	assert.ok(sample('bassdrum1').includes('Drums/Kick'));
	assert.ok(sample('snare_rim').includes('Drums/Snare'));
	assert.ok(sample('conga').includes('Drums/Percussion'));
	assert.ok(sample('timpani').includes('Drums/Tom'));
	assert.ok(!sample('timpani').some((tag) => tag.startsWith('Sounds/')));
	assert.ok(sample('steinway').includes('Sounds/Keys'));
	assert.ok(sample('sax_vib').includes('Sounds/Woodwind'));
	assert.ok(sample('numbers').includes('Sounds/Voice'));
	assert.ok(sample('kick', 'local').includes('Source/Local'));
	assert.ok(sample('crate_bd', 'github:eddyflux/crate').includes('Source/Pack'));
});

test('soundfonts: the General MIDI family from the name', () => {
	const font = (name: string) => soundTags({ name, type: 'soundfont', count: 1 });
	assert.ok(font('gm_acoustic_bass').includes('Sounds/Bass'));
	assert.ok(font('gm_lead_8_bass_lead').includes('Sounds/Lead'));
	assert.ok(font('gm_pad_warm').includes('Sounds/Pad'));
	assert.ok(font('gm_epiano1').includes('Sounds/Keys'));
	assert.ok(font('gm_string_ensemble_1').includes('Sounds/Strings'));
	assert.ok(font('gm_french_horn').includes('Sounds/Brass'));
	assert.ok(font('gm_marimba').includes('Sounds/Mallets'));
	assert.ok(font('gm_fx_rain').includes('Sounds/FX'));
	assert.ok(font('gm_bassoon').includes('Sounds/Woodwind'));
});

test('synths: oscillators, noises, ZZFX', () => {
	const synth = (name: string) => soundTags({ name, type: 'synth', count: 1 });
	assert.ok(synth('sawtooth').includes('Sounds/Oscillator'));
	assert.ok(synth('pink').includes('Sounds/Noise'));
	assert.ok(synth('z_sine').includes('Sounds/ZZFX'));
});

test('snippets: category, own tags, creators', () => {
	const tags = snippetTags(
		[
			{ name: 'tags', value: 'acid, 303, techno' },
			{ name: 'by', value: 'alienmind' },
		],
		'bass',
	);
	assert.deepEqual(tags.sort(), ['Category/Bass', 'Creator/alienmind', 'Tag/303', 'Tag/acid', 'Tag/techno']);
});

test('functions: the group from the source file', () => {
	assert.equal(functionGroup('controls.mjs'), 'Effect');
	assert.equal(functionGroup('tonal.mjs'), 'Tonal');
	assert.equal(functionGroup('nope.mjs'), 'Other');
});
