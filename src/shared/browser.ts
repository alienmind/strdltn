// Messages between the extension host and the Browser view. Both sides import this file.
import type { CatalogItem, CategoryId, PlaceId, SavedSearch, UserIndex } from './catalog.ts';

/** What the Browser shows: the category, the search and the filters. Kept by the webview between starts. */
export interface BrowserFilterState {
	category: CategoryId;
	place?: PlaceId;
	color?: number;
	query: string;
	chips: string[];
}

/**
 * The three views of the side bar that show the Browser's page, each with its own items.
 * The Library is the first and holds the logo and the one search field of all three.
 */
export type BrowserPage = 'library' | 'songs' | 'reference';
export const BROWSER_PAGES: { page: BrowserPage; view: string; title: string }[] = [
	{ page: 'library', view: 'strdltn.browser', title: 'Library' },
	{ page: 'songs', view: 'strdltn.songs', title: 'Songs and Snippets' },
	{ page: 'reference', view: 'strdltn.reference', title: 'Reference' },
];
export const viewOf = (page: BrowserPage): string => BROWSER_PAGES.find((p) => p.page === page)!.view;

export type ToBrowser =
	| { type: 'init'; page: BrowserPage; logo: string; items: CatalogItem[]; user: UserIndex; preview: boolean }
	| { type: 'items'; items: CatalogItem[] }
	| { type: 'user'; user: UserIndex }
	| { type: 'preview'; on: boolean }
	| { type: 'focusSearch' }
	/** How many items of each other page match the same search text. */
	| { type: 'elsewhere'; counts: { page: BrowserPage; count: number }[] }
	/** Sets what the Browser shows, as a click would. For commands and the integration test. */
	| { type: 'show'; filter: Partial<BrowserFilterState>; open?: string[] };

export type FromBrowser =
	| { type: 'ready' }
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
	/** Ctrl+F in a view without a search field: the Library's field gets the cursor. */
	| { type: 'focusSearch' }
	/** Opens another page, which already shows the same search. */
	| { type: 'searchIn'; page: BrowserPage; query: string }
	/** What is on screen now. The integration test reads it. */
	| { type: 'state'; filter: BrowserFilterState; results: number; rows: number; chips: number; typed?: boolean }
	| { type: 'log'; message: string };
