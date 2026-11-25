// The page of the Browser: one view with three panes, Library, Contents and Reference. Library and Reference are
// trees that pick what is shown (Library also holds the search and the colors); Contents shows what they pick, a flat
// list with its chips and details, and is called Results while a search is typed. The panes fold like the sections of
// a VS Code side bar, but by our rules: picking something shows Contents alone, at full height. One view, because VS
// Code gives an extension no way to fold one of its views (measured in 1.147). See "Browser" in doc/ARCHITECTURE.md.
import './browser.css';
import { type BrowserFilterState, type BrowserPage, type FromBrowser, pageOf, scoped, type ToBrowser } from '../shared/browser.ts';
import { CATEGORIES, type CatalogItem, COLOR_COUNT, colorsOf, emptyUserIndex, inCategory, opens, parentOf, PLACES, type SavedSearch, tagsOf, type UserIndex } from '../shared/catalog.ts';
import type { PreviewPlan } from '../shared/preview.ts';
import { chipGroups, filterItems, groupItems } from '../shared/search.ts';
import { TAG_GROUPS } from '../shared/tags.ts';
import { createControls } from './controls.ts';
import { icon } from './icons.ts';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const post = (message: FromBrowser) => vscode.postMessage(message);

/** A sound with more variations than this shows the first ones. The rest still play with `name:n`. */
const MAX_VARIATIONS = 64;
/** Chips shown per group before "+ more". */
const CHIPS_SHOWN = 8;

type Row =
	| { type: 'heading'; key: string; label: string; count: number; insert?: string; open: boolean }
	| { type: 'item'; item: CatalogItem; depth: number }
	| { type: 'variation'; item: CatalogItem; index: number; depth: number };

interface Saved {
	sections: Record<string, boolean>;
	headings: Record<string, boolean>;
	chipsOpen: string[];
	panes?: Record<Pane, boolean>;
	/** Tree rows the user unfolded: a category id, or `<category>|<group>` is never needed. */
	tree?: string[];
}

/** The three panes of the view. */
type Pane = 'library' | 'contents' | 'reference';

const saved = (vscode.getState() as Saved | undefined) ?? undefined;
let items: CatalogItem[] = [];
let user: UserIndex = emptyUserIndex();
let preview = true;
let filter: BrowserFilterState = { category: 'all', query: '', chips: [] };
const sections: Record<string, boolean> = saved?.sections ?? { collections: true, library: true, places: false };
/** Headings the user opened or closed, by category and key. Cleared when the search changes. */
let headings: Record<string, boolean> = saved?.headings ?? {};
const chipsOpen = new Set<string>(saved?.chipsOpen ?? []);
const openItems = new Set<string>();
let rows: Row[] = [];
let results: CatalogItem[] = [];
/** Keys of the selected rows, and the row the keyboard is on. */
const selection = new Set<string>();
let cursor = -1;
let anchor = -1;

const panes: Record<Pane, boolean> = saved?.panes ?? { library: true, contents: true, reference: false };
/** Categories unfolded in the trees, so their groups show under them. */
const tree = new Set<string>(saved?.tree ?? []);
const keep = () => vscode.setState({ sections, headings, chipsOpen: [...chipsOpen], panes, tree: [...tree] } satisfies Saved);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};
const button = (name: string, title: string, onClick: (event: MouseEvent) => void, className = 'icon-button') => {
	const b = el('button', className);
	b.innerHTML = icon(name);
	b.title = title;
	b.addEventListener('click', (event) => {
		event.stopPropagation();
		onClick(event);
	});
	return b;
};
const rowKey = (row: Row) => (row.type === 'heading' ? `h:${row.key}` : row.type === 'item' ? row.item.id : `${row.item.id}#${row.index}`);
const colorVar = (color: number) => `var(--c${color})`;
const filtered = () => !!(filter.query.trim() || filter.chips.length || filter.color || filter.place || filter.builtin !== undefined);
/** The items a tree picks from: functions in the Reference, everything else in the Library. */
const itemsOf = (of: BrowserPage) => items.filter((item) => pageOf(item) === of);

// ---- the page ---------------------------------------------------------------------------

const app = document.getElementById('app')!;
// Nothing shows before `init`.
app.hidden = true;

/** A pane: a header like a VS Code section, and a body. */
function pane(id: Pane, title: string): { box: HTMLElement; head: HTMLElement; title: HTMLElement; count: HTMLElement; body: HTMLElement } {
	const box = app.appendChild(el('div', `pane pane-${id}`));
	const head = box.appendChild(el('div', 'pane-head'));
	head.tabIndex = 0;
	head.innerHTML = icon('chevron');
	const name = head.appendChild(el('span', 'pane-title', title));
	const count = head.appendChild(el('span', 'pane-count'));
	head.addEventListener('click', () => togglePane(id));
	head.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			togglePane(id);
		}
	});
	const body = box.appendChild(el('div', 'pane-body'));
	return { box, head, title: name, count, body };
}
const libraryPane = pane('library', 'Library');
const contentsPane = pane('contents', 'Contents');
const referencePane = pane('reference', 'Reference');
// Music Controls on top of the Library, then the search.
const controlsBox = libraryPane.body.appendChild(el('div'));
const showControls = createControls(controlsBox, post);
const searchbar = libraryPane.body.appendChild(el('div', 'searchbar'));
const searchBox = searchbar.appendChild(el('div', 'search'));
searchBox.innerHTML = icon('search');
const search = searchBox.appendChild(el('input'));
search.placeholder = 'Search (Ctrl+F)';
search.value = filter.query;
search.spellcheck = false;
const clearSearch = searchBox.appendChild(button('close', 'Clear the search (Esc)', () => setQuery('')));
const previewButton = searchbar.appendChild(button('speaker', '', () => post({ type: 'setPreview', on: !preview })));
// The colors and the Built-in button, right under the search: they filter like it does.
const colorbar = libraryPane.body.appendChild(el('div', 'colorbar'));
const nav = libraryPane.body.appendChild(el('div', 'nav'));
// The user manual of the latest release, at the foot of the Library (the maintainer, 2026-11-22).
const manual = libraryPane.body.appendChild(el('button', 'manual-link', 'User manual (PDF)'));
manual.title = 'Opens the user manual of the latest release in your browser';
manual.addEventListener('click', () => post({ type: 'openManual' }));
const chips = contentsPane.body.appendChild(el('div', 'chips'));
const resultbar = contentsPane.body.appendChild(el('div', 'resultbar'));
const resultsBox = contentsPane.body.appendChild(el('div', 'results'));
resultsBox.tabIndex = 0;
const spacer = resultsBox.appendChild(el('div', 'spacer'));
const details = contentsPane.body.appendChild(el('div', 'details'));
const referenceNav = referencePane.body.appendChild(el('div', 'nav'));

