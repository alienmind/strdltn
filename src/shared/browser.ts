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
	/** A group of the category, picked in the tree under it: `Installed`, a bank, a folder. */
	group?: string;
	/** With category "all": only the items of this view, the "All" row of that view. */
	scope?: BrowserPage;
	place?: PlaceId;
	/** The Built-in button of the Library: only built in, only not built in, or both (undefined). */
	builtin?: boolean;
	color?: number;
	query: string;
	chips: string[];
}

/** Which panes of the Browser view are open. */
export interface BrowserPanes {
	controls: boolean;
	library: boolean;
	contents: boolean;
	reference: boolean;
}

/**
 * Where an item is picked: the Library tree or the Reference tree. Both are panes of the one Browser view
 * (`strdltn.browser`), under Controls and around Contents. They were three views of their own until 2026-11-25; see
 * "Three views of the Browser" in the drawer of failed ideas. `results` is the Contents pane, where the old Results
 * view stood; the host still names it so.
 */
export type BrowserPage = 'library' | 'reference' | 'results';
/** The one view of the Browser. */
export const BROWSER_VIEW = 'strdltn.browser';

/** Which view picks an item: functions in the Reference, everything else in the Library. */
export const pageOf = (item: CatalogItem): BrowserPage => (item.kind === 'function' ? 'reference' : 'library');

/** The items a filter starts from: all of them, or those of one view when its "All" row is picked. */
export const scoped = (items: CatalogItem[], filter: BrowserFilterState): CatalogItem[] =>
	filter.scope && filter.category === 'all' ? items.filter((item) => pageOf(item) === filter.scope) : items;

export type ToBrowser =
	| { type: 'init'; page: BrowserPage; items: CatalogItem[]; user: UserIndex; preview: boolean; filter: BrowserFilterState; flashEnabled?: boolean }
	| { type: 'items'; items: CatalogItem[] }
	| { type: 'user'; user: UserIndex }
	| { type: 'preview'; on: boolean }
	| { type: 'focusSearch' }
	/** What Music Controls show, at the top of the Library. */
	| { type: 'controls'; state: ControlsState }
	/** Plays a preview in this page, without the engine. */
	| { type: 'playPreview'; plan: PreviewPlan }
	/** Stops any running Browser preview immediately (e.g. when Stop is pressed in Controls). */
	| { type: 'stopPreview' }
	/** Firmwares currently running in native `fm1-live` (e.g. `['shrub']`). */
	| { type: 'nativeRunning'; ids: string[] }
	/** Experimental setting `strdltn.experimental.fm1Flash` changed. */
	| { type: 'flashEnabled'; on: boolean }
	/** The filter changed in another view, or by a command. `open` opens headings in Results, for the integration test. */
	| { type: 'filter'; filter: BrowserFilterState; show?: boolean }
	/** For the pictures of the manual: opens and folds panes, and selects one row so the details show it. */
	| { type: 'stage'; panes?: Partial<BrowserPanes>; select?: string };

export type FromBrowser =
	| { type: 'ready' }
	/** Play, Stop or BPM of Music Controls. */
	| FromControls
	/** `index` picks a numbered variation of a sound. */
	| { type: 'play'; id: string; index?: number }
	| { type: 'insert'; id: string; index?: number }
	/** The button of a heading: `.bank("...")`. */
	| { type: 'insertText'; text: string }
	/** A song's code, without its header comments, at the cursor. */
	| { type: 'insertSong'; id: string }
	| { type: 'copy'; id: string; index?: number }
	| { type: 'open'; id: string }
	/** A firmware's screen, in a popup. */
	| { type: 'screen'; id: string }
	/** Opens a firmware's companion web editor (e.g. SHRUB editor, zp12 editor). */
	| { type: 'openEditor'; id: string }
	/** Launches or stops a `.fwsc` firmware (or SHRUB) in native `fm1-live` (240 MHz JIT). */
	| { type: 'runNative'; id: string }
	/** Opens the firmware repositories manager (view/add custom repo URLs). */
	| { type: 'manageRepos' }
	/** Flashes a `.fwsc` firmware directly onto connected M-VAVE FM-1 hardware over USB-MIDI SysEx. */
	| { type: 'flashHardware'; id: string }
	/** Installs an Available firmware into the project. */
	| { type: 'install'; id: string }
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
	| { type: 'state'; filter: BrowserFilterState; results: number; rows: number; chips: number; panes: BrowserPanes }
	| { type: 'log'; message: string }
	/** The user started dragging a Browser row, so a cross-webview drop can resolve the item even if MIME is stripped. */
	| { type: 'dragItem'; id: string; index?: number }
	/** "User manual (PDF)": the PDF of the latest release, in the user's browser. */
	| { type: 'openManual' };
