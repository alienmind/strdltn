import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogItem } from './catalog.ts';
import { dropEdit, dropLine, uniqueLabel } from './drop.ts';

function item(over: Partial<CatalogItem>): CatalogItem {
	return {
		id: 'sound:sawtooth',
		kind: 'sound',
		label: 'sawtooth',
		category: 'sounds',
		place: 'builtin',
		group: 'Synths',
		tags: [],
		text: 'sawtooth',
		insert: 'sawtooth',
		sound: 'sawtooth',
		soundType: 'synth',
		...over,
	};
}

test('dropping a synth or firmware develops a full playable line with unique label', () => {
	const synth = dropLine(item({ label: 'supersaw', insert: 'supersaw', sound: 'supersaw' }), '');
	assert.equal(synth.line, '$supersaw: note("c3 eb3 g3 bb3").s("supersaw").lpf(1800).gain(slider(0.7, 0, 1))');

	const fw = dropLine(item({ id: 'firmware:obervave', kind: 'firmware', label: 'OBERVAVE', category: 'fm1' }), '$obervave: note("c2").s("vibefm1:obervave")');
	assert.equal(fw.line, '$obervave2: note("c3 eb3 g3 bb3").s("vibefm1:obervave").gain(slider(0.8, 0, 1))');

	const bass = dropLine(item({ label: 'gm_synth_bass_1', soundType: 'soundfont', tags: ['Sounds/Bass'] }), '');
	assert.equal(bass.line, '$synth_bass_1: note("c2 ~ c2 eb2 g1 ~ bb1 ~").s("gm_synth_bass_1").gain(slider(0.8, 0, 1))');

	const kick = dropLine(item({ label: 'bd', category: 'drums', bank: 'RolandTR909', tags: ['Drums/Kick'] }), '');
	assert.equal(kick.line, '$kick: s("bd*4").bank("RolandTR909").gain(slider(0.9, 0, 1))');
});

test('dropping onto a non-empty line inserts below it; inside a string inserts the bare name', () => {
	const code = 'setcpm(128/4)\n$kick: s("bd*4")\n';
	const fw = item({ id: 'firmware:obervave', kind: 'firmware', label: 'OBERVAVE', category: 'fm1' });

	// Dropped on the $kick line outside a string -> inserted on a new line after $kick.
	const onLine = dropEdit(fw, code, 16);
	assert.equal(onLine.from, 30);
	assert.equal(onLine.insert, '\n$obervave: note("c3 eb3 g3 bb3").s("vibefm1:obervave").gain(slider(0.8, 0, 1))');

	// Dropped on the trailing empty line -> placed directly on that line.
	const onBlank = dropEdit(fw, code, code.length);
	assert.equal(onBlank.from, code.length);
	assert.equal(onBlank.insert, '$obervave: note("c3 eb3 g3 bb3").s("vibefm1:obervave").gain(slider(0.8, 0, 1))');

	// Dropped inside s("bd*4") string -> inserts only bare name.
	const inStr = dropEdit(fw, code, 26);
	assert.deepEqual(inStr, { from: 26, to: 26, insert: 'vibefm1:obervave' });
});

test('uniqueLabel skips labels already taken in muted or soloed forms', () => {
	assert.equal(uniqueLabel('pad', '_pad: s("sawtooth")\n$pad2: s("sine")'), '$pad3');
});
