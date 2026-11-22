import * as vscode from 'vscode';
import type { MidiPorts } from '../shared/midi';
import type { InsertArgument } from '../shared/context';
import type { BrowserFilterState, BrowserPage, FromBrowser, ToBrowser } from '../shared/browser';
import {
	type CatalogItem,
	type FunctionDoc,
	functionItem,
	midiItem,
	readUserIndex,
	renderItem,
	soundCode,
	snippetItem,
	songItem,
	soundItems,
	type UserIndex,
	writeUserIndex,
} from '../shared/catalog';
import type { SoundInfo } from '../shared/protocol';
import { filterItems } from '../shared/search';
import { setSnippetTags } from '../shared/snippet';
import type { SongList } from './files';
import type { SnippetLibrary } from './snippets';
import type { ControlsState, FromControls } from '../shared/controls';
import { previewPlan } from '../shared/preview';
import { setPage } from './surface';

/** The file in the root of the project that keeps the colors, tags and saved searches. */
export const INDEX_FILE = 'strdltn.index.json';
const PREVIEW_KEY = 'strdltn.previewSounds';

export interface BrowserActions {
	/** Plays a sound through the engine of a song. */
	preview(name: string, index: number): void;
	/** True while a song plays: then the engine plays previews, on its beat. */
	playing(): boolean;
	/** Play, Stop or BPM of Music Controls, for the song the Mixer shows. */
	control(message: FromControls): void;
	/** `bare` goes in instead when the cursor is inside a string. */
	insert(text: string, bare?: string, argument?: InsertArgument): Promise<void>;
}

const FILTER_KEY = 'strdltn.browserFilter';
/** The manual of the latest release, attached to every release by ci.yml (scripts/manual-pdf.mjs). */
const MANUAL_URL = 'https://github.com/alienmind/strdltn/releases/latest/download/strdltn-manual.pdf';
const NO_FILTER: BrowserFilterState = { category: 'all', query: '', chips: [] };

/**
 * The Browser: three views in the side bar, like the browser of Live. Library (sounds,
 * renders, MIDI ports, songs and snippets, with the one search field, the colors and the
 * Built-in button) and Reference (functions, later the tutorial) pick what is shown;
 * Results shows it, from both, in one list with chips and a details pane. A tree cannot
 * show colors, chips or a search field, so these replaced the old trees.
 *
 * All three are the same page. The host owns the data and the filter: it builds the items,
 * keeps the user's colors and tags in `strdltn.index.json`, keeps the filter for all
 * views, and does what a row asks (play, insert, open). A view that changes the filter
 * sends it here, and the host hands it to the others.
 */
