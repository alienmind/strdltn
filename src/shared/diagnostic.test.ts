// Cases for the rules in diagnostic.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locateError } from './diagnostic.ts';

const marked = (code: string, error: { message?: string; pos?: number }) => {
	const place = locateError(code, error);
	return place && `${code.slice(place.from, place.to)} (${place.rule})`;
};

test('a syntax error has a position', () => {
	assert.equal(marked('s("bd"))', { message: 'Unexpected token (1:7)', pos: 7 }), ') (position)');
});

test('a mini-notation error has a line', () => {
	const code = '$: s("bd sd")\n  $: s("bd [sd")';
	assert.equal(marked(code, { message: '[mini] parse error at line 2: Expected "]" but end of input found.' }), '$: s("bd [sd") (mini line)');
});

test('a name that does not exist', () => {
	assert.equal(marked('const a = 1\n$: s("bd").gain(vol)', { message: 'vol is not defined' }), 'vol (name)');
	// Not the same letters inside another name, and not a method of that name.
	assert.equal(locateError('s("bd").vol(1).gain(volume)', { message: 'vol is not defined' }), undefined);
});

test('a function that does not exist', () => {
	assert.equal(marked('$: s("bd").lpf(200)\n  .lfp(300)', { message: 's(...).lpf(...).lfp is not a function' }), 'lfp (call)');
});

test('a name in a comment is not the place', () => {
	const code = '// @details Uses `.midi()` to play a device\n$: note("c").midi()';
	const place = locateError(code, { message: 'note(...).midi is not a function' });
	assert.equal(place && code.slice(0, place.from).split('\n').length, 2);
	assert.equal(marked('/* vol */ s("bd").gain(vol)', { message: 'vol is not defined' }), 'vol (name)');
	// The // of an address inside a string is not a comment.
	assert.equal(marked('samples("https://x.org/a")\n$: s("bd").lfp(1)', { message: 's(...).lfp is not a function' }), 'lfp (call)');
});

test('a message that shows the call it is about', () => {
	const code = '// @title MIDI out\nsetcpm(124/4)\nconst cc = await midin(1)';
	const message = "[midi] an input cannot be a pattern. Pass the device name in single quotes, for example midin('loopMIDI Port')";
	assert.equal(marked(code, { message }), 'midin (shown call)');
});

test('an error we cannot place', () => {
	assert.equal(locateError('s("bd")', { message: 'something else' }), undefined);
});
