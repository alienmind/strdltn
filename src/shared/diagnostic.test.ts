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

test('an error we cannot place', () => {
	assert.equal(locateError('s("bd")', { message: 'something else' }), undefined);
});
