// Per-song Undo/Redo text stack for the Undo and Redo buttons of Music Controls. Pure state machine with no VS Code
// dependency so unit tests cover it directly.
import { diffText } from './protocol.ts';

const DEFAULT_LIMIT = 100;
const COALESCE_MS = 600;

export type ChangeReason = 'undo' | 'redo';

/** True when a single diff looks like typing one or two characters, or adjusting a short value. */
function isSmallTypingEdit(before: string, after: string): boolean {
	const diff = diffText(before, after);
	if (!diff) return false;
	const removed = diff.to - diff.from;
	const inserted = diff.insert.length;
	return removed <= 2 && inserted <= 2 && !diff.insert.includes('\n') && !before.slice(diff.from, diff.to).includes('\n');
}

/**
 * Keeps up to `limit` snapshots of a song's text (`\n` line endings). Consecutive small typing edits within 600 ms
 * coalesce into one undo stop; discrete edits (Mixer toggles, cables, inserts, pastes, pauses) each get their own.
 */
export class UndoStack {
	private entries: string[] = [];
	private index = -1;
	private lastEditAt = 0;
	private readonly limit: number;
	private readonly coalesceMs: number;

	constructor(limit = DEFAULT_LIMIT, coalesceMs = COALESCE_MS) {
		this.limit = limit;
		this.coalesceMs = coalesceMs;
	}

	/** Seeds the stack when a song is first opened; no-op once already seeded. */
	seed(text: string): void {
		if (this.entries.length) return;
		this.entries = [text];
		this.index = 0;
	}

	/** Records a document change. Syncs the pointer when VS Code reports an explicit native undo/redo. */
	record(text: string, options?: { now?: number; reason?: ChangeReason }): boolean {
		if (!this.entries.length) {
			this.entries = [text];
			this.index = 0;
			return false;
		}
		const current = this.entries[this.index];
		if (text === current) return false;
		if (options?.reason === 'undo' && this.index > 0 && this.entries[this.index - 1] === text) {
			this.index--;
			this.lastEditAt = 0;
			return true;
		}
		if (options?.reason === 'redo' && this.index < this.entries.length - 1 && this.entries[this.index + 1] === text) {
			this.index++;
			this.lastEditAt = 0;
			return true;
		}
		const now = options?.now ?? Date.now();
		if (
			this.index > 0 &&
			this.index === this.entries.length - 1 &&
			this.lastEditAt > 0 &&
			now - this.lastEditAt < this.coalesceMs &&
			isSmallTypingEdit(this.entries[this.index - 1], current) &&
			isSmallTypingEdit(current, text)
		) {
			this.entries[this.index] = text;
			this.lastEditAt = now;
			return true;
		}
		this.entries.splice(this.index + 1);
		this.entries.push(text);
		if (this.entries.length > this.limit) this.entries.shift();
		this.index = this.entries.length - 1;
		this.lastEditAt = now;
		return true;
	}

	canUndo(): boolean {
		return this.index > 0;
	}

	canRedo(): boolean {
		return this.index >= 0 && this.index < this.entries.length - 1;
	}

	undo(): string | undefined {
		if (!this.canUndo()) return undefined;
		this.index--;
		this.lastEditAt = 0;
		return this.entries[this.index];
	}

	redo(): string | undefined {
		if (!this.canRedo()) return undefined;
		this.index++;
		this.lastEditAt = 0;
		return this.entries[this.index];
	}
}