/**
 * The fold rules the maintainer asked for (2026-11-25). Opening Reference folds the other two, so it gets the height.
 * Library and Contents fold and open by their headers.
 */
function togglePane(id: Pane): void {
	panes[id] = !panes[id];
	if (id === 'reference' && panes.reference) panes.library = panes.contents = false;
	update();
}

/** Something was picked in a tree: Contents alone shows it, at full height. */
function showContents(): void {
	panes.library = panes.reference = false;
	panes.contents = true;
}

function drawPanes(): void {
	for (const [id, part] of [['library', libraryPane], ['contents', contentsPane], ['reference', referencePane]] as const) {
		part.box.classList.toggle('open', panes[id]);
		part.head.setAttribute('aria-expanded', String(panes[id]));
	}
	// The pane that takes the height that is left: Contents when it is open, else the one open pane.
	const grow: Pane | undefined = panes.contents ? 'contents' : panes.reference ? 'reference' : panes.library ? 'library' : undefined;
	libraryPane.box.classList.toggle('grow', grow === 'library');
	contentsPane.box.classList.toggle('grow', grow === 'contents');
	referencePane.box.classList.toggle('grow', grow === 'reference');
	// Results only while a search is typed; else it shows the contents of what is picked.
	contentsPane.title.textContent = filter.query.trim() ? 'Results' : 'Contents';
	contentsPane.count.textContent = String(results.length);
}
let menu: HTMLElement | undefined;
let dialog: HTMLElement | undefined;

let searchTimer: ReturnType<typeof setTimeout> | undefined;
search.addEventListener('input', () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => setQuery(search.value), 80);
});
search.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') setQuery('');
});
document.addEventListener('keydown', (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
		event.preventDefault();
		focusSearch();
	}
	if (event.key === 'Escape') closePopups();
});
document.addEventListener('mousedown', (event) => {
	if (menu && !menu.contains(event.target as Node)) closeMenu();
});
resultsBox.addEventListener('scroll', () => drawRows());
new ResizeObserver(() => drawRows()).observe(resultsBox);
resultsBox.addEventListener('keydown', onResultsKey);

/** The search field is in the Library: the Library opens for it. */
function focusSearch(): void {
	if (!panes.library) {
		panes.library = true;
		update();
	}
	search.focus();
	search.select();
}

function setQuery(query: string): void {
	search.value = query;
	if (query === filter.query) return;
	// What a search finds shows in Contents, under the Library where it is typed.
	if (query.trim()) panes.contents = true;
	setFilter({ query });
}

/** A change made in this view. The host hands it to the other three. */
function setFilter(change: Partial<BrowserFilterState>): void {
	filter = { ...filter, ...change };
	headings = {};
	post({ type: 'filter', filter });
	update();
}

// ---- drawing ----------------------------------------------------------------------------

function update(): void {
	keep();
	clearSearch.style.visibility = filter.query ? 'visible' : 'hidden';
	previewButton.innerHTML = icon(preview ? 'speaker' : 'mute');
	previewButton.classList.toggle('on', preview);
	previewButton.title = preview ? 'Preview on click is ON. Press to turn it off' : 'Preview on click is OFF. Press to turn it on';
	drawNav();
	const shown = drawChips();
	results = filterItems(scoped(items, filter), filter, user);
	drawPanes();
	buildRows();
	drawResultbar();
	drawRows();
	drawDetails();
	post({ type: 'state', filter, results: results.length, rows: rows.length, chips: shown, panes: { ...panes } });
}

function section(id: string, title: string, body: (into: HTMLElement) => void): HTMLElement {
	const box = el('div', `section${sections[id] ? ' open' : ''}`);
	const head = box.appendChild(el('div', 'section-head'));
	const chev = head.appendChild(el('span', 'chev'));
	chev.innerHTML = icon('chevron');
	head.appendChild(el('span', '', title));
	head.addEventListener('click', () => {
		sections[id] = !sections[id];
		update();
	});
	body(box.appendChild(el('div', 'section-body')));
	return box;
}

/** The seven colors and the Built-in button, in one row under the search field of the Library. */
function drawColorbar(): void {
	colorbar.replaceChildren();
	const dots = colorbar.appendChild(el('div', 'colors-row'));
	for (let color = 1; color <= COLOR_COUNT; color++) {
		const dot = dots.appendChild(el('span', `dot${filter.color === color ? ' active' : ''}`));
		dot.style.background = colorVar(color);
		const count = items.filter((item) => colorsOf(item, user).includes(color)).length;
		dot.title = `${user.colorNames[color - 1]}: ${count} items. Keys 1 to 7 color the selected rows. Right click to rename.`;
		dot.addEventListener('click', () => setFilter({ color: filter.color === color ? undefined : color }));
		dot.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			openMenu(event, [{ label: `Rename "${user.colorNames[color - 1]}"...`, run: () => renameColor(color) }]);
		});
	}
	// Where an item comes from, as one more condition: built in, or not (the project and
	// the packs it loads). It took the place of Places.
	const builtin = colorbar.appendChild(el('button', `chip builtin${filter.builtin === undefined ? '' : ' on'}`, filter.builtin === false ? 'Not built-in' : 'Built-in'));
	builtin.title =
		filter.builtin === undefined
			? 'Everything. Click: only what comes with Strudel'
			: filter.builtin
				? 'Only what comes with Strudel. Click: only what does not (your project, the packs it loads)'
				: 'Only your project and the packs it loads. Click: everything';
	builtin.addEventListener('click', () => setFilter({ builtin: filter.builtin === undefined ? true : filter.builtin ? false : undefined, place: undefined }));
}

