// Cases for typing `//` over a selection. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdits, toggleComment } from './comment.ts';

/** The text after a toggle of the part between the two `|` marks. */
const toggle = (marked: string) => {
	const from = marked.indexOf('|');
	const to = marked.indexOf('|', from + 1) - 1;
	const text = marked.replace(/\|/g, '');
	return applyEdits(text, toggleComment(text, from, to));
};

test('comments every selected line', () => {
	assert.equal(toggle('|$: s("bd*4")\n$: s("hh*8")|\n$: s("cp")'), '// $: s("bd*4")\n// $: s("hh*8")\n$: s("cp")');
});

test('the same keys again remove the comment', () => {
	assert.equal(toggle('|// $: s("bd*4")\n// $: s("hh*8")|'), '$: s("bd*4")\n$: s("hh*8")');
});

test('keeps the shape of an indented block', () => {
	assert.equal(toggle('|$: note("c2")\n  .s("saw")\n  .lpf(400)|'), '// $: note("c2")\n//   .s("saw")\n//   .lpf(400)');
	assert.equal(toggle('|  .s("saw")\n    .lpf(400)|'), '  // .s("saw")\n  //   .lpf(400)');
});

test('empty lines are left alone', () => {
	assert.equal(toggle('|a\n\nb|'), '// a\n\n// b');
	assert.equal(toggle('|// a\n\n// b|'), 'a\n\nb');
});

test('a selection that ends at the start of a line does not take that line', () => {
	assert.equal(toggle('|a\n|b'), '// a\nb');
});

test('a part of one line takes the whole line', () => {
	assert.equal(toggle('$: s("|bd|*4")'), '// $: s("bd*4")');
});

test('mixed lines are all commented, never uncommented', () => {
	assert.equal(toggle('|// a\nb|'), '// // a\n// b');
});

test('only the exact mark is removed', () => {
	// `//x` was commented by hand and is not ours, so the block is commented again.
	assert.equal(toggle('|//x\n// y|'), '// //x\n// // y');
});

test('Windows line ends', () => {
	assert.equal(toggle('|a\r\nb|'), '// a\r\n// b');
});
