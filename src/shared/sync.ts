// The text of a song is held twice: in the VS Code document (the host) and in the editor
// of a webview. Both can change it at the same moment: the user types in the webview
// while an agent, a save that trims spaces, or the Browser edits the document. This file
// keeps the two equal.
//
// The host is the authority and numbers the changes it accepts: the version. The webview
// sends its changes with the version they are based on. When the host has moved on in
// the meantime, it drops them; the webview receives the host's changes, moves its own
// unconfirmed changes over them (rebase) and sends again. The scheme is the one of
// CodeMirror's collab package, written here on `ChangeSet` of `@codemirror/state`.
//
// Why: the first version sent the whole text each way and made each side equal to the
// other by a diff. Two changes that crossed undid each other, and the two sides
// stayed different, so the next keystroke wrote stale text over the document. On a file
// with `\r\n` line endings every keystroke was such a diff over the whole file, because
// the editor holds `\n`. Measured in the integration test ("typing" and "typingCrlf").
//
// Every text and offset here uses `\n` line endings, as CodeMirror does. The host maps
// to the document by line and column, which do not depend on the line ending.
import { ChangeSet, Text } from '@codemirror/state';

/** A change as it travels: who made it, and the change in JSON. */
export interface SyncUpdate {
	client: string;
	changes: unknown;
}

export const toText = (value: string): Text => Text.of(value.split('\n'));
export const applyChanges = (value: string, changes: ChangeSet): string => changes.apply(toText(value)).toString();
export const lf = (value: string): string => value.replace(/\r\n?/g, '\n');

/**
 * The webview's side. It holds the version it is synced to and its own changes the host
 * has not confirmed yet, each one on top of the one before.
 */
export class SyncClient {
	pending: ChangeSet[] = [];
	version: number;
	readonly id: string;
	constructor(version: number, id: string) {
		this.version = version;
		this.id = id;
	}

	/** A change made in this editor, on its text as it is now. */
	local(changes: ChangeSet): void {
		this.pending.push(changes);
	}

	/** What to send: the unconfirmed changes and the version they start from. */
	sendable(): { version: number; updates: SyncUpdate[] } | undefined {
		if (!this.pending.length) return undefined;
		return { version: this.version, updates: this.pending.map((changes) => ({ client: this.id, changes: changes.toJSON() })) };
	}

	/**
	 * Changes the host accepted, in its order. Ours confirm our oldest pending change. The
	 * others are moved over our pending changes, and our pending changes over them.
	 * Returns what to apply to this editor's text, or undefined when nothing changes it.
	 *
	 * At the same place, the host's text goes first and ours after it, on both sides: the
	 * host applies `pending.map(remote)`, this side `remote.map(pending, true)`.
	 */
	receive(updates: SyncUpdate[]): ChangeSet | undefined {
		let apply: ChangeSet | undefined;
		for (const update of updates) {
			this.version++;
			if (update.client === this.id) {
				this.pending.shift();
				continue;
			}
			let remote = ChangeSet.fromJSON(update.changes);
			this.pending = this.pending.map((mine) => {
				const moved = mine.map(remote);
				remote = remote.map(mine, true);
				return moved;
			});
			apply = apply ? apply.compose(remote) : remote;
		}
		return apply;
	}
}

/** Line and column of an offset of a text with `\n` line endings. The same in the document whatever its line endings. */
export function lineColumn(value: string, offset: number): LineColumn {
	const before = value.slice(0, offset);
	const line = before.split('\n').length - 1;
	return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

/** Offsets where each line starts. */
function lineStarts(value: string): number[] {
	const starts = [0];
	for (let i = value.indexOf('\n'); i >= 0; i = value.indexOf('\n', i + 1)) starts.push(i + 1);
	return starts;
}

export interface LineColumn {
	line: number;
	character: number;
}

/** An edit of the document by line and column, as VS Code gives and takes them. */
export interface DocumentEdit {
	start: LineColumn;
	end: LineColumn;
	text: string;
}

/**
 * The change a document event made, from its `contentChanges`. VS Code applies them one
 * after the other, each on the result of the one before, so they are read that way.
 * Undefined when they do not lead to `after`: then the caller falls back to a diff.
 */
export function changesFromEdits(before: string, edits: readonly DocumentEdit[], after: string): ChangeSet | undefined {
	let text = before;
	let changes = ChangeSet.empty(before.length);
	for (const edit of edits) {
		const starts = lineStarts(text);
		const at = (p: LineColumn) => (p.line < starts.length ? Math.min(starts[p.line] + p.character, text.length) : text.length);
		const step = ChangeSet.of({ from: at(edit.start), to: at(edit.end), insert: lf(edit.text) }, text.length);
		changes = changes.compose(step);
		text = applyChanges(text, step);
	}
	return text === after ? changes : undefined;
}

/** The smallest single change from `before` to `after`. */
export function changesFromDiff(before: string, after: string): ChangeSet {
	let start = 0;
	const max = Math.min(before.length, after.length);
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
		endBefore--;
		endAfter--;
	}
	return ChangeSet.of({ from: start, to: endBefore, insert: after.slice(start, endAfter) }, before.length);
}