function drawNav(): void {
	drawColorbar();
	nav.replaceChildren(
		// Saved searches, when there are any. The colors are under the search field.
		...(!user.searches.length
			? []
			: [
					section('collections', 'Collections', (body) => {
						for (const saved of user.searches) {
							const row = body.appendChild(navRow('save', saved.name, undefined, isSaved(saved)));
							row.title = describeSearch(saved);
							row.addEventListener('click', () => applySearch(saved));
							row.addEventListener('contextmenu', (event) => {
								event.preventDefault();
								openMenu(event, [{ label: `Delete "${saved.name}"`, run: () => post({ type: 'deleteSearch', name: saved.name }) }]);
							});
						}
					}),
				]),
		categories((body) => drawTree(body, 'library')),
	);
	referenceNav.replaceChildren(categories((body) => drawTree(body, 'reference')));
}

/**
 * A tree of the Library or the Reference: All, the categories, the children of a parent category (Plugins > FM-1
 * Synths), and under each category its groups (Installed and Available, Synths and Soundfonts, the banks, the
 * folders). A click picks one for Contents, and Contents alone shows; a click on what is picked goes one level up. A
 * category unfolds when it is picked; its arrow folds it.
 */
function drawTree(body: HTMLElement, of: BrowserPage): void {
	const own = itemsOf(of);
	const allOn = filter.category === 'all' && filter.scope === of;
	const all = body.appendChild(navRow('all', 'All', own.length, allOn, 0));
	all.addEventListener('click', () => pick(allOn ? { category: 'all', scope: undefined } : { category: 'all', scope: of }));
	for (const category of CATEGORIES) {
		if (category.id === 'all') continue;
		const mine = own.filter((item) => inCategory(item.category, category.id));
		// Plugins and FM-1 Synths show in the Library while empty: FM-1 Synths is where the hub's list loads.
		if (!mine.length && !(of === 'library' && (category.id === 'plugins' || category.id === 'fm1'))) continue;
		const parent = parentOf(category.id);
		if (parent && !tree.has(parent)) continue;
		const children = CATEGORIES.filter((c) => parentOf(c.id) === category.id);
		const groups = children.length ? [] : groupsOf(mine);
		const foldable = children.length > 0 || groups.length > 1;
		const unfolded = foldable && tree.has(category.id);
		const on = filter.category === category.id && !filter.group;
		const row = body.appendChild(navRow(category.icon, category.label, mine.length, on, parent ? 1 : 0, foldable ? unfolded : undefined));
		row.addEventListener('click', (event) => {
			if ((event.target as HTMLElement).closest('.twisty')) {
				if (unfolded) tree.delete(category.id);
				else tree.add(category.id);
				return update();
			}
			if (foldable) tree.add(category.id);
			pick(on ? { category: 'all', scope: undefined } : { category: category.id, scope: undefined });
		});
		if (!unfolded) continue;
		for (const group of groups) {
			const groupOn = filter.category === category.id && filter.group === group.key;
			const groupRow = body.appendChild(navRow('', group.label, group.items.length, groupOn, parent ? 2 : 1));
			groupRow.addEventListener('click', () => pick(groupOn ? { category: category.id, scope: undefined } : { category: category.id, group: group.key, scope: undefined }));
			// A bank's button types `.bank("...")`, as its heading in the results did.
			if (group.insert) {
				groupRow.insertBefore(button('insert', `Insert ${group.insert} at the cursor`, () => post({ type: 'insertText', text: group.insert! })), groupRow.lastChild);
			}
		}
	}
}

/** The groups of a category, in their order: Installed before Available, else by name. */
function groupsOf(list: CatalogItem[]): { key: string; label: string; insert?: string; items: CatalogItem[] }[] {
	return groupItems(list, false);
}

/** A row of a tree was picked: the filter changes, Contents alone shows it. */
function pick(change: Partial<BrowserFilterState>): void {
	showContents();
	setFilter({ group: undefined, chips: [], ...change });
}

function categories(body: (into: HTMLElement) => void): HTMLElement {
	const box = el('div', 'categories');
	body(box);
	return box;
}

/** A row of a tree. `depth` indents it; `unfolded` gives it an arrow, true when its children show. */
function navRow(iconName: string, label: string, count: number | undefined, active: boolean, depth = 0, unfolded?: boolean): HTMLElement {
	const row = el('div', `nav-row${active ? ' active' : ''}`);
	row.style.paddingLeft = `${4 + depth * 14}px`;
	const twisty = row.appendChild(el('span', `twisty${unfolded ? ' open' : ''}`));
	if (unfolded !== undefined) twisty.innerHTML = icon('chevron');
	if (iconName) row.insertAdjacentHTML('beforeend', icon(iconName));
	row.appendChild(el('span', 'name', label));
	if (count !== undefined) row.appendChild(el('span', 'count', String(count)));
	return row;
}

/** The chips of the items the other filters leave, so a chip never leads to nothing. Returns how many are shown. */
function drawChips(): number {
	chips.replaceChildren();
	const pool = filterItems(scoped(items, filter), { ...filter, chips: [] }, user);
	let shown = 0;
	for (const { group, chips: list } of chipGroups(pool, user, TAG_GROUPS)) {
		const line = chips.appendChild(el('div', 'chip-group'));
		line.appendChild(el('span', 'group-name', group));
		const open = chipsOpen.has(group);
		const visible = open ? list : list.filter((chip, index) => index < CHIPS_SHOWN || filter.chips.includes(chip.tag));
		for (const { tag, count } of visible) {
			const on = filter.chips.includes(tag);
			const chip = line.appendChild(el('span', `chip${on ? ' on' : ''}`, tag.slice(group.length + 1)));
			chip.title = `${tag}: ${count}. Ctrl+click for several of a group.`;
			chip.addEventListener('click', (event) => toggleChip(tag, event.ctrlKey || event.metaKey));
			shown++;
		}
		if (list.length > visible.length || open) {
			const more = line.appendChild(el('span', 'chip more', open ? 'less' : `+${list.length - visible.length}`));
			more.addEventListener('click', () => {
				if (open) chipsOpen.delete(group);
				else chipsOpen.add(group);
				update();
			});
		}
	}
	return shown;
}

/** A click picks one chip of its group; Ctrl+click adds it to the ones of its group, as in Live. */
function toggleChip(tag: string, add: boolean): void {
	const group = tag.slice(0, tag.indexOf('/') + 1);
	let next = filter.chips.includes(tag) ? filter.chips.filter((chip) => chip !== tag) : add ? [...filter.chips, tag] : [...filter.chips.filter((chip) => !chip.startsWith(group)), tag];
	next = [...new Set(next)];
	setFilter({ chips: next });
}