export class BrowserView {
	private readonly views = new Map<BrowserPage, vscode.WebviewView>();
	/** The previews the pages played themselves, as they reported them. For the integration test. */
	readonly previews: string[] = [];
	/** What Results reported last. */
	private lastState?: Extract<FromBrowser, { type: 'state' }>;
	/** The filter of all views. Kept per workspace, so a reload shows the same. */
	private filter: BrowserFilterState;
	private sounds: SoundInfo[] = [];
	private functions: FunctionDoc[] = [];
	private items: CatalogItem[] = [];
	private user: UserIndex = readUserIndex(undefined);
	private preview: boolean;
	private pushTimer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly snippets: SnippetLibrary,
		private readonly songs: SongList,
		private readonly output: vscode.OutputChannel,
		private readonly actions: BrowserActions,
	) {
		this.preview = context.globalState.get(PREVIEW_KEY, true);
		this.filter = { ...NO_FILTER, ...context.workspaceState.get<Partial<BrowserFilterState>>(FILTER_KEY) };
		snippets.onDidChange(() => this.rebuild());
		songs.onDidChange(() => this.rebuild());
	}

	async start(): Promise<void> {
		try {
			const file = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'functions.json');
			this.functions = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
		} catch (error) {
			this.output.appendLine(`browser: the function list is missing (${(error as Error).message})`);
		}
		await this.loadUser();
		this.rebuild();
	}

	setSounds(sounds: SoundInfo[]): void {
		this.sounds = sounds;
		this.rebuild();
	}

	allSounds(): SoundInfo[] {
		return this.sounds;
	}

	/** The provider of one of the three views. */
	provider(page: BrowserPage): vscode.WebviewViewProvider {
		return {
			resolveWebviewView: (view) => {
				this.views.set(page, view);
				// The page plays previews itself: sample files from the web, from the project and
				// from the pack cache in it (`.strdltn/cache`).
				setPage(this.context, view.webview, 'browser', {
					roots: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
					csp: [`connect-src ${view.webview.cspSource} https:`, `media-src ${view.webview.cspSource} https: data: blob:`],
				});
				view.webview.onDidReceiveMessage((message: FromBrowser) => void this.handle(message, page));
				view.onDidDispose(() => this.views.get(page) === view && this.views.delete(page));
			},
		};
	}

	/** Puts the cursor in the search field, opening the side bar first. */
	async focusSearch(): Promise<void> {
		await vscode.commands.executeCommand('strdltn.browser.focus');
		this.post({ type: 'focusSearch' }, 'library');
	}

	/** Sets what the Browser shows, as clicks would. For the integration test. */
	show(filter: Partial<BrowserFilterState>, open?: string[]): void {
		this.setFilter({ ...this.filter, ...filter }, undefined, open);
	}

	/** What Results reported last: the filter, and how many results and rows it shows. */
	state(): Extract<FromBrowser, { type: 'state' }> | undefined {
		return this.lastState;
	}

	/** The items a filter gives, worked out here with the same functions the webview uses. */
	find(filter: Partial<BrowserFilterState>): CatalogItem[] {
		return filterItems(this.items, { query: '', category: 'all', chips: [], ...filter }, this.user);
	}

	all(): CatalogItem[] {
		return this.items;
	}

	async refresh(): Promise<void> {
		await Promise.all([this.snippets.refresh(), this.songs.refresh(), this.loadUser()]);
		this.rebuild();
	}

	private rebuild(): void {
		const snippetItems = this.snippets.all().map((snippet) => snippetItem(snippet, vscode.workspace.asRelativePath(snippet.uri)));
		const renders = this.songs.renders().map((audio) => renderItem(audio.path, audio.song));
		const midi = [...this.midiPorts.outputs.map((name) => midiItem(name, 'out')), ...this.midiPorts.inputs.map((name) => midiItem(name, 'in'))];
		this.items = [...soundItems(this.sounds), ...snippetItems, ...this.songs.all().map(songItem), ...renders, ...midi, ...this.functions.map(functionItem)];
		// A pack loads hundreds of sounds one by one, and each change would send 2000 items.
		clearTimeout(this.pushTimer);
		this.pushTimer = setTimeout(() => this.post({ type: 'items', items: this.items }), 150);
	}

	/** The MIDI ports of the machine, from the MIDI bridge. Empty in a Codespace, where the host cannot see them. */
	private midiPorts: MidiPorts = { outputs: [], inputs: [] };

	setMidiPorts(ports: MidiPorts): void {
		this.midiPorts = ports;
		this.rebuild();
	}

	/** What Music Controls show, kept for a Library page that starts later. */
	private controls?: ControlsState;

	setControls(state: ControlsState): void {
		this.controls = state;
		this.post({ type: 'controls', state }, 'library');
	}

	/** The filter changed in one view: the others follow, and Results opens to show it. */
	private setFilter(filter: BrowserFilterState, from?: BrowserPage, open?: string[]): void {
		this.filter = filter;
		void this.context.workspaceState.update(FILTER_KEY, filter);
		for (const [page, view] of this.views) if (page !== from) void view.webview.postMessage({ type: 'filter', filter, open } satisfies ToBrowser);
		if (from && from !== 'results') void this.showResults(from);
	}

	/**
	 * Expands Results when it is folded, as the maintainer asked: every click and every search
	 * should show its results at once. `show(true)` keeps the focus, so typing in the search
	 * goes on. A Results view that was never opened has no `show`: its focus command opens it,
	 * and the cursor goes back to the search field when the search was typed.
	 */
	private async showResults(from: BrowserPage): Promise<void> {
		const results = this.views.get('results');
		if (results) return results.visible ? undefined : results.show(true);
		await vscode.commands.executeCommand('strdltn.results.focus');
		if (from === 'library') this.post({ type: 'focusSearch' }, 'library');
	}

	/** To one view, or to all when no view is named. */
	private post(message: ToBrowser, page?: BrowserPage): void {
		for (const [id, view] of this.views) if (!page || id === page) void view.webview.postMessage(message);
	}

	private item(id: string): CatalogItem | undefined {
		return this.items.find((item) => item.id === id);
	}

	/** What a message of the webview asks. Public for the integration test, which cannot click in a webview. */
	async handle(message: FromBrowser, page: BrowserPage = 'results'): Promise<void> {
		switch (message.type) {
			case 'ready': {
				this.post({ type: 'init', page, items: this.items, user: this.user, preview: this.preview, filter: this.filter }, page);
				if (page === 'library' && this.controls) this.post({ type: 'controls', state: this.controls }, page);
				return;
			}
			case 'play': {
				const item = this.item(message.id);
				if (!item?.sound) return;
				const index = message.index ?? item.index ?? 0;
				// While a song plays the engine plays it, on the next beat of the song. Else
				// the page that was clicked plays it itself, so a preview needs no song at all.
				const plan = this.actions.playing() ? undefined : previewPlan(this.sounds.find((sound) => sound.name === item.sound), index);
				if (plan) return this.post({ type: 'playPreview', plan }, page);
				this.actions.preview(item.sound, index);
				return;
			}
			case 'insert': {
				const item = this.item(message.id);
				if (!item) return;
				if (item.kind === 'song' || item.kind === 'render') return this.open(item);
				if (item.kind === 'sound') {
					const sound = soundCode(item, message.index);
					if (sound) return this.actions.insert(sound.code, sound.name);
					return;
				}
				// A device's name alone when the cursor is in a string: `.midi('|')`.
				if (item.kind === 'midi' && item.insert) return this.actions.insert(item.insert, item.label, item.argument);
				if (item.insert) return this.actions.insert(item.insert);
				return;
			}
			case 'insertText':
				return this.actions.insert(message.text);
			case 'copy': {
				const item = this.item(message.id);
				const text = item && (item.kind === 'sound' ? soundCode(item, message.index)?.name : item.kind === 'song' || item.kind === 'render' ? item.path : item.kind === 'midi' ? item.label : item.insert);
				if (text) await vscode.env.clipboard.writeText(text);
				return;
			}
			case 'open': {
				const item = this.item(message.id);
				if (item) await this.open(item);
				return;
			}
			case 'color':
				for (const id of message.ids) {
					const entry = (this.user.items[id] ??= {});
					const colors = new Set(entry.colors ?? []);
					if (message.color === 0) colors.clear();
					else if (message.on) colors.add(message.color);
					else colors.delete(message.color);
					entry.colors = [...colors].sort();
				}
				return this.saveUser();
			case 'tags':
				return this.setTags(message.ids, message.add, message.remove);
			case 'renameColor':
				if (message.color >= 1 && message.color <= this.user.colorNames.length) this.user.colorNames[message.color - 1] = message.name.trim() || this.user.colorNames[message.color - 1];
				return this.saveUser();
			case 'saveSearch':
				this.user.searches = [...this.user.searches.filter((s) => s.name !== message.search.name), message.search];
				return this.saveUser();
			case 'deleteSearch':
				this.user.searches = this.user.searches.filter((s) => s.name !== message.name);
				return this.saveUser();
			case 'setPreview':
				this.preview = message.on;
				await this.context.globalState.update(PREVIEW_KEY, message.on);
				return this.post({ type: 'preview', on: message.on });
			case 'state':
				this.lastState = message;
				return;
			case 'filter':
				return this.setFilter(message.filter, page);
			case 'focusSearch':
				return this.focusSearch();
			case 'transport':
			case 'tempo':
				return this.actions.control(message);
			case 'openManual':
				return void vscode.env.openExternal(vscode.Uri.parse(MANUAL_URL));
			case 'log':
				this.output.appendLine(`browser: ${message.message}`);
				if (message.message.startsWith('preview:')) this.previews.push(message.message);
				return;
		}
	}

	private async open(item: CatalogItem): Promise<void> {
		// A render opens in VS Code's own media preview, which plays .wav and .mp3.
		// A song or a snippet opens in the Strudel editor by name, not by `vscode.open`: the
		// native editor is never the default (the maintainer, 2026-11-22), and `vscode.open`
		// follows the user's `workbench.editorAssociations`. The header of a snippet shows in
		// the Strudel editor too, so its tags can still be edited by hand there.
		if (item.kind === 'render') {
			const uri = item.path && this.songs.uri(item.path);
			if (uri) await vscode.commands.executeCommand('vscode.open', uri);
			return;
		}
		const uri =
			item.kind === 'song' ? item.path && this.songs.uri(item.path) : item.kind === 'snippet' ? this.snippets.find(item.id.slice('snippet:'.length))?.uri : undefined;
		if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, 'strdltn.editor');
	}

	/**
	 * Tags of a snippet go into its own header (`// @tags ...`), so they travel with the
	 * file. Tags of anything else go into the project file. Only free tags (`Tag/...`) can be
	 * set on a snippet this way; the others stay in the project file too.
	 */
	private async setTags(ids: string[], add: string[], remove: string[]): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		let editsFiles = false;
		for (const id of ids) {
			const item = this.item(id);
			const snippet = item?.kind === 'snippet' ? this.snippets.find(id.slice('snippet:'.length)) : undefined;
			const free = (tags: string[]) => tags.filter((tag) => tag.startsWith('Tag/'));
			if (snippet && item) {
				const words = new Set(free(item.tags).map((tag) => tag.slice(4)));
				free(add).forEach((tag) => words.add(tag.slice(4)));
				free(remove).forEach((tag) => words.delete(tag.slice(4)));
				const document = await vscode.workspace.openTextDocument(snippet.uri);
				const before = document.getText();
				const after = setSnippetTags(before, [...words]);
				if (after !== before) {
					edit.replace(snippet.uri, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), after);
					editsFiles = true;
				}
			}
			const rest = (tags: string[]) => (snippet ? tags.filter((tag) => !tag.startsWith('Tag/')) : tags);
			const entry = (this.user.items[id] ??= {});
			const tags = new Set(entry.tags ?? []);
			rest(add).forEach((tag) => tags.add(tag));
			rest(remove).forEach((tag) => tags.delete(tag));
			entry.tags = [...tags].sort();
		}
		if (editsFiles) {
			await vscode.workspace.applyEdit(edit);
			await Promise.all([...edit.entries()].map(([uri]) => vscode.workspace.openTextDocument(uri).then((document) => document.save())));
			await this.snippets.refresh();
		}
		await this.saveUser();
	}

	/** The project file sits in the first workspace folder. Without a folder, VS Code keeps it for the window. */
	private indexUri(): vscode.Uri | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		return folder && vscode.Uri.joinPath(folder.uri, INDEX_FILE);
	}

	private async loadUser(): Promise<void> {
		const uri = this.indexUri();
		try {
			const json = uri ? JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))) : this.context.workspaceState.get(INDEX_FILE);
			this.user = readUserIndex(json);
		} catch (error) {
			// No file yet is normal. A broken file is said once, and left as it is until the next save.
			if (!(error instanceof vscode.FileSystemError)) this.output.appendLine(`browser: ${INDEX_FILE} could not be read: ${(error as Error).message}`);
			this.user = readUserIndex(undefined);
		}
		this.post({ type: 'user', user: this.user });
	}

	private async saveUser(): Promise<void> {
		this.post({ type: 'user', user: this.user });
		const uri = this.indexUri();
		if (!uri) return void (await this.context.workspaceState.update(INDEX_FILE, JSON.parse(writeUserIndex(this.user))));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(writeUserIndex(this.user)));
	}
}
