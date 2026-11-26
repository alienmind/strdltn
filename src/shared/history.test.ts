import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserHistory, type BrowserSnapshot, describeSnapshot } from './history.ts';

function snap(over: Partial<BrowserSnapshot> = {}): BrowserSnapshot {
	return {
		filter: { category: 'all', query: '', chips: [], ...over.filter },
		panes: { controls: true, library: true, contents: true, reference: false, ...over.panes },
		tree: over.tree ?? [],
		sections: over.sections ?? { collections: true },
	};
}

test('back and forward walk searches, pane folds and unfolded subtrees', () => {
	const history = new BrowserHistory();
	const start = snap();
	const sounds = snap({
		filter: { category: 'sounds', query: '', chips: [] },
		panes: { controls: true, library: false, contents: true, reference: false },
		tree: ['sounds'],
	});
	const search = snap({
		filter: { category: 'sounds', query: '909', chips: [] },
		panes: { controls: true, library: false, contents: true, reference: false },
		tree: ['sounds'],
	});
	history.seed(start);
	assert.equal(history.canBack(), false);
	assert.equal(history.canForward(), false);

	assert.equal(history.push(sounds), true);
	assert.equal(history.push(search), true);
	assert.equal(history.canBack(), true);
	assert.equal(history.canForward(), false);

	assert.deepEqual(history.back(), sounds);
	assert.equal(history.canBack(), true);
	assert.equal(history.canForward(), true);

	assert.deepEqual(history.back(), start);
	assert.equal(history.canBack(), false);
	assert.equal(history.back(), undefined);

	assert.deepEqual(history.forward(), sounds);
	assert.deepEqual(history.forward(), search);
	assert.equal(history.canForward(), false);
	assert.equal(history.forward(), undefined);
});

test('a new navigation after back drops the forward branch and skips duplicates', () => {
	const history = new BrowserHistory();
	const a = snap();
	const b = snap({ filter: { category: 'drums', query: '', chips: [] }, tree: ['drums'] });
	const c = snap({ filter: { category: 'functions', query: '', chips: [] }, panes: { controls: true, library: false, contents: true, reference: false } });
	history.seed(a);
	assert.equal(history.push(a), false);
	history.push(b);
	assert.deepEqual(history.back(), a);
	assert.equal(history.canForward(), true);

	history.push(c);
	assert.equal(history.canForward(), false);
	assert.deepEqual(history.back(), a);
	assert.deepEqual(history.forward(), c);
});

test('replace coalesces typing one search into a single history stop', () => {
	const history = new BrowserHistory();
	const start = snap();
	history.seed(start);
	history.push(snap({ filter: { category: 'all', query: '9', chips: [] } }));
	history.push(snap({ filter: { category: 'all', query: '90', chips: [] } }), { replace: true });
	history.push(snap({ filter: { category: 'all', query: '909', chips: [] } }), { replace: true });

	assert.equal(history.toState().entries.length, 2);
	assert.deepEqual(history.back(), start);
	assert.equal(history.forward()?.filter.query, '909');
});

test('pane collapse and tree twisty changes are tracked and restored across serialization', () => {
	const history = new BrowserHistory(undefined, 3);
	const s1 = snap({ tree: ['plugins', 'fm1'] });
	const s2 = snap({ tree: ['plugins'], panes: { controls: true, library: true, contents: false, reference: false } });
	const s3 = snap({ panes: { controls: true, library: false, contents: false, reference: true } });
	const s4 = snap({ panes: { controls: false, library: false, contents: true, reference: false } });
	history.seed(s1);
	history.push(s2);
	history.push(s3);
	history.push(s4);

	// Respects the limit of 3 entries (s1 dropped).
	const restored = new BrowserHistory(history.toState(), 3);
	assert.equal(restored.toState().entries.length, 3);
	assert.deepEqual(restored.back(), s3);
	assert.deepEqual(restored.back(), s2);
	assert.equal(restored.canBack(), false);
});

test('describeSnapshot formats labels for Back and Forward tooltips', () => {
	assert.equal(describeSnapshot(snap()), 'All');
	assert.equal(describeSnapshot(snap({ filter: { category: 'fm1', group: 'Available', query: '', chips: [] } })), 'FM-1 Synths > Available');
	assert.equal(describeSnapshot(snap({ filter: { category: 'drums', query: '909', chips: [] } })), '"909" in Drums');
	assert.equal(describeSnapshot(snap({ panes: { controls: true, library: false, contents: false, reference: true } })), 'Reference');
});