function drawResultbar(): void {
	resultbar.replaceChildren();
	const scopes: Record<BrowserPage, string> = { library: 'Library', reference: 'Reference', results: '' };
	const category = filter.category !== 'all' ? CATEGORIES.find((c) => c.id === filter.category)?.label : filter.scope ? scopes[filter.scope] : '';
	const where = [category, filter.group].filter(Boolean).join(' > ');
	// "Results" only for a search, as the pane's title: else it is what the tree picked.
	const noun = filter.query.trim() ? (results.length === 1 ? 'result' : 'results') : results.length === 1 ? 'item' : 'items';
	const parts = [`${results.length} ${noun}`, where ? `in ${where}` : ''];
	if (filter.color) parts.push(user.colorNames[filter.color - 1]);
	if (filter.place) parts.push(PLACES.find((p) => p.id === filter.place)?.label ?? '');
	if (filter.builtin !== undefined) parts.push(filter.builtin ? 'built in' : 'not built in');
	resultbar.appendChild(el('span', 'summary', parts.filter(Boolean).join(' ')));
	if (filtered()) {
		resultbar.appendChild(button('save', 'Save this search under Collections', () => saveSearch()));
		resultbar.appendChild(button('close', 'Clear the search and the filters', () => setFilter({ query: '', chips: [], color: undefined, place: undefined, builtin: undefined })));
	}
}

/**
 * Contents: a flat list, in the order of the groups the trees show, with no headings: the groups are in the trees now
 * (the maintainer, 2026-11-25).
 */
function buildRows(): void {
	const groups = groupItems(results, filter.category === 'all');
	rows = [];
	for (const group of groups) {
		for (const item of group.items) {
			rows.push({ type: 'item', item, depth: 0 });
			if (item.count && openItems.has(item.id)) {
				for (let index = 0; index < Math.min(item.count, MAX_VARIATIONS); index++) rows.push({ type: 'variation', item, index, depth: 2 });
			}
		}
	}
	if (cursor >= rows.length) cursor = rows.length - 1;
}

function rowHeight(): number {
	return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row')) || 22;
}

/** A firmware's row is taller: its picture sits under its name. */
const isTall = (row: Row) => row.type === 'item' && row.item.kind === 'firmware';
function tallHeight(): number {
	return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-tall')) || 98;
}

/** Where each row starts, and the height of all of them, worked out again when the rows are drawn. */
let tops: number[] = [];
let total = 0;
function layout(): void {
	const height = rowHeight();
	const tall = tallHeight();
	tops = [];
	total = 0;
	for (const row of rows) {
		tops.push(total);
		total += isTall(row) ? tall : height;
	}
}
const heightAt = (index: number) => (tops[index + 1] ?? total) - (tops[index] ?? 0);
/** The row at a height of the list. */
function rowAt(y: number): number {
	let low = 0;
	let high = tops.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (tops[mid] <= y) low = mid;
		else high = mid - 1;
	}
	return Math.max(0, low);
}

/** Only the rows in sight exist in the page. 2000 rows would make every keystroke slow. */
function drawRows(): void {
	layout();
	spacer.style.height = `${total}px`;
	const first = Math.max(0, rowAt(resultsBox.scrollTop) - 5);
	const last = Math.min(rows.length, rowAt(resultsBox.scrollTop + resultsBox.clientHeight) + 6);
	spacer.replaceChildren();
	if (!rows.length) {
		spacer.appendChild(el('div', 'empty', emptyText()));
		return;
	}
	for (let index = first; index < last; index++) spacer.appendChild(drawRow(rows[index], index));
}

/** What an empty Results says. An empty FM-1 Synths says how a firmware gets there. */
function emptyText(): string {
	if (!items.length) return 'Loading...';
	if ((filter.category === 'fm1' || filter.category === 'plugins') && !items.some((item) => item.kind === 'firmware'))
		return 'Loading the list of The Firmware Hub... Without a network, put a VIBE FM firmware (.wasm) in a firmware folder of the project.';
	return 'Nothing matches. Clear the search or the filters.';
}

