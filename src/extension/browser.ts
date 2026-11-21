import * as vscode from 'vscode';
import { BROWSER_PAGES, type BrowserFilterState, type BrowserPage, type FromBrowser, type ToBrowser, viewOf } from '../shared/browser';
import {
	type CatalogItem,
	type FunctionDoc,
	functionItem,
	readUserIndex,
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
import { setPage } from './surface';

/** The file in the root of the project that keeps the colors, tags and saved searches. */
export const INDEX_FILE = 'strdltn.index.json';
const PREVIEW_KEY = 'strdltn.previewSounds';

export interface BrowserActions {
	preview(name: string, index: number): void;
	/** `bare` goes in instead when the cursor is inside a string. */
	insert(text: string, bare?: string): Promise<void>;
}

/** Which items a page shows. The Reference holds what is read, the Browser what is played and inserted. */
/** Which view an item is shown in: sounds in the Library, what is written in Songs and Snippets, what is read in the Reference. */
export const pageOf = (item: CatalogItem): BrowserPage => (item.kind === 'sound' ? 'library' : item.kind === 'function' ? 'reference' : 'songs');
const others = (page: BrowserPage): BrowserPage[] => BROWSER_PAGES.map((p) => p.page).filter((p) => p !== page);

/**
 * The Browser: three views in the side bar, Library (sounds), Songs and Snippets, and
 * Reference (functions, later the tutorial), with seven colors, categories, places and
 * tag chips, like the browser of Live. All three are the same page with their own items:
 * one host, one user file, one search field (in the Library). The maintainer wanted them
 * apart, as the separate views of vstrudel were, and the search shared. A tree cannot
 * show colors, chips or a search field, so these replaced the old trees.
 *
 * The host owns the data. It builds the items, keeps the user's colors and tags in
 * `strdltn.index.json`, and does what a row asks (play, insert, open). The webview owns
 * what is on screen: the filters, the open headings, the selection.
 */
export class BrowserView {
	private readonly views = new Map<BrowserPage, vscode.WebviewView>();
	private readonly states = new Map<BrowserPage, Extract<FromBrowser, { type: 'state' }>>();
	/** The search text, the same in both pages. */
	private query = '';
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

	/** The provider of one of the two views. */
	provider(page: BrowserPage): vscode.WebviewViewProvider {
		return {
			resolveWebviewView: (view) => {
				this.views.set(page, view);
				setPage(this.context, view.webview, 'browser', ['dist', 'media']);
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

	/** Sets what the Browser shows. For the integration test. */
	show(filter: Partial<BrowserFilterState>, open?: string[], page: BrowserPage = 'library'): void {
		this.post({ type: 'show', filter, open }, page);
		// The search text is one for all views.
		if (filter.query !== undefined && filter.query !== this.query) {
			this.query = filter.query;
			for (const p of others(page)) this.post({ type: 'show', filter: { query: this.query } }, p);
		}
	}

	/** What the webview reported last: the filter, and how many results and rows it shows. */
	state(page: BrowserPage = 'library'): Extract<FromBrowser, { type: 'state' }> | undefined {
		return this.states.get(page);
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
		this.items = [...soundItems(this.sounds), ...snippetItems, ...this.songs.all().map(songItem), ...this.functions.map(functionItem)];
		// A pack loads hundreds of sounds one by one, and each change would send 2000 items.
		clearTimeout(this.pushTimer);
		this.pushTimer = setTimeout(() => {
			for (const page of this.views.keys()) this.post({ type: 'items', items: this.pageItems(page) }, page);
		}, 150);
	}

	private pageItems(page: BrowserPage): CatalogItem[] {
		return this.items.filter((item) => pageOf(item) === page);
	}

	/** Tells each page how many items of the other pages the search text finds. */
	private countElsewhere(): void {
		const query = this.query.trim();
		const counts = new Map(BROWSER_PAGES.map(({ page }) => [page, query ? filterItems(this.pageItems(page), { query, category: 'all', chips: [] }, this.user).length : 0]));
		for (const page of this.views.keys()) this.post({ type: 'elsewhere', counts: others(page).map((p) => ({ page: p, count: counts.get(p) ?? 0 })) }, page);
	}

	/** To one page, or to both when no page is named. */
	private post(message: ToBrowser, page?: BrowserPage): void {
		for (const [id, view] of this.views) if (!page || id === page) void view.webview.postMessage(message);
	}

	private item(id: string): CatalogItem | undefined {
		return this.items.find((item) => item.id === id);
	}

	/** What a message of the webview asks. Public for the integration test, which cannot click in a webview. */
	async handle(message: FromBrowser, page: BrowserPage = 'library'): Promise<void> {
		switch (message.type) {
			case 'ready': {
				const view = this.views.get(page);
				const logo = page === 'library' ? (view?.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'logo.jpg')).toString() ?? '') : '';
				this.post({ type: 'init', page, logo, items: this.pageItems(page), user: this.user, preview: this.preview }, page);
				return this.post({ type: 'show', filter: { query: this.query } }, page);
			}
			case 'play': {
				const item = this.item(message.id);
				if (item?.sound) this.actions.preview(item.sound, message.index ?? item.index ?? 0);
				return;
			}
			case 'insert': {
				const item = this.item(message.id);
				if (!item) return;
				if (item.kind === 'song') return this.open(item);
				if (item.kind === 'sound') {
					const sound = soundCode(item, message.index);
					if (sound) return this.actions.insert(sound.code, sound.name);
					return;
				}
				if (item.insert) return this.actions.insert(item.insert);
				return;
			}
			case 'insertText':
				return this.actions.insert(message.text);
			case 'copy': {
				const item = this.item(message.id);
				const text = item && (item.kind === 'sound' ? soundCode(item, message.index)?.name : item.kind === 'song' ? item.path : item.insert);
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
			case 'state': {
				this.states.set(page, message);
				// One search for both views: the field is in the Browser, the Reference follows it.
				// Only a change made in that page counts: a late report must not undo typing in the other.
				if (message.typed && message.filter.query !== this.query) {
					this.query = message.filter.query;
					for (const p of others(page)) this.post({ type: 'show', filter: { query: this.query } }, p);
				}
				this.countElsewhere();
				return;
			}
			case 'focusSearch':
				return this.focusSearch();
			case 'searchIn': {
				await vscode.commands.executeCommand(`${viewOf(message.page)}.focus`);
				this.post({ type: 'show', filter: { query: message.query, category: 'all', chips: [], color: undefined, place: undefined } }, message.page);
				return;
			}
			case 'log':
				this.output.appendLine(`browser: ${message.message}`);
				return;
		}
	}

	private async open(item: CatalogItem): Promise<void> {
		if (item.kind === 'song') {
			const uri = item.path && this.songs.uri(item.path);
			if (uri) await vscode.commands.executeCommand('vscode.open', uri);
			return;
		}
		if (item.kind === 'snippet') {
			const snippet = this.snippets.find(item.id.slice('snippet:'.length));
			// The native editor: a snippet is edited as text, header included.
			if (snippet) await vscode.commands.executeCommand('vscode.openWith', snippet.uri, 'default');
		}
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
