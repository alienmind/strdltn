// Cases for writing tags into the header of a snippet, in snippet.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSnippet, setSnippetTags } from './snippet.ts';

test('an existing @tags line is replaced in place', () => {
	const text = '// @title Acid\n// @tags acid\n// @by me\nnote("c2")';
	assert.equal(setSnippetTags(text, ['acid', '303']), '// @title Acid\n// @tags acid, 303\n// @by me\nnote("c2")');
});

test('a new line goes after the header', () => {
	const text = '// @title Acid\n// @category bass\n\nnote("c2")\n';
	const out = setSnippetTags(text, ['acid']);
	assert.equal(out, '// @title Acid\n// @category bass\n// @tags acid\n\nnote("c2")\n');
	assert.equal(parseSnippet('a', out).fields.find((f) => f.name === 'tags')?.value, 'acid');
});

test('a file without a header gets one, and the code stays the code', () => {
	const out = setSnippetTags('note("c2")', ['x']);
	assert.equal(out, '// @tags x\nnote("c2")');
	assert.equal(parseSnippet('a', out).code, 'note("c2")');
});

test('no tags removes the line; Windows line ends stay', () => {
	assert.equal(setSnippetTags('// @title A\r\n// @tags x\r\nnote("c")', []), '// @title A\r\nnote("c")');
});