function drawRow(row: Row, index: number): HTMLElement {
	const key = rowKey(row);
	const node = el('div', `row${selection.has(key) ? ' selected' : ''}${index === cursor ? ' cursor' : ''}`);
	node.style.top = `${tops[index]}px`;
	node.style.height = `${heightAt(index)}px`;
	const depth = row.type === 'heading' ? 0 : row.depth;
	node.style.paddingLeft = `${4 + depth * 14}px`;
	const twisty = node.appendChild(el('span', 'twisty'));
	if (row.type === 'heading') {
		node.classList.add('heading');
		if (row.open) node.classList.add('open');
		twisty.innerHTML = icon('chevron');
		node.appendChild(el('span', 'label', row.label));
		node.appendChild(el('span', 'detail', String(row.count)));
		const actions = node.appendChild(el('span', 'actions'));
		if (row.insert) actions.appendChild(button('insert', `Insert ${row.insert} at the cursor`, () => post({ type: 'insertText', text: row.insert! })));
	} else {
		const { item } = row;
		if (row.type === 'item' && item.count) {
			if (openItems.has(item.id)) node.classList.add('open');
			twisty.innerHTML = icon('chevron');
			twisty.addEventListener('click', (event) => {
				event.stopPropagation();
				toggleItem(item);
			});
		}
		const kindIcon = el('span');
		kindIcon.innerHTML = icon(iconOf(item));
		node.appendChild(kindIcon);
		const label = row.type === 'variation' ? variationLabel(item, row.index) : item.label;
		node.appendChild(el('span', 'label', label));
		// The bank or folder, unless a group is picked in the tree and says it already.
		const detail = item.detail ?? (!filter.group && item.group !== '.' ? item.group : '');
		node.appendChild(el('span', 'detail', row.type === 'item' ? [item.count ? String(item.count) : '', detail].filter(Boolean).join('  ') : ''));
		const squares = node.appendChild(el('span', 'squares'));
		for (const color of colorsOf(item, user)) squares.appendChild(el('span', 'sq')).style.background = colorVar(color);
		const actions = node.appendChild(el('span', 'actions'));
		const index_ = row.type === 'variation' ? row.index : undefined;
		if (isTall(row)) {
			node.classList.add('tall');
			// The firmware's display, made by the host from a moment of running it (src/extension/previews.ts).
			const picture = node.appendChild(el('div', 'picture'));
			picture.style.left = `${4 + depth * 14 + 42}px`;
			if (item.image) {
				const image = picture.appendChild(el('img'));
				image.src = item.image;
				image.alt = `The screen of ${item.label}`;
				image.draggable = false;
			} else picture.appendChild(el('span', '', 'No preview yet'));
			// Said by the badge unless the tree's Available is picked, which says it already.
			if (item.available && filter.group !== 'Available') picture.appendChild(el('span', 'badge', 'Available'));
		}
		if (item.sound) actions.appendChild(button('play', 'Play once', () => post({ type: 'play', id: item.id, index: index_ })));
		if (item.available) actions.appendChild(button('install', 'Install into the project (double click)', () => post({ type: 'install', id: item.id })));
		else if (opens(item)) actions.appendChild(button('open', item.kind === 'render' ? 'Play' : 'Open', () => post({ type: 'open', id: item.id })));
		else actions.appendChild(button('insert', 'Insert at the cursor (Enter)', () => post({ type: 'insert', id: item.id, index: index_ })));
		// A song's code, without its header, at the cursor, as a snippet's (DAW-PLAN "Insert a song").
		if (item.kind === 'song') actions.appendChild(button('insert', 'Insert at the cursor: the song\'s code, without its header', () => post({ type: 'insertSong', id: item.id })));
		// A function's example from the reference, as it is (DAW-PLAN "Insert an example").
		if (item.kind === 'function' && item.code) actions.appendChild(button('snippet', 'Insert an example', () => post({ type: 'insertText', text: item.code! })));
		// The firmware's display, run in a popup without sound (Firmware Marketplace in doc/TODO.md).
		if (item.kind === 'firmware') actions.appendChild(button('screen', 'Show the screen', () => post({ type: 'screen', id: item.id })));
		if (item.kind === 'snippet') actions.appendChild(button('open', 'Open the file', () => post({ type: 'open', id: item.id })));
		else if (!opens(item)) actions.appendChild(button('copy', 'Copy the name', () => post({ type: 'copy', id: item.id, index: index_ })));
		// Colors and tags have their own button: a right click or the keys 1 to 7 were the
		// only ways in, and the maintainer found no way to put a sound in a collection.
		actions.appendChild(
			button('tag', 'Colors and tags', (event) => {
				if (!selection.has(key)) select(index, false, false);
				openMenu(event, ['colors', 'separator', { label: 'Edit tags...', run: () => editTags() }]);
			}),
		);
	}
	node.addEventListener('click', (event) => onRowClick(index, event));
	node.addEventListener('dblclick', () => openRow(rows[index]));
	node.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		if (!selection.has(key)) select(index, false, false);
		openMenu(event, menuFor(rows[index]));
	});
	return node;
}

/**
 * `bd:3` under the bank `akaixr10`, not `akaixr10_bd:3`: the heading already names the
 * bank, as the row of the sound does. Play, insert and copy still use the full name.
 */
function variationLabel(item: CatalogItem, index: number): string {
	return `${item.label}:${item.variations?.[index] ?? index}`;
}

function iconOf(item: CatalogItem): string {
	if (item.kind === 'render') return 'render';
	if (item.kind !== 'sound') return item.kind;
	return CATEGORIES.find((c) => c.id === item.category)?.icon ?? 'sample';
}

function drawDetails(): void {
	details.replaceChildren();
	const row = rows[cursor];
	if (!row || row.type === 'heading') return;
	const { item } = row;
	const title = details.appendChild(el('h3'));
	title.innerHTML = icon(iconOf(item));
	title.appendChild(el('span', '', row.type === 'variation' ? variationLabel(item, row.index) : item.label));
	const kind = CATEGORIES.find((c) => c.id === item.category)?.label ?? item.kind;
	details.appendChild(el('div', 'sub', [kind, item.group, item.count ? `${item.count} variations` : '', item.path ?? ''].filter(Boolean).join('  -  ')));
	const tags = tagsOf(item, user);
	const colors = colorsOf(item, user);
	// The collections of this item, as the dots of Collections: a click puts it in one or
	// takes it out. With several rows selected, it applies to all of them.
	const targets = selectedItems().some((selected) => selected.id === item.id) ? selectedItems() : [item];
	const collect = details.appendChild(el('div', 'collect'));
	for (let color = 1; color <= COLOR_COUNT; color++) {
		const on = targets.every((target) => colorsOf(target, user).includes(color));
		const dot = collect.appendChild(el('span', `dot${on ? ' active' : ''}`));
		dot.style.background = colorVar(color);
		dot.title = `${on ? 'Take out of' : 'Put in'} "${user.colorNames[color - 1]}" (key ${color})`;
		dot.addEventListener('click', () => post({ type: 'color', ids: targets.map((target) => target.id), color, on: !on }));
	}
	if (item.available) {
		const install = collect.appendChild(el('button', 'chip more', 'Install'));
		install.title = 'Install it into the firmware folder of the project';
		install.addEventListener('click', () => post({ type: 'install', id: item.id }));
	}
	if (item.kind === 'firmware') {
		const screen = collect.appendChild(el('button', 'chip more', 'Screen...'));
		screen.title = "Show the firmware's display, run without sound";
		screen.addEventListener('click', () => post({ type: 'screen', id: item.id }));
	}
	const tagButton = collect.appendChild(el('button', 'chip more', 'Tags...'));
	tagButton.title = 'Add or remove your own tags';
	tagButton.addEventListener('click', () => {
		if (!targets.some((target) => selectedItems().includes(target))) select(cursor, false, false);
		editTags();
	});
	if (tags.length || colors.length) {
		const box = details.appendChild(el('div', 'tags'));
		for (const color of colors) {
			const chip = box.appendChild(el('span', 'chip on', user.colorNames[color - 1]));
			chip.style.background = colorVar(color);
		}
		for (const tag of tags) {
			const chip = box.appendChild(el('span', `chip${filter.chips.includes(tag) ? ' on' : ''}`, tag));
			chip.title = 'Filter by this tag';
			chip.addEventListener('click', () => toggleChip(tag, true));
		}
	}
	if (item.image) {
		const picture = details.appendChild(el('img', 'picture'));
		picture.src = item.image;
		picture.alt = `The screen of ${item.label}`;
	}
	if (item.description) details.appendChild(el('p', '', item.description));
	const fields = (item.fields ?? []).filter((field) => !['details', 'tags', 'category'].includes(field.name));
	if (fields.length) {
		const table = details.appendChild(el('table'));
		for (const field of fields) {
			const tr = table.appendChild(el('tr'));
			tr.appendChild(el('td', '', field.name));
			tr.appendChild(el('td', '', field.value));
		}
	}
	if (item.code) {
		const lines = item.code.split('\n');
		details.appendChild(el('pre', '', lines.length > 30 ? `${lines.slice(0, 30).join('\n')}\n// ... ${lines.length - 30} more lines` : item.code));
	}
}

