import assert from 'node:assert/strict';
import test from 'node:test';
import { buildColorEdit, findColorComment, nextUnusedColor, resolveTrackColor, TRACK_PALETTE } from './colors.ts';
import { colorEdit, assignMissingColorEdits, readChains } from './chains.ts';

test('resolveTrackColor resolves palette names and hex codes', () => {
	assert.deepEqual(resolveTrackColor('orange'), { name: 'orange', hex: '#f08c2e' });
	assert.deepEqual(resolveTrackColor('SKY'), { name: 'sky', hex: '#3794ff' });
	assert.deepEqual(resolveTrackColor('#f08c2e'), { name: 'orange', hex: '#f08c2e' });
	assert.deepEqual(resolveTrackColor('#123456'), { name: undefined, hex: '#123456' });
	assert.deepEqual(resolveTrackColor('#abc'), { name: undefined, hex: '#aabbcc' });
	assert.equal(resolveTrackColor('notacolor'), undefined);
});

test('findColorComment reads // @color across adjacent comment lines and stops at blank lines', () => {
	const code = [
		'// @color coral',
		'// Kick drum',
		'$kick: s("bd*4")',
		'',
		'// @color green',
		'',
		'$hat: s("hh*8")',
	].join('\n');
	const kickAt = code.indexOf('$kick');
	const hatAt = code.indexOf('$hat');
	assert.equal(findColorComment(code, kickAt)?.name, 'coral');
	assert.equal(findColorComment(code, hatAt), undefined);
});

test('readChains parses explicit // @color and auto-assigns unused palette colors to other chains', () => {
	const code = [
		'// @color orange',
		'$kick: s("bd*4")',
		'$bass: note("c2").s("sawtooth")',
		'$hat: s("hh*8")',
	].join('\n');
	const model = readChains(code);
	assert.ok(!('error' in model));
	assert.equal(model.chains[0].colorName, 'orange');
	assert.equal(model.chains[0].color, '#f08c2e');
	assert.equal(model.chains[0].colorExplicit, true);
	// Auto-assigned chains get unused palette colors without colliding with orange.
	assert.equal(model.chains[1].colorExplicit, false);
	assert.equal(model.chains[1].colorName, TRACK_PALETTE[0].name);
	assert.equal(model.chains[2].colorName, TRACK_PALETTE[2].name);
	assert.notEqual(model.chains[1].color, model.chains[0].color);
	assert.notEqual(model.chains[2].color, model.chains[0].color);
	assert.notEqual(model.chains[2].color, model.chains[1].color);
});

test('colorEdit inserts, updates, and removes // @color in one edit', () => {
	const apply = (src: string, edit: { from: number; to: number; insert: string } | undefined) =>
		edit ? src.slice(0, edit.from) + edit.insert + src.slice(edit.to) : src;

	const start = '$kick: s("bd*4")\n$bass: note("c2").s("sawtooth")\n';
	const added = apply(start, colorEdit(start, 1, 'teal'));
	assert.equal(added, '$kick: s("bd*4")\n// @color teal\n$bass: note("c2").s("sawtooth")\n');

	const updated = apply(added, colorEdit(added, 1, 'purple'));
	assert.equal(updated, '$kick: s("bd*4")\n// @color purple\n$bass: note("c2").s("sawtooth")\n');

	const removed = apply(updated, colorEdit(updated, 1, undefined));
	assert.equal(removed, start);
});

test('assignMissingColorEdits writes // @color only for chains missing an explicit color', () => {
	const code = '// @color sky\n$kick: s("bd*4")\n$bass: note("c2").s("sawtooth")\n';
	const edits = assignMissingColorEdits(code);
	assert.equal(edits.length, 1);
	const out = code.slice(0, edits[0].from) + edits[0].insert + code.slice(edits[0].to);
	assert.equal(out, '// @color sky\n$kick: s("bd*4")\n// @color coral\n$bass: note("c2").s("sawtooth")\n');
	assert.equal(nextUnusedColor(['#ff6b6b']).name, 'orange');
	assert.equal(buildColorEdit(code, code.indexOf('$kick'), 'sky'), undefined);
});
