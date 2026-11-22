// Messages between the extension host and the Browser's views. Both sides import this file.
import type { CatalogItem, CategoryId, PlaceId, SavedSearch, UserIndex } from './catalog.ts';
import type { ControlsState, FromControls } from './controls.ts';
import type { PreviewPlan } from './preview.ts';

/**
 * What the Browser shows: the category, the search and the filters. One for all views: the
 * host keeps it and hands it to each of them.
 */
export interface BrowserFilterState {
	category: CategoryId;
	/** With category "all": only the items of this view, the "All" row of that view. */
	scope?: BrowserPage;
	place?: PlaceId;
	/** The Built-in button of the Library: only built in, only not built in, or both (undefined). */
	builtin?: boolean;
	color?: number;
	query: string;
	chips: string[];
}

/**
 * The three views of the side bar, all made from the same page. Library and Reference pick
 * what is shown. Library also holds the one search field and the colors. Results shows
 * what both pick, in one list.
 *
 * Songs and Snippets was a view of its own from 2026-11-20 to 2026-11-22. The maintainer
 * used it for a while and asked for its categories back in the Library, as one tree with
 * All, Sounds, Drums, ..., Songs and Snippets (see the drawer of failed ideas).
 */
export type BrowserPage = 'library' | 'reference' | 'results';
export const BROWSER_PAGES: { page: BrowserPage; view: string; title: string }[] = [
	{ page: 'library', view: 'strdltn.browser', title: 'Library' },
	{ page: 'reference', view: 'strdltn.reference', title: 'Reference' },
	{ page: 'results', view: 'strdltn.results', title: 'Results' },
];
export const viewOf = (page: BrowserPage): string => BROWSER_PAGES.find((p) => p.page === page)!.view;

/** Which view picks an item: functions in the Reference, everything else in the Library. */
export const pageOf = (item: CatalogItem): BrowserPage => (item.kind === 'function' ? 'reference' : 'library');

/** The items a filter starts from: all of them, or those of one view when its "All" row is picked. */
export const scoped = (items: CatalogItem[], filter: BrowserFilterState): CatalogItem[] =>
	filter.scope && filter.category === 'all' ? items.filter((item) => pageOf(item) === filter.scope) : items;

export type ToBrowser =
	| { type: 'init'; page: BrowserPage; items: CatalogItem[]; user: UserIndex; preview: boolean; filter: BrowserFilterState }
	| { type: 'items'; items: CatalogItem[] }
	| { type: 'user'; user: UserIndex }
	| { type: 'preview'; on: boolean }
	| { type: 'focusSearch' }
	/** What Music Controls show, at the top of the Library. */
	| { type: 'controls'; state: ControlsState }
	/** Plays a preview in this page, without the engine. */
	| { type: 'playPreview'; plan: PreviewPlan }
	/** The filter changed in another view, or by a command. `open` opens headings in Results, for the integration test. */
	| { type: 'filter'; filter: BrowserFilterState; open?: string[] };

export type FromBrowser =
	| { type: 'ready' }
	/** Play, Stop or BPM of Music Controls. */
	| FromControls
	/** `index` picks a numbered variation of a sound. */
	| { type: 'play'; id: string; index?: number }
	| { type: 'insert'; id: string; index?: number }
	/** The button of a heading: `.bank("...")`. */
	| { type: 'insertText'; text: string }
	| { type: 'copy'; id: string; index?: number }
	| { type: 'open'; id: string }
	/** Turns one color on or off for the items. `color` 0 clears every color. */
	| { type: 'color'; ids: string[]; color: number; on: boolean }
	| { type: 'tags'; ids: string[]; add: string[]; remove: string[] }
	| { type: 'renameColor'; color: number; name: string }
	| { type: 'saveSearch'; search: SavedSearch }
	| { type: 'deleteSearch'; name: string }
	| { type: 'setPreview'; on: boolean }
	/** The user changed the filter in this view. */
	| { type: 'filter'; filter: BrowserFilterState }
	/** Ctrl+F in a view without a search field: the Library's field gets the cursor. */
	| { type: 'focusSearch' }
	/** What Results shows now. The integration test reads it. */
	| { type: 'state'; filter: BrowserFilterState; results: number; rows: number; chips: number }
	| { type: 'log'; message: string };