// ---- selection and keys -----------------------------------------------------------------

function select(index: number, add: boolean, range: boolean): void {
	if (range && anchor >= 0) {
		if (!add) selection.clear();
		for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) if (rows[i].type !== 'heading') selection.add(rowKey(rows[i]));
	} else if (add) {
		const key = rowKey(rows[index]);
		if (selection.has(key)) selection.delete(key);
		else selection.add(key);
		anchor = index;
	} else {
		selection.clear();
		if (rows[index].type !== 'heading') selection.add(rowKey(rows[index]));
		anchor = index;
	}
	cursor = index;
	drawRows();
	drawDetails();
}

function moveCursor(index: number, extend: boolean): void {
	if (!rows.length) return;
	index = Math.max(0, Math.min(rows.length - 1, index));
	select(index, false, extend);
	const height = heightAt(index);
	const top = tops[index] ?? 0;
	if (top < resultsBox.scrollTop) resultsBox.scrollTop = top;
	else if (top + height > resultsBox.scrollTop + resultsBox.clientHeight) resultsBox.scrollTop = top + height - resultsBox.clientHeight;
	drawRows();
}

function onRowClick(index: number, event: MouseEvent): void {
	resultsBox.focus();
	const row = rows[index];
	if (row.type === 'heading' && !event.ctrlKey && !event.shiftKey) {
		cursor = index;
		return toggleHeading(row);
	}
	select(index, event.ctrlKey || event.metaKey, event.shiftKey);
	// A click plays a sound when preview is on. It never types: that is Enter, a double
	// click (not on a snippet, which opens) or the insert button.
	if (preview && !event.ctrlKey && !event.shiftKey && row.type !== 'heading' && row.item.sound) playRow(row);
}

function playRow(row: Row): void {
	if (row.type === 'heading' || !row.item.sound) return;
	post({ type: 'play', id: row.item.id, index: row.type === 'variation' ? row.index : undefined });
}

/**
 * A double click: a song or a snippet opens its file, anything else is what Enter does.
 * Enter still types a snippet, so the keyboard keeps a way to insert one (the maintainer,
 * 2026-11-22, item 12 of doc/TODO.md).
 */
function openRow(row: Row | undefined): void {
	if (row?.type !== 'heading' && row?.item.kind === 'snippet') return post({ type: 'open', id: row.item.id });
	activate(row);
}

/** Enter: a song opens, anything else is typed at the cursor of the editor. */
function activate(row: Row | undefined): void {
	if (!row) return;
	if (row.type === 'heading') return row.insert ? post({ type: 'insertText', text: row.insert }) : toggleHeading(row);
	if (opens(row.item)) return post({ type: 'open', id: row.item.id });
	post({ type: 'insert', id: row.item.id, index: row.type === 'variation' ? row.index : undefined });
}

function toggleHeading(row: Extract<Row, { type: 'heading' }>): void {
	headings[row.key] = !row.open;
	keep();
	buildRows();
	drawRows();
}

function toggleItem(item: CatalogItem): void {
	if (openItems.has(item.id)) openItems.delete(item.id);
	else openItems.add(item.id);
	buildRows();
	drawRows();
}

function selectedItems(): CatalogItem[] {
	const ids = new Set<string>();
	const list: CatalogItem[] = [];
	for (const row of rows) {
		if (row.type === 'heading' || !selection.has(rowKey(row)) || ids.has(row.item.id)) continue;
		ids.add(row.item.id);
		list.push(row.item);
	}
	return list;
}

function onResultsKey(event: KeyboardEvent): void {
	const row = rows[cursor];
	switch (event.key) {
		case 'ArrowDown':
			event.preventDefault();
			return moveCursor(cursor + 1, event.shiftKey);
		case 'ArrowUp':
			event.preventDefault();
			if (cursor <= 0) return focusSearch();
			return moveCursor(cursor - 1, event.shiftKey);
		case 'Home':
			event.preventDefault();
			return moveCursor(0, false);
		case 'End':
			event.preventDefault();
			return moveCursor(rows.length - 1, false);
		case 'PageDown':
		case 'PageUp': {
			event.preventDefault();
			const page = Math.max(1, Math.floor(resultsBox.clientHeight / rowHeight()) - 1);
			return moveCursor(cursor + (event.key === 'PageDown' ? page : -page), event.shiftKey);
		}
		case 'ArrowRight':
			event.preventDefault();
			if (row?.type === 'heading' && !row.open) return toggleHeading(row);
			if (row?.type === 'item' && row.item.count && !openItems.has(row.item.id)) return toggleItem(row.item);
			return moveCursor(cursor + 1, false);
		case 'ArrowLeft': {
			event.preventDefault();
			if (row?.type === 'heading' && row.open) return toggleHeading(row);
			if (row?.type === 'item' && openItems.has(row.item.id)) return toggleItem(row.item);
			for (let i = cursor - 1; i >= 0; i--) if (rows[i].type === 'heading' || (row?.type === 'variation' && rows[i].type === 'item')) return moveCursor(i, false);
			return;
		}
		case 'Enter':
			event.preventDefault();
			return activate(row);
		case ' ':
			event.preventDefault();
			return row ? playRow(row) : undefined;
	}
	if (/^[0-7]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
		event.preventDefault();
		const color = Number(event.key);
		const targets = selectedItems();
		if (!targets.length) return;
		// A color that every selected row has is taken off; otherwise it is put on all of them.
		const on = color === 0 ? false : !targets.every((item) => colorsOf(item, user).includes(color));
		post({ type: 'color', ids: targets.map((item) => item.id), color, on });
	}
}

