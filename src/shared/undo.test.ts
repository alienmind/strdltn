import assert from 'node:assert/strict';
import test from 'node:test';
import { UndoStack } from './undo.ts';

test('undo and redo walk discrete edits and drop redo after a new edit', () => {
	const stack = new UndoStack();
	stack.seed('$kick: s("bd*4")');
	assert.equal(stack.canUndo(), false);
	assert.equal(stack.canRedo(), false);

	stack.record('_kick: s("bd*4")', { now: 1000 });
	stack.record('_kick: s("bd*4").gain(slider(1, 0, 1))', { now: 2000 });
	assert.equal(stack.canUndo(), true);
	assert.equal(stack.canRedo(), false);

	assert.equal(stack.undo(), '_kick: s("bd*4")');
	assert.equal(stack.canUndo(), true);
	assert.equal(stack.canRedo(), true);

	assert.equal(stack.undo(), '$kick: s("bd*4")');
	assert.equal(stack.canUndo(), false);
	assert.equal(stack.undo(), undefined);

	assert.equal(stack.redo(), '_kick: s("bd*4")');
	stack.record('Skick: s("bd*4")', { now: 3000 });
	assert.equal(stack.canRedo(), false);
	assert.equal(stack.undo(), '_kick: s("bd*4")');
});

test('rapid small typing edits coalesce into one undo stop', () => {
	const stack = new UndoStack();
	stack.seed('s("bd")');
	stack.record('s("bd ")', { now: 1000 });
	stack.record('s("bd s")', { now: 1100 });
	stack.record('s("bd sd")', { now: 1200 });

	assert.equal(stack.undo(), 's("bd")');
	assert.equal(stack.canUndo(), false);
	assert.equal(stack.redo(), 's("bd sd")');
});

test('native VS Code undo and redo reasons keep the stack pointer in sync', () => {
	const stack = new UndoStack();
	stack.seed('a');
	stack.record('b', { now: 1000 });
	stack.record('c', { now: 2000 });

	stack.record('b', { now: 3000, reason: 'undo' });
	assert.equal(stack.canUndo(), true);
	assert.equal(stack.canRedo(), true);

	stack.record('c', { now: 4000, reason: 'redo' });
	assert.equal(stack.canRedo(), false);
	assert.equal(stack.undo(), 'b');
});

test('stack caps history at its limit', () => {
	const stack = new UndoStack(3);
	stack.seed('0');
	stack.record('1', { now: 1000 });
	stack.record('2', { now: 2000 });
	stack.record('3', { now: 3000 });

	assert.equal(stack.undo(), '2');
	assert.equal(stack.undo(), '1');
	assert.equal(stack.canUndo(), false);
});
