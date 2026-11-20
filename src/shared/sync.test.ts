// Cases for the text sync in sync.ts. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeSet } from '@codemirror/state';
import { applyChanges, changesFromDiff, changesFromEdits, DocumentWrites, editsFromChanges, SyncClient, SyncHost, type SyncUpdate } from './sync.ts';

/**
 * A host and one webview editing at the same time, with messages in flight both ways.
 * `script` is the order of events. Returns both texts once every message has arrived.
 */
function simulate(start: string, script: (string | [string, number, string])[]) {
	const host = new SyncHost(start);
	const client = new SyncClient(0, 'web');
	let clientText = start;
	const toHost: { version: number; updates: SyncUpdate[] }[] = [];
	const toClient: SyncUpdate[][] = [];
	let inFlight = false;
	const push = () => {
		const sendable = client.sendable();
		if (!sendable || inFlight) return;
		toHost.push(sendable);
		inFlight = true;
	};
	const deliverToHost = () => {
		const message = toHost.shift();
		if (!message) return;
		const accepted = host.push(message.version, message.updates);
		if (accepted?.length) toClient.push(accepted.map((a) => a.update));
	};
	const deliverToClient = () => {
		const updates = toClient.shift();
		if (!updates) return;
		inFlight = false;
		const changes = client.receive(updates);
		if (changes) clientText = applyChanges(clientText, changes);
		push();
	};
	for (const step of script) {
		if (step === 'host>') deliverToHost();
		else if (step === '>client') deliverToClient();
		else if (Array.isArray(step)) {
			const [who, at, insert] = step;
			if (who === 'client') {
				const changes = ChangeSet.of({ from: Math.min(at, clientText.length), insert }, clientText.length);
				clientText = applyChanges(clientText, changes);
				client.local(changes);
				push();
			} else {
				const changes = ChangeSet.of({ from: Math.min(at, host.text.length), insert }, host.text.length);
				toClient.push([host.change(changes)]);
			}
		}
	}
	// Everything still in flight arrives, and a rejected push is sent again after a rebase.
	for (let i = 0; i < 100 && (toHost.length || toClient.length || client.pending.length); i++) {
		deliverToHost();
		deliverToClient();
		if (!toHost.length && !toClient.length && client.pending.length) {
			inFlight = false;
			push();
		}
	}
	return { host: host.text, client: clientText };
}

test('typing while the host inserts above: both kept, the same on both sides', () => {
	const result = simulate('line one\nline two\n', [['client', 8, ' A'], ['host', 0, '// host\n'], ['client', 10, 'B'], 'host>', '>client', 'host>', '>client']);
	assert.equal(result.host, result.client);
	assert.equal(result.host, '// host\nline one AB\nline two\n');
});

test('ten host edits while keys come with no pause', () => {
	const script: (string | [string, number, string])[] = [];
	for (let i = 0; i < 10; i++) {
		script.push(['client', 1000, String(i)]);
		script.push(['host', 0, 'h\n']);
		if (i % 3 === 0) script.push('host>');
		if (i % 4 === 0) script.push('>client');
	}
	const result = simulate('end:', script);
	assert.equal(result.host, result.client);
	assert.equal(result.host, `${'h\n'.repeat(10)}end:0123456789`);
});

test('random interleavings converge and lose nothing', () => {
	let seed = 7;
	const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	for (let run = 0; run < 200; run++) {
		const script: (string | [string, number, string])[] = [];
		const words: string[] = [];
		for (let i = 0; i < 30; i++) {
			const r = random();
			if (r < 0.35) {
				const word = `c${run}_${i};`;
				words.push(word);
				script.push(['client', Math.floor(random() * 200), word]);
			} else if (r < 0.55) {
				const word = `h${run}_${i};`;
				words.push(word);
				script.push(['host', Math.floor(random() * 200), word]);
			} else script.push(random() < 0.5 ? 'host>' : '>client');
		}
		const start = '0123456789\nabcdefghij\n';
		const result = simulate(start, script);
		assert.equal(result.client, result.host, `run ${run}`);
		// A later insert can land inside an earlier word, so words are not checked whole:
		// every character that was there or typed is there once, nothing more.
		const letters = (value: string) => [...value].sort().join('');
		assert.equal(letters(result.host), letters(start + words.join('')), `run ${run}: lost or doubled text`);
	}
});

