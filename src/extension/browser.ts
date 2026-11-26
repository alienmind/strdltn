import * as vscode from 'vscode';
import type { MidiPorts } from '../shared/midi';
import type { InsertArgument } from '../shared/context';
import type { BrowserFilterState, BrowserPage, FromBrowser, ToBrowser } from '../shared/browser';
import {
	type CatalogItem,
	type FunctionDoc,
	firmwareItems,
	functionItem,
	knownCategory,
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
import { availableFirmware, firmwareCode, HARDWARE_FM1_PROFILES, type HubFirmware, type InstalledFirmware } from '../shared/firmware';
import type { SoundInfo } from '../shared/protocol';
import { filterItems } from '../shared/search';
import { parseSnippet, setSnippetTags } from '../shared/snippet';
import type { SongList } from './files';
import type { SnippetLibrary } from './snippets';
import type { ControlsState, FromControls } from '../shared/controls';
import { DEFAULT_PREVIEW_BPM, previewCycleSeconds, previewPlan } from '../shared/preview';
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
	/** As insert, and a cached firmware's `firmware('<url>')` line at the top of the song when it has none. */
	insertFirmware(text: string, bare: string, url?: string): Promise<void>;
	/** Inserts a real FM-1 hardware MIDI profile line plus its `midimaps(...)` definition. */
	insertHardware(id: string): Promise<void>;
	/** Opens the popup with a firmware's screen. */
	showScreen(id: string): void;
	/** Opens a firmware's companion web editor (e.g. SHRUB editor). */
	openEditor(id: string): void;
	/** Starts or stops native `fm1-live` (240 MHz JIT) for SHRUB or any `.fwsc` firmware. */
	runNative(id: string): Promise<void>;
	/** Installs a firmware of the hub into the project. */
	install(id: string): Promise<void>;
	/** Local file of a firmware (installed or cached from the hub) for standalone Browser preview. */
	firmwareFile(id: string): Promise<vscode.Uri | undefined>;
	/** Cached `fm1_web.wasm` for standalone `.fwsc` Browser preview. */
	emuWasmFile(): Promise<vscode.Uri | undefined>;
	/** Sends a 1-loop preview note to a real FM-1 hardware MIDI device, returning the matched port name if connected. */
	previewMidi(portHint: string, durationMs: number): Promise<string | undefined>;
	/** FM-1 Synths is in sight: read the hub's list and make the pictures that are missing. */
	wantFirmware(): void;
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
	private firmware: InstalledFirmware[] = [];
	private hub: HubFirmware[] = [];
	private images: Record<string, vscode.Uri> = {};
	private functions: FunctionDoc[] = [];
	private items: CatalogItem[] = [];
	private user: UserIndex = readUserIndex(undefined);
	private preview: boolean;
	private pushTimer?: ReturnType<typeof setTimeout>;
	/** Last item dragged from the Browser, so cross-webview drops work even if Chromium strips custom MIME data. */
	private lastDrag?: { id: string; index?: number; at: number };

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly snippets: SnippetLibrary,
		private readonly songs: SongList,
		private readonly output: vscode.OutputChannel,
		private readonly actions: BrowserActions,
	) {
		this.preview = context.globalState.get(PREVIEW_KEY, true);
		const kept = { ...NO_FILTER, ...context.workspaceState.get<Partial<BrowserFilterState>>(FILTER_KEY) };
		this.filter = { ...kept, category: knownCategory(kept.category) };
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

	/** The firmwares on disk, from FirmwareLibrary. */
	setFirmware(installed: InstalledFirmware[], hub: HubFirmware[], images: Record<string, vscode.Uri>): void {
		this.firmware = installed;
		this.hub = hub;
		this.images = images;
		this.rebuild();
	}

	/** The pictures live in the extension's global storage: the pages may load from there. */
	private get imageRoot(): vscode.Uri {
		return vscode.Uri.joinPath(this.context.globalStorageUri, 'firmware');
	}

	allSounds(): SoundInfo[] {
		return this.sounds;
	}

	/** The provider of the Browser's view. `page` is always `library` now: its three panes are one page. */
	provider(page: BrowserPage): vscode.WebviewViewProvider {
		return {
			resolveWebviewView: (view) => {
				this.views.set(page, view);
				// The page plays previews itself: sample files, superdough synths/soundfonts and VIBE FM-1 worklets.
				setPage(this.context, view.webview, 'browser', {
					roots: [...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri), this.imageRoot],
					script: [view.webview.cspSource, 'data:', 'blob:', "'unsafe-eval'"],
					csp: [
						`worker-src ${view.webview.cspSource} data: blob:`,
						`connect-src ${view.webview.cspSource} https: data: blob:`,
						`media-src ${view.webview.cspSource} https: data: blob:`,
					],
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

	/** Sets what the Browser shows, as a click in a tree would: Contents shows it. For the integration test. */
	show(filter: Partial<BrowserFilterState>): void {
		this.setFilter({ ...this.filter, ...filter }, undefined, true);
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

	/** Stops any standalone preview playing in the Browser view. */
	stopPreview(): void {
		this.post({ type: 'stopPreview' });
	}

	/** Updates which firmwares are currently running in native `fm1-live`. */
	setNativeRunning(ids: string[]): void {
		this.post({ type: 'nativeRunning', ids });
	}

	/** Resolves a dropped item by its MIME id, falling back to the last Browser drag within 15 seconds. */
	resolveDrop(id?: string, index?: number): { item: CatalogItem; index?: number } | undefined {
		if (id) {
			this.lastDrag = undefined;
			const item = this.item(id);
			return item ? { item, index } : undefined;
		}
		if (this.lastDrag && Date.now() - this.lastDrag.at < 15000) {
			const drag = this.lastDrag;
			this.lastDrag = undefined;
			const item = this.item(drag.id);
			return item ? { item, index: drag.index } : undefined;
		}
		return undefined;
	}

	async refresh(): Promise<void> {
		await Promise.all([this.snippets.refresh(), this.songs.refresh(), this.loadUser()]);
		this.rebuild();
	}

	private rebuild(): void {
		const snippetItems = this.snippets.all().map((snippet) => snippetItem(snippet, vscode.workspace.asRelativePath(snippet.uri)));
		const renders = this.songs.renders().map((audio) => renderItem(audio.path, audio.song));
		const midi = [...this.midiPorts.outputs.map((name) => midiItem(name, 'out')), ...this.midiPorts.inputs.map((name) => midiItem(name, 'in'))];
		// The engine's order of its firmwares: a row plays by its position, as `vibefm1:3` or `fm1:0` does.
		const engine = this.sounds.find((sound) => sound.name === 'vibefm1')?.variations ?? [];
		const fm1Engine = this.sounds.find((sound) => sound.name === 'fm1')?.variations ?? [];
		// A webview URL is the same for every view of the Browser; without a view yet there are no pictures to show.
		const webview = [...this.views.values()][0]?.webview;
		const images = webview ? Object.fromEntries(Object.entries(this.images).map(([id, uri]) => [id, webview.asWebviewUri(uri).toString()])) : {};
		this.items = [...soundItems(this.sounds), ...firmwareItems(this.firmware, availableFirmware(this.hub, this.firmware), engine, images, fm1Engine), ...snippetItems, ...this.songs.all().map(songItem), ...renders, ...midi, ...this.functions.map(functionItem)];
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

	/**
	 * The filter changed: kept for the next start, and sent to the page unless it came from there. `show` opens Contents
	 * alone, as a click in a tree does; the page does that itself for its own clicks.
	 */
	private setFilter(filter: BrowserFilterState, from?: BrowserPage, show = false): void {
		this.filter = filter;
		if (filter.category === 'plugins' || filter.category === 'fm1' || filter.category === 'fm1live') this.actions.wantFirmware();
		void this.context.workspaceState.update(FILTER_KEY, filter);
		for (const [page, view] of this.views) if (page !== from) void view.webview.postMessage({ type: 'filter', filter, show } satisfies ToBrowser);
	}

	/** To one view, or to all when no view is named. */
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
				// The first view: the pictures get their webview URLs now.
				if (Object.keys(this.images).length && !this.items.some((item) => item.image)) this.rebuild();
				if (this.filter.category === 'plugins' || this.filter.category === 'fm1' || this.filter.category === 'fm1live') this.actions.wantFirmware();
				this.post({ type: 'init', page, items: this.items, user: this.user, preview: this.preview, filter: this.filter }, page);
				if (page === 'library' && this.controls) this.post({ type: 'controls', state: this.controls }, page);
				return;
			}
			case 'play': {
				const item = this.item(message.id);
				if (!item?.sound) return;
				const index = message.index ?? item.index ?? 0;
				const bpm = this.controls?.tempo?.bpm ?? DEFAULT_PREVIEW_BPM;
				const duration = previewCycleSeconds({ bpm });
				if (item.kind === 'firmware' && item.runtime === 'hardware') {
					const id = item.id.slice('firmware:'.length);
					const profile = HARDWARE_FM1_PROFILES.find((p) => p.id === id);
					const sent = await this.actions.previewMidi(profile?.defaultPort ?? 'FM-1', Math.round(duration * 1000));
					if (sent) this.output.appendLine(`browser: preview ${item.label} -> MIDI ${sent}`);
					else void vscode.window.setStatusBarMessage(`strdltn: connect ${profile?.defaultPort ?? 'M-VAVE FM-1'} over MIDI to preview ${item.label}`, 4000);
					return;
				}
				// While a song plays, route previews to its engine so they land on the next beat.
				// Exception: a firmware the playing engine does not hold yet (e.g. Available) plays in the Browser.
				if (this.actions.playing()) {
					if (item.kind !== 'firmware' || item.index !== undefined) {
						this.actions.preview(item.sound, index);
						return;
					}
				}
				if (item.kind === 'firmware') {
					const id = item.id.slice('firmware:'.length);
					const webview = this.views.get(page)?.webview;
					const file = webview ? await this.actions.firmwareFile(id) : undefined;
					if (!file || !webview) return;
					if (item.runtime === 'fwsc') {
						const emu = await this.actions.emuWasmFile();
						if (!emu) return;
						const workletUrl = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'fm1-worklet.js')).toString();
						return this.post(
							{
								type: 'playPreview',
								plan: { kind: 'fm1', id, url: webview.asWebviewUri(file).toString(), emuUrl: webview.asWebviewUri(emu).toString(), workletUrl, bpm, duration },
							},
							page,
						);
					}
					const workletUrl = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'vibe-worklet.js')).toString();
					return this.post({ type: 'playPreview', plan: { kind: 'firmware', id, url: webview.asWebviewUri(file).toString(), workletUrl, bpm, duration } }, page);
				}
				const plan = previewPlan(this.sounds.find((sound) => sound.name === item.sound), index);
				if (plan) return this.post({ type: 'playPreview', plan: { ...plan, duration } }, page);
				this.actions.preview(item.sound, index);
				return;
			}
			case 'insert': {
				const item = this.item(message.id);
				if (!item) return;
				if (item.kind === 'song' || item.kind === 'render') return this.open(item);
				// An Available firmware is installed first: Enter and a double click do that.
				if (item.kind === 'firmware' && item.available) return this.actions.install(item.id.slice('firmware:'.length));
				if (item.kind === 'firmware' && item.runtime === 'hardware') return this.actions.insertHardware(item.id.slice('firmware:'.length));
				if (item.kind === 'firmware') {
					const code = firmwareCode(item.id.slice('firmware:'.length), item.runtime);
					return this.actions.insertFirmware(code.code, code.name, item.runtime === 'fwsc' ? undefined : item.url);
				}
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
			case 'install': {
				const item = this.item(message.id);
				if (item?.kind === 'firmware' && item.available) await this.actions.install(item.id.slice('firmware:'.length));
				return;
			}
			case 'screen': {
				const item = this.item(message.id);
				if (item?.kind === 'firmware') this.actions.showScreen(item.id.slice('firmware:'.length));
				return;
			}
			case 'openEditor': {
				const item = this.item(message.id);
				if (item?.kind === 'firmware') this.actions.openEditor(item.id.slice('firmware:'.length));
				return;
			}
			case 'runNative': {
				const item = this.item(message.id);
				if (item?.kind === 'firmware') await this.actions.runNative(item.id.slice('firmware:'.length));
				return;
			}
			case 'insertSong': {
				const item = this.item(message.id);
				const uri = item?.kind === 'song' && item.path ? this.songs.uri(item.path) : undefined;
				if (!uri) return;
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
				// The header (`// @title`, `// @by`...) describes the song; only its code goes in, as for a snippet.
				const code = parseSnippet(item!.label, text).code;
				if (code.trim()) return this.actions.insert(code);
				return;
			}
			case 'copy': {
				const item = this.item(message.id);
				const text =
					item &&
					(item.kind === 'sound'
						? soundCode(item, message.index)?.name
						: item.kind === 'firmware'
							? item.runtime === 'hardware'
								? (HARDWARE_FM1_PROFILES.find((p) => p.id === item.id.slice('firmware:'.length))?.defaultPort ?? 'M-VAVE FM-1')
								: firmwareCode(item.id.slice('firmware:'.length), item.runtime).name
							: item.kind === 'song' || item.kind === 'render'
								? item.path
								: item.kind === 'midi'
									? item.label
									: item.insert);
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
				if (message.action === 'stop') this.post({ type: 'stopPreview' });
				return this.actions.control(message);
			case 'tempo':
				return this.actions.control(message);
			case 'dragItem':
				this.lastDrag = { id: message.id, index: message.index, at: Date.now() };
				return;
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