/** The edits of the document that make a change of its text `before`. All on the document as it was, as one `WorkspaceEdit` wants them. */
export function editsFromChanges(before: string, changes: ChangeSet): DocumentEdit[] {
	const starts = lineStarts(before);
	const position = (offset: number): LineColumn => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if (starts[middle] <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low, character: offset - starts[low] };
	};
	const edits: DocumentEdit[] = [];
	changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => edits.push({ start: position(fromA), end: position(toA), text: inserted.toString() }));
	return edits;
}

/**
 * The host's writes into the VS Code document, which can lag behind the text the two
 * sides agreed on. VS Code refuses a write when the document changed since it was made
 * (the document's version moved), so a write that crosses an edit from elsewhere fails.
 * That edit is then moved over our unwritten changes and passed on to the webview, and our
 * unwritten changes are moved over it and written again. Nothing is dropped.
 *
 * `document`: the document's text as we last saw it. `writing`: the change on its way into
 * it. `queued`: changes on top of that, not sent yet.
 */
export class DocumentWrites {
	document: string;
	writing: ChangeSet | undefined;
	queued: ChangeSet | undefined;
	constructor(document: string) {
		this.document = document;
	}

	/** A change both sides agreed on, still to be written. */
	add(changes: ChangeSet): void {
		this.queued = this.queued ? this.queued.compose(changes) : changes;
	}

	/** The next write, when none is on its way: the edits on the document, by line and column. */
	take(): DocumentEdit[] | undefined {
		if (this.writing || !this.queued) return undefined;
		this.writing = this.queued;
		this.queued = undefined;
		return editsFromChanges(this.document, this.writing);
	}

	/** The write did not land. It goes back to the front of the queue. */
	failed(): void {
		if (!this.writing) return;
		this.queued = this.queued ? this.writing.compose(this.queued) : this.writing;
		this.writing = undefined;
	}

	/**
	 * The document changed to `text`. Undefined when it was our own write landing. Else the
	 * change from elsewhere, moved over what we have not written yet, which is how the
	 * agreed text has to change. At the same place the edit from elsewhere goes first.
	 */
	changed(text: string, edits: readonly DocumentEdit[]): ChangeSet | undefined {
		if (this.writing && text === applyChanges(this.document, this.writing)) {
			this.document = text;
			this.writing = undefined;
			return undefined;
		}
		const outside = changesFromEdits(this.document, edits, text) ?? changesFromDiff(this.document, text);
		this.document = text;
		const unwritten = this.writing && this.queued ? this.writing.compose(this.queued) : (this.writing ?? this.queued);
		// The write on its way was made for the old document. VS Code refuses it, and it is written again from the queue.
		this.writing = undefined;
		if (!unwritten) return outside;
		this.queued = unwritten.map(outside);
		return outside.map(unwritten, true);
	}
}

/**
 * The host's side, without VS Code: the version and the text it accepted. `push` takes a
 * webview's changes when they start from the current version; `change` takes a change of
 * the document from anywhere else.
 */
export class SyncHost {
	text: string;
	version: number;
	constructor(text: string, version = 0) {
		this.text = text;
		this.version = version;
	}

	/** The accepted changes, or undefined when they start from an old version and must be rebased first. */
	push(version: number, updates: SyncUpdate[]): { update: SyncUpdate; changes: ChangeSet; before: string }[] | undefined {
		if (version !== this.version) return undefined;
		const accepted: { update: SyncUpdate; changes: ChangeSet; before: string }[] = [];
		for (const update of updates) {
			const changes = ChangeSet.fromJSON(update.changes);
			if (changes.length !== this.text.length) break;
			accepted.push({ update, changes, before: this.text });
			this.text = applyChanges(this.text, changes);
			this.version++;
		}
		return accepted;
	}

	change(changes: ChangeSet, client = 'host'): SyncUpdate {
		this.text = applyChanges(this.text, changes);
		this.version++;
		return { client, changes: changes.toJSON() };
	}
}