test('a document event read line by line, with CRLF text from VS Code', () => {
	const before = 'a\nbc\nd';
	const after = 'a\nbXc\nd\ne';
	const changes = changesFromEdits(
		before,
		[
			{ start: { line: 1, character: 1 }, end: { line: 1, character: 1 }, text: 'X' },
			{ start: { line: 2, character: 1 }, end: { line: 2, character: 1 }, text: '\r\ne' },
		],
		after,
	);
	assert.ok(changes);
	assert.equal(applyChanges(before, changes), after);
	assert.equal(changesFromEdits(before, [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, text: 'wrong' }], after), undefined);
});

test('a change back into edits by line and column, all on the old text', () => {
	const before = 'one\ntwo\nthree';
	const changes = changesFromDiff(before, 'one\ntwo!\nthree').compose(ChangeSet.of({ from: 0, insert: '> ' }, 14));
	const edits = editsFromChanges(before, changes);
	assert.deepEqual(edits, [
		{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, text: '> ' },
		{ start: { line: 1, character: 3 }, end: { line: 1, character: 3 }, text: '!' },
	]);
});

test('writes into the document that cross edits from elsewhere: nothing lost, document and agreed text equal', () => {
	let seed = 11;
	const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	for (let run = 0; run < 200; run++) {
		const start = 'alpha\nbeta\ngamma\n';
		const agreed = new SyncHost(start);
		const writes = new DocumentWrites(start);
		let document = start;
		let documentVersion = 0;
		/** Our write on its way: the edits and the document version they were made for. */
		let flying: { edits: ReturnType<DocumentWrites['take']>; version: number } | undefined;
		const words: string[] = [];
		const event = (_before: string, after: string) => {
			// No edits: the change is found by diff, as when VS Code's own list does not add up.
			const outside = writes.changed(after, []);
			if (outside) agreed.change(outside);
		};
		const land = () => {
			if (!flying) return;
			const { edits, version } = flying;
			flying = undefined;
			// VS Code refuses a write made for an older version of the document.
			if (version !== documentVersion || !edits) return writes.failed();
			const changes = ChangeSet.of(edits.map((e) => ({ from: offsetOf(document, e.start), to: offsetOf(document, e.end), insert: e.text })), document.length);
			const before = document;
			document = applyChanges(document, changes);
			documentVersion++;
			event(before, document);
		};
		for (let i = 0; i < 25; i++) {
			const r = random();
			if (r < 0.4) {
				// The webview's change, accepted by the host.
				const word = `w${i};`;
				words.push(word);
				const changes = ChangeSet.of({ from: Math.floor(random() * (agreed.text.length + 1)), insert: word }, agreed.text.length);
				agreed.push(agreed.version, [{ client: 'web', changes: changes.toJSON() }]);
				writes.add(changes);
			} else if (r < 0.6) {
				// An edit from elsewhere, straight into the document.
				const word = `o${i};`;
				words.push(word);
				const before = document;
				document = applyChanges(document, ChangeSet.of({ from: Math.floor(random() * (document.length + 1)), insert: word }, document.length));
				documentVersion++;
				event(before, document);
			} else if (r < 0.8 && !flying) {
				const edits = writes.take();
				if (edits) flying = { edits, version: documentVersion };
			} else land();
		}
		for (let i = 0; i < 50 && (flying || writes.queued || writes.writing); i++) {
			land();
			const edits = writes.take();
			if (edits) flying = { edits, version: documentVersion };
		}
		assert.equal(document, agreed.text, `run ${run}`);
		const letters = (value: string) => [...value].sort().join('');
		assert.equal(letters(document), letters(start + words.join('')), `run ${run}: lost or doubled text`);
	}
});

/** Offset of a line and column in a `\n` text. */
function offsetOf(value: string, at: { line: number; character: number }): number {
	const lines = value.split('\n');
	return lines.slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0) + at.character;
}

test('a push from an old version is refused', () => {
	const host = new SyncHost('abc');
	host.change(ChangeSet.of({ from: 0, insert: 'x' }, 3));
	assert.equal(host.push(0, [{ client: 'web', changes: ChangeSet.of({ from: 3, insert: 'y' }, 3).toJSON() }]), undefined);
});