// ---- menus and dialogs ------------------------------------------------------------------

type MenuEntry = { label: string; run: () => void } | 'separator' | 'colors';

function menuFor(row: Row): MenuEntry[] {
	if (row.type === 'heading') {
		return [
			...(row.insert ? [{ label: `Insert ${row.insert}`, run: () => post({ type: 'insertText', text: row.insert! }) }] : []),
			{ label: row.open ? 'Close' : 'Open', run: () => toggleHeading(row) },
		];
	}
	const { item } = row;
	const index = row.type === 'variation' ? row.index : undefined;
	const entries: MenuEntry[] = ['colors', 'separator'];
	if (item.sound) entries.push({ label: 'Play once', run: () => playRow(row) });
	if (opens(item)) entries.push({ label: item.kind === 'render' ? 'Play' : 'Open', run: () => post({ type: 'open', id: item.id }) });
	else if (item.available) entries.push({ label: 'Install', run: () => post({ type: 'install', id: item.id }) });
	else entries.push({ label: 'Insert at the cursor', run: () => post({ type: 'insert', id: item.id, index }) });
	if (item.kind === 'song') entries.push({ label: 'Insert at the cursor', run: () => post({ type: 'insertSong', id: item.id }) });
	if (item.kind === 'function' && item.code) entries.push({ label: 'Insert an example', run: () => post({ type: 'insertText', text: item.code! }) });
	if (item.kind === 'snippet') entries.push({ label: 'Open the file', run: () => post({ type: 'open', id: item.id }) });
	if (item.kind === 'firmware') entries.push({ label: 'Show the screen', run: () => post({ type: 'screen', id: item.id }) });
	entries.push({ label: opens(item) ? 'Copy the path' : item.kind === 'snippet' ? 'Copy the code' : 'Copy the name', run: () => post({ type: 'copy', id: item.id, index }) });
	entries.push('separator', { label: 'Edit tags...', run: () => editTags() });
	return entries;
}

function openMenu(event: MouseEvent, entries: MenuEntry[]): void {
	closeMenu();
	menu = document.body.appendChild(el('div', 'menu'));
	for (const entry of entries) {
		if (entry === 'separator') menu.appendChild(el('div', 'menu-sep'));
		else if (entry === 'colors') {
			const line = menu.appendChild(el('div', 'menu-colors'));
			const targets = selectedItems();
			for (let color = 1; color <= COLOR_COUNT; color++) {
				const all = targets.length > 0 && targets.every((item) => colorsOf(item, user).includes(color));
				const dot = line.appendChild(el('span', `dot${all ? ' active' : ''}`));
				dot.style.background = colorVar(color);
				dot.title = `${user.colorNames[color - 1]} (${color})`;
				dot.addEventListener('click', () => {
					post({ type: 'color', ids: targets.map((item) => item.id), color, on: !all });
					closeMenu();
				});
			}
			const clear = menu.appendChild(el('div', 'menu-item', 'Remove colors (0)'));
			clear.addEventListener('click', () => {
				post({ type: 'color', ids: targets.map((item) => item.id), color: 0, on: false });
				closeMenu();
			});
		} else {
			const item = menu.appendChild(el('div', 'menu-item', entry.label));
			item.addEventListener('click', () => {
				closeMenu();
				entry.run();
			});
		}
	}
	const box = menu.getBoundingClientRect();
	menu.style.left = `${Math.min(event.clientX, window.innerWidth - box.width - 4)}px`;
	menu.style.top = `${Math.min(event.clientY, window.innerHeight - box.height - 4)}px`;
}

function closeMenu(): void {
	menu?.remove();
	menu = undefined;
}

function closePopups(): void {
	closeMenu();
	dialog?.remove();
	dialog = undefined;
}

function openDialog(title: string, body: (into: HTMLElement) => void, ok: string, onOk: () => void): void {
	closePopups();
	dialog = document.body.appendChild(el('div', 'dialog'));
	dialog.appendChild(el('h4', '', title));
	body(dialog);
	const buttons = dialog.appendChild(el('div', 'buttons'));
	buttons.appendChild(el('button', '', 'Cancel')).addEventListener('click', closePopups);
	const primary = buttons.appendChild(el('button', 'primary', ok));
	primary.addEventListener('click', () => {
		onOk();
		closePopups();
	});
	dialog.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && (event.target as HTMLInputElement).type === 'text') primary.click();
	});
	dialog.querySelector<HTMLInputElement>('input[type=text]')?.focus();
}

function textField(into: HTMLElement, value: string, placeholder: string): HTMLInputElement {
	const input = into.appendChild(el('input'));
	input.type = 'text';
	input.value = value;
	input.placeholder = placeholder;
	return input;
}

function renameColor(color: number): void {
	let input: HTMLInputElement;
	openDialog(`Rename the color "${user.colorNames[color - 1]}"`, (into) => (input = textField(into, user.colorNames[color - 1], 'Name')), 'Rename', () =>
		post({ type: 'renameColor', color, name: input.value }),
	);
}

function describeSearch(search: SavedSearch): string {
	return [search.query && `"${search.query}"`, search.category !== 'all' && search.category, search.color && user.colorNames[search.color - 1], ...search.chips].filter(Boolean).join(', ');
}

function isSaved(search: SavedSearch): boolean {
	return search.query === filter.query && search.category === filter.category && search.color === filter.color && search.place === filter.place && search.builtin === filter.builtin && search.chips.join() === filter.chips.join();
}

function applySearch(saved: SavedSearch): void {
	setFilter({ category: saved.category, scope: undefined, query: saved.query, chips: [...saved.chips], color: saved.color, place: saved.place, builtin: saved.builtin });
	searchbarSync();
}

function searchbarSync(): void {
	search.value = filter.query;
}

function saveSearch(): void {
	let input: HTMLInputElement;
	const proposal = filter.query.trim() || filter.chips.map((chip) => chip.slice(chip.indexOf('/') + 1)).join(' ') || (filter.color ? user.colorNames[filter.color - 1] : 'My search');
	openDialog('Save this search under Collections', (into) => (input = textField(into, proposal, 'Name')), 'Save', () => {
		const name = input.value.trim();
		if (name) post({ type: 'saveSearch', search: { name, query: filter.query, category: filter.category, place: filter.place, builtin: filter.builtin, color: filter.color, chips: [...filter.chips] } });
	});
}

