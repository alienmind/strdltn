// Search and filters of the Browser. Plain functions over the items, so the webview and
// the integration test filter the same way. `search.test.ts` holds the cases.
import { type CatalogItem, type CategoryId, colorsOf, type PlaceId, tagsOf, type UserIndex } from './catalog.ts';

export interface Filter {
	query: string;
	category: CategoryId;
	place?: PlaceId;
	/** True: only what comes with Strudel. False: only what does not (the project, the packs it loads). */
	builtin?: boolean;
	/** 1 to 7: only items with this color. */
	color?: number;
	/** Chosen chips, `Group/Tag`. */
	chips: string[];
}

/**
 * The terms of a search. Every term must match. `#kick` matches only tags; a plain term
 * matches the name, the tags and the text of the item (bank, folder, description).
 */
export function parseQuery(query: string): { words: string[]; tags: string[] } {
	const words: string[] = [];
	const tags: string[] = [];
	for (const raw of query.toLowerCase().split(/\s+/)) {
		if (!raw) continue;
		if (raw.startsWith('#') && raw.length > 1) tags.push(raw.slice(1));
		else words.push(raw);
	}
	return { words, tags };
}

/** A term matches a tag when it is in the tag's last part: `kick` matches `Drums/Kick`. */
function tagHas(tag: string, term: string): boolean {
	return tag.slice(tag.lastIndexOf('/') + 1).toLowerCase().includes(term);
}

export function matchesQuery(item: CatalogItem, query: ReturnType<typeof parseQuery>, tags: string[]): boolean {
	for (const term of query.tags) if (!tags.some((tag) => tagHas(tag, term))) return false;
	for (const term of query.words) {
		if (item.label.toLowerCase().includes(term)) continue;
		if (item.text.includes(term)) continue;
		if (tags.some((tag) => tagHas(tag, term))) continue;
		return false;
	}
	return true;
}

/**
 * Chips: any chip of a group, and every group that has a chosen chip. `Drums/Kick` with
 * `Drums/Snare` gives kicks and snares; adding `Maker/Roland` keeps the Roland ones.
 */
export function matchesChips(tags: string[], chips: string[]): boolean {
	const groups = new Map<string, string[]>();
	for (const chip of chips) {
		const group = chip.slice(0, chip.indexOf('/'));
		groups.set(group, [...(groups.get(group) ?? []), chip]);
	}
	for (const wanted of groups.values()) if (!wanted.some((chip) => tags.includes(chip))) return false;
	return true;
}

export function filterItems(items: CatalogItem[], filter: Filter, user: UserIndex): CatalogItem[] {
	const query = parseQuery(filter.query);
	return items.filter((item) => {
		if (filter.category !== 'all' && item.category !== filter.category) return false;
		if (filter.place && item.place !== filter.place) return false;
		if (filter.builtin !== undefined && (item.place === 'builtin') !== filter.builtin) return false;
		if (filter.color && !colorsOf(item, user).includes(filter.color)) return false;
		const tags = tagsOf(item, user);
		if (filter.chips.length && !matchesChips(tags, filter.chips)) return false;
		return matchesQuery(item, query, tags);
	});
}

/**
 * The chips to show above the results: every tag of the items in view, by group, with how
 * many items have it. Groups with one chip that every item has say nothing and are left out.
 */
export function chipGroups(items: CatalogItem[], user: UserIndex, order: readonly string[]): { group: string; chips: { tag: string; count: number }[] }[] {
	const counts = new Map<string, number>();
	for (const item of items) for (const tag of tagsOf(item, user)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	const groups = new Map<string, { tag: string; count: number }[]>();
	for (const [tag, count] of counts) {
		const group = tag.slice(0, tag.indexOf('/'));
		groups.set(group, [...(groups.get(group) ?? []), { tag, count }]);
	}
	const rank = (group: string) => {
		const index = order.indexOf(group);
		return index < 0 ? order.length : index;
	};
	return [...groups.entries()]
		.filter(([, chips]) => !(chips.length === 1 && chips[0].count === items.length))
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([group, chips]) => ({ group, chips: chips.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) }));
}

/** The results under their headings, in the order of first appearance after sorting by heading. */
export function groupItems(items: CatalogItem[], byCategory: boolean): { key: string; label: string; insert?: string; items: CatalogItem[] }[] {
	const groups = new Map<string, { key: string; label: string; insert?: string; items: CatalogItem[] }>();
	for (const item of items) {
		const key = byCategory ? item.category : item.group;
		let group = groups.get(key);
		if (!group) groups.set(key, (group = { key, label: key, insert: byCategory ? undefined : item.groupInsert, items: [] }));
		group.items.push(item);
	}
	const list = [...groups.values()];
	for (const group of list) group.items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
	if (!byCategory) list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
	return list;
}
