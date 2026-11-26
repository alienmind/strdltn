import assert from 'node:assert/strict';
import test from 'node:test';
import { STRDLTN_EXCLUDE_GLOB, STRDLTN_GITIGNORE, strdltnSegments } from './workspace.ts';

test('strdltnSegments resolves cache and tmp subpaths under .strdltn/', () => {
	assert.deepEqual(strdltnSegments('cache', 'firmware', 'abc'), ['.strdltn', 'cache', 'firmware', 'abc']);
	assert.deepEqual(strdltnSegments('tmp', 'models/local'), ['.strdltn', 'tmp', 'models', 'local']);
	assert.deepEqual(strdltnSegments('tmp'), ['.strdltn', 'tmp']);
	assert.throws(() => strdltnSegments('tmp', '../outside'));
	assert.ok(STRDLTN_GITIGNORE.includes('\n*\n'));
	assert.ok(STRDLTN_EXCLUDE_GLOB.includes('.strdltn'));
});