/**
 * Free tags of the selected rows: checkboxes for every free tag in use, and a field for a
 * new one. A box that only some rows have starts half checked, and stays that way unless
 * it is clicked.
 */
function editTags(): void {
	const targets = selectedItems();
	if (!targets.length) return;
	const known = new Set<string>();
	for (const item of items) for (const tag of tagsOf(item, user)) if (tag.startsWith('Tag/')) known.add(tag);
	const boxes: { tag: string; input: HTMLInputElement; mixed: boolean }[] = [];
	let fresh: HTMLInputElement;
	openDialog(
		targets.length === 1 ? `Tags of "${targets[0].label}"` : `Tags of ${targets.length} items`,
		(into) => {
			for (const tag of [...known].sort((a, b) => a.localeCompare(b))) {
				const have = targets.filter((item) => tagsOf(item, user).includes(tag)).length;
				const label = into.appendChild(el('label'));
				const input = label.appendChild(el('input'));
				input.type = 'checkbox';
				input.checked = have === targets.length;
				input.indeterminate = have > 0 && have < targets.length;
				const entry = { tag, input, mixed: input.indeterminate };
				input.addEventListener('change', () => (entry.mixed = false));
				boxes.push(entry);
				label.appendChild(el('span', '', tag.slice(4)));
			}
			fresh = textField(into, '', 'New tags, separated by commas');
		},
		'Apply',
		() => {
			const add = boxes.filter((b) => !b.mixed && b.input.checked).map((b) => b.tag);
			const remove = boxes.filter((b) => !b.mixed && !b.input.checked).map((b) => b.tag);
			for (const word of fresh.value.split(',').map((w) => w.trim()).filter(Boolean)) add.push(`Tag/${word}`);
			post({ type: 'tags', ids: targets.map((item) => item.id), add, remove });
		},
	);
}

// ---- previews ---------------------------------------------------------------------------

/**
 * Plays a preview here, with plain Web Audio, as the host planned it. The click on the row
 * started it, and a click inside this page is what lets it make sound. Half a second at
 * A3, a fade at the end, like the engine's preview with no song playing.
 */
let audio: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
let playingNow: AudioScheduledSourceNode | undefined;
async function playPreview(plan: PreviewPlan): Promise<void> {
	audio ??= new AudioContext();
	// Not awaited: without a click in the page (the integration test sends the message from
	// the host) the promise may never settle. With the click, the context runs at once.
	if (audio.state === 'suspended') void audio.resume();
	playingNow?.stop();
	const now = audio.currentTime + 0.01;
	const gain = audio.createGain();
	gain.connect(audio.destination);
	let source: AudioScheduledSourceNode;
	let length = 0.5;
	try {
		if (plan.kind === 'sample') {
			let buffer = buffers.get(plan.url);
			if (!buffer) {
				const url = plan.url;
				buffer = fetch(url)
					.then((response) => {
						if (!response.ok) throw new Error(`${response.status} for ${url}`);
						return response.arrayBuffer();
					})
					.then((bytes) => audio!.decodeAudioData(bytes));
				buffers.set(url, buffer);
				buffer.catch(() => buffers.delete(url));
			}
			const node = audio.createBufferSource();
			node.buffer = await buffer;
			if (plan.loop) {
				// One cycle of a wavetable, looped at A3.
				node.loop = true;
				node.playbackRate.value = 220 * node.buffer.duration;
			} else length = Math.min(node.buffer.duration, 4);
			source = node;
		} else if (plan.kind === 'oscillator') {
			const node = audio.createOscillator();
			node.type = plan.wave;
			node.frequency.value = 220;
			source = node;
			gain.gain.value = 0.3;
		} else {
			const node = audio.createBufferSource();
			node.buffer = noise(audio, plan.color);
			source = node;
			gain.gain.value = 0.3;
		}
	} catch (error) {
		post({ type: 'log', message: `preview: ${(error as Error).message}` });
		return;
	}
	const level = gain.gain.value || 1;
	gain.gain.setValueAtTime(level, now + Math.max(0, length - 0.05));
	gain.gain.linearRampToValueAtTime(0, now + length);
	source.connect(gain);
	source.start(now);
	source.stop(now + length);
	playingNow = source;
	post({ type: 'log', message: `preview: ${plan.kind === 'sample' ? plan.url.split('/').pop() : plan.kind === 'oscillator' ? plan.wave : `${plan.color} noise`} (${audio.state})` });
}

/** Half a second of noise. Pink and brown by the usual simple filters. */
function noise(context: AudioContext, color: 'white' | 'pink' | 'brown'): AudioBuffer {
	const buffer = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
	const data = buffer.getChannelData(0);
	let last = 0;
	let b0 = 0;
	let b1 = 0;
	let b2 = 0;
	for (let i = 0; i < data.length; i++) {
		const white = Math.random() * 2 - 1;
		if (color === 'white') data[i] = white;
		else if (color === 'brown') {
			last = (last + 0.02 * white) / 1.02;
			data[i] = last * 3.5;
		} else {
			b0 = 0.99765 * b0 + white * 0.099046;
			b1 = 0.963 * b1 + white * 0.2965164;
			b2 = 0.57 * b2 + white * 1.0526913;
			data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
		}
	}
	return buffer;
}

// ---- messages ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<ToBrowser>) => {
	const message = event.data;
	switch (message.type) {
		case 'init':
			filter = message.filter;
			items = message.items;
			user = message.user;
			preview = message.preview;
			app.hidden = false;
			searchbarSync();
			return update();
		case 'items':
			items = message.items;
			return update();
		case 'user':
			user = message.user;
			return update();
		case 'preview':
			preview = message.on;
			return update();
		case 'focusSearch':
			return focusSearch();
		case 'controls':
			return showControls(message.state);
		case 'playPreview':
			return void playPreview(message.plan);
		case 'filter':
			filter = message.filter;
			searchbarSync();
			headings = {};
			// A filter set by a command or the test: Contents shows it, and the tree unfolds to it, as a click would.
			if (message.show) {
				showContents();
				const parent = parentOf(filter.category);
				if (parent) tree.add(parent);
				if (filter.group || CATEGORIES.some((c) => parentOf(c.id) === filter.category)) tree.add(filter.category);
			}
			update();
			return;
	}
});

update();
post({ type: 'ready' });
