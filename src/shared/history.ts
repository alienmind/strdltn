// Navigation history for the Browser view: Back and Forward across searches, filters, pane fold states and tree
// expansion. Pure state machine with no DOM, so unit tests cover it directly.
import { CATEGORIES } from './catalog.ts';
import type { BrowserFilterState, BrowserPanes } from './browser.ts';

/** One stop in the Browser's history: everything needed to put the view back as it was. */
export interface BrowserSnapshot {
	filter: BrowserFilterState;
	panes: BrowserPanes;
	/** Categories unfolded in the Library and Reference trees, sorted. */
	tree: string[];
	/** Inner sections of the Library (such as Collections) that are open. */
	sections: Record<string, boolean>;
}

/** Serializable form kept in webview state across reloads. */
export interface BrowserHistoryState {
	entries: BrowserSnapshot[];
	index: number;
}

const DEFAULT_LIMIT = 50;

/** Deep copy in a normalized form so callers cannot mutate kept entries and comparisons are exact. */
export function cloneSnapshot(snapshot: BrowserSnapshot): BrowserSnapshot {
	const filter: BrowserFilterState = {
		category: snapshot.filter.category,
		query: snapshot.filter.query,
		chips: [...snapshot.filter.chips],
	};
	if (snapshot.filter.group !== undefined) filter.group = snapshot.filter.group;
	if (snapshot.filter.scope !== undefined) filter.scope = snapshot.filter.scope;
	if (snapshot.filter.place !== undefined) filter.place = snapshot.filter.place;
	if (snapshot.filter.builtin !== undefined) filter.builtin = snapshot.filter.builtin;
	if (snapshot.filter.color !== undefined) filter.color = snapshot.filter.color;
	const panes: BrowserPanes = {
		controls: snapshot.panes.controls ?? true,
		library: !!snapshot.panes.library,
		contents: !!snapshot.panes.contents,
		reference: !!snapshot.panes.reference,
	};
	const sections: Record<string, boolean> = {};
	for (const key of Object.keys(snapshot.sections).sort()) sections[key] = !!snapshot.sections[key];
	return {
		filter,
		panes,
		tree: [...new Set(snapshot.tree)].sort(),
		sections,
	};
}

/** True when two snapshots put the Browser in the exact same state. */
export function sameSnapshot(a: BrowserSnapshot, b: BrowserSnapshot): boolean {
	if (
		a.filter.category !== b.filter.category ||
		a.filter.group !== b.filter.group ||
		a.filter.scope !== b.filter.scope ||
		a.filter.place !== b.filter.place ||
		a.filter.builtin !== b.filter.builtin ||
		a.filter.color !== b.filter.color ||
		a.filter.query !== b.filter.query ||
		a.filter.chips.length !== b.filter.chips.length
	) {
		return false;
	}
	for (let i = 0; i < a.filter.chips.length; i++) if (a.filter.chips[i] !== b.filter.chips[i]) return false;
	if (
		a.panes.controls !== b.panes.controls ||
		a.panes.library !== b.panes.library ||
		a.panes.contents !== b.panes.contents ||
		a.panes.reference !== b.panes.reference
	) {
		return false;
	}
	if (a.tree.length !== b.tree.length) return false;
	for (let i = 0; i < a.tree.length; i++) if (a.tree[i] !== b.tree[i]) return false;
	const aKeys = Object.keys(a.sections);
	const bKeys = Object.keys(b.sections);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) if (a.sections[key] !== b.sections[key]) return false;
	return true;
}

/** Short label for the tooltip of the Back and Forward buttons. */
export function describeSnapshot(snapshot: BrowserSnapshot): string {
	const { filter, panes } = snapshot;
	const category = filter.category !== 'all' ? CATEGORIES.find((c) => c.id === filter.category)?.label : undefined;
	const where = [category, filter.group].filter(Boolean).join(' > ');
	const scope = !where && filter.scope === 'library' ? 'Library > All' : !where && filter.scope === 'reference' ? 'Reference > All' : '';
	const parts: string[] = [];
	if (filter.query.trim()) parts.push(`"${filter.query.trim()}"`);
	if (where) parts.push(parts.length ? `in ${where}` : where);
	else if (scope) parts.push(parts.length ? `in ${scope}` : scope);
	if (!parts.length) {
		if (panes.reference && !panes.contents) parts.push('Reference');
		else if (panes.library && !panes.contents) parts.push('Library');
		else parts.push('All');
	}
	if (filter.builtin !== undefined) parts.push(filter.builtin ? '(built in)' : '(not built in)');
	return parts.join(' ');
}

/**
 * Browser-style Back/Forward stack. Pushing a new state drops any forward states, skips consecutive duplicates, and
 * supports replacing the current entry so typing one search term stays one history stop.
 */
export class BrowserHistory {
	private entries: BrowserSnapshot[] = [];
	private index = -1;
	private readonly limit: number;

	constructor(saved?: BrowserHistoryState, limit = DEFAULT_LIMIT) {
		this.limit = limit;
		if (!saved || !Array.isArray(saved.entries) || !saved.entries.length) return;
		this.entries = saved.entries
			.filter((entry) => entry && typeof entry === 'object' && entry.filter && entry.panes && Array.isArray(entry.tree) && entry.sections)
			.slice(-limit)
			.map(cloneSnapshot);
		if (!this.entries.length) return;
		this.index = Math.max(0, Math.min(this.entries.length - 1, Number.isInteger(saved.index) ? saved.index : this.entries.length - 1));
	}

	/** Seeds the stack on start, or appends the initial state if a restored stack points somewhere else. */
	seed(snapshot: BrowserSnapshot): void {
		const next = cloneSnapshot(snapshot);
		if (!this.entries.length) {
			this.entries = [next];
			this.index = 0;
			return;
		}
		if (!sameSnapshot(this.entries[this.index], next)) this.push(next);
	}

	/** Records a new stop, or updates the current one when `replace` is set. Returns true when history changed. */
	push(snapshot: BrowserSnapshot, options?: { replace?: boolean }): boolean {
		const next = cloneSnapshot(snapshot);
		if (!this.entries.length) {
			this.entries = [next];
			this.index = 0;
			return true;
		}
		if (sameSnapshot(this.entries[this.index], next)) return false;
		if (options?.replace) {
			this.entries.splice(this.index + 1);
			this.entries[this.index] = next;
			return true;
		}
		this.entries.splice(this.index + 1);
		this.entries.push(next);
		if (this.entries.length > this.limit) this.entries.shift();
		this.index = this.entries.length - 1;
		return true;
	}

	canBack(): boolean {
		return this.index > 0;
	}

	canForward(): boolean {
		return this.index >= 0 && this.index < this.entries.length - 1;
	}

	peekBack(): BrowserSnapshot | undefined {
		return this.canBack() ? cloneSnapshot(this.entries[this.index - 1]) : undefined;
	}

	peekForward(): BrowserSnapshot | undefined {
		return this.canForward() ? cloneSnapshot(this.entries[this.index + 1]) : undefined;
	}

	back(): BrowserSnapshot | undefined {
		if (!this.canBack()) return undefined;
		this.index--;
		return cloneSnapshot(this.entries[this.index]);
	}

	forward(): BrowserSnapshot | undefined {
		if (!this.canForward()) return undefined;
		this.index++;
		return cloneSnapshot(this.entries[this.index]);
	}

	toState(): BrowserHistoryState {
		return { entries: this.entries.map(cloneSnapshot), index: this.index };
	}
}
