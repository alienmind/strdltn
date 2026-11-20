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

export type ToBrowser =
	| { type: 'init'; logo: string; items: CatalogItem[]; user: UserIndex; preview: boolean }
	| { type: 'items'; items: CatalogItem[] }
	| { type: 'user'; user: UserIndex }
	| { type: 'preview'; on: boolean }
	| { type: 'focusSearch' }
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
	/** What is on screen now. The integration test reads it. */
	| { type: 'state'; filter: BrowserFilterState; results: number; rows: number; chips: number }
	| { type: 'log'; message: string };
