// Cases for the tree of the Files view. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFileTree, countFiles, type FileTreeFolder } from './filetree.ts';

/** The tree as indented lines, folders with a trailing slash. */
const draw = (folder: FileTreeFolder, depth = 0): string[] => [
	...folder.folders.flatMap((child) => [`${'  '.repeat(depth)}${child.name}/`, ...draw(child, depth + 1)]),
	...folder.files.map((file) => `${'  '.repeat(depth)}${file.name}`),
];

test('folders first, then files, sorted as a person reads them', () => {
	const tree = buildFileTree(['demo.strudel', 'examples/10-last.strudel', 'examples/2-second.strudel', 'lib/drums/a.strudel', 'Lib2/x.strudel', 'examples/2-second.strudel']);
	assert.deepEqual(draw(tree), [
		'examples/',
		'  2-second.strudel',
		'  10-last.strudel',
		'lib/',
		'  drums/',
		'    a.strudel',
		'Lib2/',
		'  x.strudel',
		'demo.strudel',
	]);
	assert.equal(countFiles(tree), 5);
	assert.equal(tree.folders[1].folders[0].path, 'lib/drums');
});

test('no files, no tree', () => {
	assert.deepEqual(draw(buildFileTree([])), []);
});
