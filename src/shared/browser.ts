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
 * The four views of the side bar, all made from the same page. Library, Songs and Snippets,
 * and Reference pick what is shown. Library also holds the one search field and
 * the colors. Results shows what all of that picks, from every view, in one list.
 */
export type BrowserPage = 'library' | 'songs' | 'reference' | 'results';
export const BROWSER_PAGES: { page: BrowserPage; view: string; title: string }[] = [
	{ page: 'library', view: 'strdltn.browser', title: 'Library' },
	{ page: 'songs', view: 'strdltn.songs', title: 'Songs and Snippets' },
	{ page: 'reference', view: 'strdltn.reference', title: 'Reference' },
	{ page: 'results', view: 'strdltn.results', title: 'Results' },
];
export const viewOf = (page: BrowserPage): string => BROWSER_PAGES.find((p) => p.page === page)!.view;

/** Which view picks an item: sounds in the Library, what is written in Songs and Snippets, what is read in the Reference. */
export const pageOf = (item: CatalogItem): BrowserPage => (item.kind === 'sound' ? 'library' : item.kind === 'function' ? 'reference' : 'songs');

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
