import * as vscode from 'vscode';
import { type BrowserFilterState, type FromBrowser, viewOf } from '../shared/browser';
import { CATEGORIES } from '../shared/catalog';
import { chooseInsert, type InsertArgument } from '../shared/context';
import type { SoundInfo } from '../shared/protocol';
import { BrowserView, INDEX_FILE } from './browser';
import { SongList } from './files';
import { FirmwareCache, FirmwareLibrary } from './firmware';
import { FirmwareScreen } from './screen';
import { firmwareLoadEdit, type InstalledFirmware } from '../shared/firmware';
import { DevicesView } from './devices';
import { KnobLearn } from './knobs';
import { MidiBridge } from './midi';
import type { MidiPorts } from '../shared/midi';
import { MixerView } from './mixer';
import { Place } from './surface';
import { lf, lineColumn } from '../shared/sync';
import { formatBytes, PackCache, type CacheUsage } from './packs';
import { ShrubPanel } from './shrub';
import { Session, type SessionHost } from './session';
import { saveAudio } from './render';
import { DEFAULT_RENDER_CYCLES, renderCycles } from '../shared/render';
import { SnippetLibrary } from './snippets';

/** `git describe` of the checkout this bundle was built from. Set by scripts/build.mjs. */
declare const __BUILD__: string;

const EDITOR_VIEW_TYPE = 'strdltn.editor';
const STAGE_VIEW_TYPE = 'strdltn.stage';

/** What `activate` returns. Only the integration test in `src/test/` uses it. */
export interface StrdltnApi {
	sessions(): { mode: string; uri: string; started: boolean; error?: string; logs: string[] }[];
	/** What the status bar item shows, or undefined while it is hidden. */
	status(): { text: string; tooltip: string } | undefined;
	/** What the caches of the open workspace folders hold. */
	packCache(): Promise<CacheUsage>;
	/** The MIDI ports, and how many events the worker sent and how late. Undefined while no song used MIDI. */
	midi(): Promise<{ ports?: MidiPorts; stats?: { sent: number; late: { p50: number; max: number } } }>;
	/** How many sounds the list holds that is kept for the next start. */
	rememberedSounds(): Promise<number>;
	sounds(): SoundInfo[];
	snippets(): string[];
	/** The songs of the workspace, as paths from the workspace folder. */
	files(): string[];
	snippetDetails(): { name: string; folder: string; title: string; category?: string; fields: number; codeStartsWith: string }[];
	/** How many items each category of the Browser holds. */
	browserCounts(): Record<string, number>;
	/** The ids of the items a filter gives, worked out in the host. */
	browserFind(filter: Partial<BrowserFilterState>): string[];
	/** The headings of a category in the Browser: the banks of Drums, the folders of Songs. */
	browserGroups(category: BrowserFilterState['category']): string[];
	/** Sets what the Browser shows, and returns what it reports back. */
	browserShow(filter: Partial<BrowserFilterState>, open?: string[]): Promise<unknown>;
	/** Handles a message as if the Browser had sent it: a click on a row, a color. */
	browserMessage(message: FromBrowser): Promise<void>;
	/** The previews the Browser played without the engine. */
	browserPreviews(): string[];
	/** The Mixer's model of the song in front. */
	mixer(): ReturnType<MixerView['current']>;
	/** The firmwares of the Library's Firmware category, and what the screen popup reports. */
	firmware(): { installed: InstalledFirmware[]; screen: ReturnType<FirmwareScreen['current']> };
	/** Opens the screen popup of an installed firmware, as its button in the Library does. */
	firmwareScreen(id: string | undefined): void;
	/** The firmware copies the Devices view lists, the frames passed on, and what its page reports. */
	devices(): ReturnType<DevicesView['current']>;
	/** Unfolds the named strips of the Mixer, folds the others, and returns what it reports. */
	mixerShow(unfold: string[]): ReturnType<MixerView['show']>;
	/** Moves a fader of the Mixer, as a drag would. For the test. */
	mixerSlider(index: number, value: string): void;
	/** Floats the Mixer (in a new window when `window`) or docks it. Returns the place and how many pages it has had. */
	mixerPlace(where: 'float' | 'tab' | 'dock'): Promise<{ floating: boolean; pages: number }>;
	/** M, S or G of a chain, as a click sends it. */
	mixerToggle(chain: number, button: 'mute' | 'solo' | 'gain' | 'scope'): Promise<void>;
	/** The BPM box: a number, or undefined as a double click. */
	mixerTempo(bpm: number | undefined): Promise<void>;
	/** A sidechain cable dropped on a strip, or pulled off onto nothing. */
	mixerCable(from: number, drop: { to: number; move?: number } | { orbit: number }): Promise<void>;
	/** Puts the editor's cursor on a chain of the Mixer's song. */
	mixerReveal(chain: number): void;
	/** Puts the cursor of the song in front on the first place `text` is written. For the video's capture. */
	revealText(text: string): Promise<boolean>;
	/** Sends MIDI bytes to an output now: the video's capture plays a controller through a loopback port. */
	midiSend(port: string, bytes: number[]): Promise<boolean>;
	/** The remote sample packs seen so far and whether they are in the cache. */
	packs(): { source: string; files: number; complete: boolean; note?: string }[];
	previewSounds(): boolean;
	identity: string;
}

export function activate(context: vscode.ExtensionContext): StrdltnApi {
	const output = vscode.window.createOutputChannel('strdltn');
	// Says which copy is running: the promoted one in the maintainer's own editor
	// (extensionMode Production) or the work in progress in a development host.
	const identity = `strdltn ${context.extension.packageJSON.version} (build ${__BUILD__}, ${vscode.ExtensionMode[context.extensionMode].toLowerCase()})`;
	output.appendLine(identity);
	const sessions = new Set<Session>();
	const packs = new PackCache(output);
	const firmwareCache = new FirmwareCache(output);
	const firmwareLibrary = new FirmwareLibrary(firmwareCache);
	context.subscriptions.push(firmwareLibrary);
	const midi = new MidiBridge(context.asAbsolutePath('dist'), output);
	context.subscriptions.push(midi);
	const snippets = new SnippetLibrary();
	const songs = new SongList();
	const browser = new BrowserView(context, snippets, songs, output, {
		preview: (name, index) => previewSound(name, index),
		playing: () => [...sessions].some((s) => s.started),
		control: (message) => mixer.control(message),
		insert: (text, bare, argument) => insertText(text, bare, argument),
		insertFirmware: (text, bare, url) => insertFirmware(text, bare, url),
		showScreen: (id) => screen.show(id),
	});
	// The popup's Insert does what the Library row's does.
	const screen = new FirmwareScreen(context, firmwareLibrary, output, (id) => void browser.handle({ type: 'insert', id: `firmware:${id}` }));
	context.subscriptions.push(firmwareLibrary.onDidChange((list) => browser.setFirmware(list)));
	void firmwareLibrary.refresh();
	// The MIDI category of the Browser: the ports of this machine, kept current by the worker (it reads them every 2 s).
	// Only where the extension host runs on the user's machine: in a Codespace it would list the cloud machine's.
	context.subscriptions.push(midi.onPorts((ports) => browser.setMidiPorts(ports)));
	// MIDI debugging: every message in and out as text in Output > strdltn (see MidiBridge).
	context.subscriptions.push(
		vscode.commands.registerCommand('strdltn.midi.toggleDebug', async () => {
			const config = vscode.workspace.getConfiguration('strdltn.midi');
			const on = !config.get<boolean>('debug', false);
			await config.update('debug', on, vscode.ConfigurationTarget.Global);
			if (on) output.show(true);
			void vscode.window.showInformationMessage(on ? 'MIDI messages now show in Output > strdltn.' : 'MIDI messages no longer show in the Output.');
		}),
	);
	if (!vscode.env.remoteName) void midi.listPorts();
	/** Evaluates the song again where it plays, so a mute, a solo or a new knob is heard at once. */
	const evaluateIfPlaying = (document: vscode.TextDocument) => {
		for (const session of sessions) if (session.document === document && session.ready && session.started) session.play();
	};
	const knobs = new KnobLearn(context, midi, output, evaluateIfPlaying);
	context.subscriptions.push(knobs);
	const mixer = new MixerView(context, output, {
		reveal: (document, offset) => void revealOffset(document, offset),
		moveSlider: (document, index, from, value) => {
			const session = [...sessions].find((s) => s.document === document && s.ready);
			session?.moveSlider(index, from, value);
			return !!session;
		},
		evaluate: evaluateIfPlaying,
		learnKnob: (document, from) => knobs.learn(document, from, true),
		transport: (document, action) => {
			const session = [...sessions].find((s) => s.document === document && s.ready);
			if (session) return transportOn(session, action);
			// No engine has the song yet: open it and do it there, as the buttons of its title would.
			if (action !== 'stop') void vscode.commands.executeCommand('vscode.open', document.uri).then(() => vscode.commands.executeCommand(`strdltn.${action}`));
		},
		isPlaying: (document) => [...sessions].some((s) => s.document === document && s.started),
		busy: (document) => {
			const of = [...sessions].filter((s) => s.document === document);
			return { recording: of.some((s) => s.recording), rendering: of.some((s) => s.rendering) };
		},
		controls: (state) => browser.setControls(state),
	});
	// The Mixer docks in the bottom panel or floats in a window of its own. See "Dock and float" in doc/DAW-PLAN.md.
	// The Devices view keeps no page while hidden: a hidden page draws nothing, and the worklet stops at the frame it
	// waits an answer for. A new page asks for frames again.
	const devices = new DevicesView(context, output);
	const mixerPlace = new Place(mixer, { viewId: 'strdltn.mixer', tabType: 'strdltn.mixerTab', title: 'Mixer', contextKey: 'strdltn.mixerFloating' });
	const diagnostics = vscode.languages.createDiagnosticCollection('strdltn');
	// Right side, beside the language of the file: it is about the file in front.
	const status = vscode.window.createStatusBarItem('strdltn.status', vscode.StatusBarAlignment.Right, 101);
	status.name = 'strdltn';
	status.command = 'strdltn.togglePlay';
	// The item cannot be asked whether it shows. The test wants to know.
	let statusVisible = false;
	const showStatus = (visible: boolean) => {
		statusVisible = visible;
		if (visible) status.show();
		else status.hide();
	};
	const host: SessionHost = {
		output,
		packs,
		firmwareCache,
		midi,
		diagnostics,
		onDispose: (session) => {
			sessions.delete(session);
			devices.forget(session);
			updateStatus();
		},
		// Every engine loads the same packs, so the list of the engine that spoke last is the list.
		onScopes: (document, scopes) => mixer.setScopes(document, scopes),
		onSliderLive: (document, from, value) => mixer.sliderLive(document, from, value),
		onKnobGhost: (document, from, value) => mixer.knobGhost(document, from, value),
		onKnobLearn: (document, from, toggle) => knobs.learn(document, from, toggle),
		onDevices: (session, list) => devices.setDevices(session, list),
		onFrame: (session, key, px, values) => devices.frame(session, key, px, values),
		onAudio: async (session, kind, wav, info) => {
			try {
				const files = await saveAudio(session.document.uri, kind, wav);
				const clipped = info.peak !== undefined && info.peak > 1 ? `, clipped: it peaked at ${info.peak.toFixed(2)} of full scale` : '';
				output.appendLine(`${kind}: ${files.map((f) => vscode.workspace.asRelativePath(f)).join(', ')} (${info.seconds.toFixed(1)} s${clipped})`);
				void songs.refresh();
				const name = files[0].path.split('/').pop();
				void vscode.window.showInformationMessage(`strdltn: ${kind === 'render' ? 'rendered' : 'recorded'} ${name} and its .mp3 (${info.seconds.toFixed(1)} s${clipped})`, 'Play', 'Reveal').then((choice) => {
					if (choice === 'Play') void vscode.commands.executeCommand('vscode.open', files[0]);
					if (choice === 'Reveal') void vscode.commands.executeCommand('revealInExplorer', files[0]);
				});
			} catch (error) {
				void vscode.window.showErrorMessage(`strdltn: could not write the ${kind === 'render' ? 'render' : 'recording'}: ${(error as Error).message}`);
			}
		},
		onSounds: (list) => {
			browser.setSounds(list);
			rememberSoundsSoon(list);
		},
		onState: (session) => {
			// A song that starts brings the Mixer to the front, as the maintainer asked: while
			// it plays, that is where its levels are.
			mixer.setPlaying(session.document, session.started);
			if (session.started && !playing.has(session)) {
				playing.add(session);
				void mixerPlace.reveal();
			} else if (!session.started) playing.delete(session);
			updateStatus();
		},
	};
	/** The sessions that played at the last state report, to see a song start. */
	const playing = new Set<Session>();

	const find = (uri: vscode.Uri, mode: Session['mode']) =>
		[...sessions].find((s) => s.mode === mode && s.document.uri.toString() === uri.toString());
	const activeEditorSession = () => [...sessions].find((s) => s.mode === 'editor' && s.panel.active);
	/** The session the user was in last. Focus is in a side bar view when this is asked. */
	const lastSession = (mode?: Session['mode']) =>
		[...sessions].filter((s) => !mode || s.mode === mode).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
	const isStrudel = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor => editor?.document.languageId === 'strudel';
	/**
	 * The session of the tab in front: the Strudel editor or the stage that is active, or
	 * the stage of the native editor that is active. Undefined in any other tab.
	 */
	const frontSession = () => {
		const native = vscode.window.activeTextEditor;
		return [...sessions].find((s) => s.panel.active) ?? (isStrudel(native) ? find(native.document.uri, 'stage') : undefined);
	};
	/** The Strudel editor in front, not a stage. */
	const frontEditor = () => [...sessions].find((s) => s.panel.active && s.mode === 'editor');
	/** A song that still plays in a tab that is not in front. The one the user was in last. */
	const playingElsewhere = () =>
		[...sessions].filter((s) => s.started).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];

	context.subscriptions.push(
		output,
		vscode.window.registerCustomEditorProvider(
			EDITOR_VIEW_TYPE,
			{
				resolveCustomTextEditor(document, panel) {
					// The Strudel editor replaces the stage of the same file. Two engines on
					// one file would play the pattern twice.
					find(document.uri, 'stage')?.panel.dispose();
					sessions.add(new Session(context, document, panel, 'editor', host));
					updateStatus();
				},
			},
			// Without retainContextWhenHidden the webview is destroyed when its tab is
			// hidden, and the sound stops with it.
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
		),
		// The Browser keeps its page while hidden, so its filters and open headings survive a
		// switch to another side bar.
		vscode.window.registerWebviewViewProvider('strdltn.browser', browser.provider('library'), { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewViewProvider('strdltn.reference', browser.provider('reference'), { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewViewProvider('strdltn.results', browser.provider('results'), { webviewOptions: { retainContextWhenHidden: true } }),
		// The Mixer keeps its page too, so its strips stay unfolded behind the Terminal tab.
		vscode.window.registerWebviewViewProvider('strdltn.mixer', mixerPlace, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewViewProvider('strdltn.devices', devices),
		vscode.commands.registerCommand('strdltn.mixer.float', () => mixerPlace.float()),
		vscode.commands.registerCommand('strdltn.mixer.dock', () => mixerPlace.dock()),
		diagnostics,
		status,
		vscode.window.onDidChangeActiveTextEditor(() => updateStatus()),
		vscode.commands.registerCommand('strdltn.focusSearch', () => browser.focusSearch()),
		vscode.commands.registerCommand('strdltn.refreshBrowser', () =>
			Promise.all([browser.refresh(), ...[...sessions].flatMap((s) => [s.refreshSamples(), s.refreshFirmware()])]),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(() => browser.refresh()),

		vscode.commands.registerCommand('strdltn.record', async () => {
			const session = await readySession();
			if (session) transportOn(session, 'record');
		}),
		vscode.commands.registerCommand('strdltn.render', async () => {
			const session = await readySession();
			if (session) transportOn(session, 'render');
		}),
		vscode.commands.registerCommand('strdltn.play', async () => {
			const session = activeEditorSession() ?? (await stageForActiveTextEditor()) ?? onlySession();
			session?.play();
		}),
		// Stop is for the song in front. With nothing playing there, it is for the song
		// that plays in another tab, so the key always ends a sound you hear.
		vscode.commands.registerCommand('strdltn.stop', () => {
			const front = frontSession();
			(front?.started ? front : (playingElsewhere() ?? front))?.stop();
		}),
		vscode.commands.registerCommand('strdltn.stopAll', () => sessions.forEach((s) => s.stop())),
		// The click on the status bar item.
		vscode.commands.registerCommand('strdltn.togglePlay', () => {
			const session = frontSession() ?? (isStrudel(vscode.window.activeTextEditor) ? undefined : playingElsewhere());
			if (session?.started) return session.stop();
			return vscode.commands.executeCommand('strdltn.play');
		}),
		vscode.commands.registerCommand('strdltn.showPackCache', showPackCache),
		vscode.commands.registerCommand('strdltn.clearPackCache', clearPackCache),
		vscode.commands.registerCommand('strdltn.openStage', () => stageForActiveTextEditor()),
		vscode.commands.registerCommand('strdltn.toggleMode', toggleMode),
		// VS Code's editing keys in the Strudel editor. Upstream's CodeMirror binds none of
		// these keys (Ctrl+F, Ctrl+H, Ctrl+G, Ctrl+D, Ctrl+Shift+L), so the key leaves the webview and VS Code runs these, bound under
		// `activeCustomEditorId == strdltn.editor`. A user rebinds them like any command.
		knobs.onLearning(({ document, from }) => {
			for (const session of sessions) if (session.document === document) session.knobLearning(from);
			mixer.knobLearning(document, from);
		}),
		// Ctrl+Alt+K: the Strudel editor knows its own cursor; the native editor's is here.
		vscode.commands.registerCommand('strdltn.knobLearn', () => {
			const editor = frontEditor();
			if (editor) return editor.knobLearn();
			const native = vscode.window.activeTextEditor;
			if (isStrudel(native)) return knobs.learnAtOffset(native.document, native.document.offsetAt(native.selection.active));
		}),
		// The line number menu of the native editor (a right click on a line number).
		vscode.commands.registerCommand('strdltn.knobLearnLine', async (arg?: { lineNumber: number; uri: vscode.Uri }) => {
			if (!arg) return;
			const document = await vscode.workspace.openTextDocument(arg.uri);
			return knobs.learnLine(document, arg.lineNumber - 1);
		}),
		...(['find', 'replace', 'gotoLine', 'selectNextMatch', 'selectAllMatches'] as const).map((action) =>
			vscode.commands.registerCommand(`strdltn.editor.${action}`, () => frontEditor()?.editorAction(action)),
		),

		// The Browser calls these itself. They stay commands for keybindings and for the test,
		// with a sound or a snippet given by name.
		vscode.commands.registerCommand('strdltn.previewSound', (arg: { sound: { name: string }; index?: number }) => previewSound(arg.sound.name, arg.index ?? 0)),
		vscode.commands.registerCommand('strdltn.insertSound', (arg: { sound: { name: string } }) => insertText(arg.sound.name)),
		// The header of a snippet describes it. Only the code goes into the song.
		vscode.commands.registerCommand('strdltn.insertSnippet', (snippet: { name: string }) => {
			const found = snippets.find(snippet.name);
			if (found) return insertText(found.code);
		}),
		vscode.commands.registerCommand('strdltn.openShrubEditor', () => ShrubPanel.show(context)),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('strdltn.experimental.shrubEditor')) ShrubPanel.settingChanged();
		}),
		vscode.commands.registerCommand('strdltn.showVersion', () => vscode.window.showInformationMessage(identity)),
	);

	watchFolders();

	/**
	 * The status bar item says what the song in front does: loading, stopped, playing,
	 * waiting for a click, or an error in the code. It is hidden in a tab that is not a
	 * Strudel file, unless a song still plays in the background. Then it names that song.
	 */
	function updateStatus(): void {
		const native = vscode.window.activeTextEditor;
		const front = frontSession();
		const session = front ?? (isStrudel(native) ? undefined : playingElsewhere());
		if (!session) {
			// A Strudel file in the native editor that has not played yet has no stage.
			if (!isStrudel(native)) return showStatus(false);
			status.text = '$(debug-stop) strdltn: stopped';
			status.tooltip = 'Click to play. A stage opens beside the code.';
			status.backgroundColor = undefined;
			return showStatus(true);
		}
		const name = session.document.uri.path.split('/').pop();
		const where = session === front ? '' : `${name} `;
		const { started, audio, needsClick } = session.state;
		let icon = started ? 'play' : 'debug-stop';
		let text = started ? 'playing' : 'stopped';
		if (!session.ready) [icon, text] = ['loading~spin', 'loading'];
		else if (needsClick) [icon, text] = ['mute', `click in the ${session.mode === 'stage' ? 'stage' : 'editor'} for sound`];
		else if (session.error) [icon, text] = ['error', started ? 'playing, error in the code' : 'error in the code'];
		status.text = `$(${icon}) strdltn: ${where}${text}`;
		status.tooltip = [
			`${name}: ${started ? 'playing' : 'stopped'}, audio ${audio}`,
			...(session.error ? [`Error: ${session.error}`] : []),
			...(needsClick ? ['A browser starts no sound without a click inside the page.'] : []),
			`Click to ${started ? 'stop' : 'play'}.`,
		].join('\n');
		status.backgroundColor = session.error ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
		showStatus(true);
	}

	// ---- the sound list between starts ----------------------------------------------
	//
	// The list lives in an engine, and an engine exists only while a .strudel file is
	// open. So the last list is kept in a file and shown at the next start, before any
	// file is open. The workspace keeps the whole list. A second copy without the
	// sounds that belong to one workspace (its own samples, the packs of its songs) is
	// for a workspace that has no list yet.

	const soundFiles = () => ({
		workspace: context.storageUri && vscode.Uri.joinPath(context.storageUri, 'sounds.json'),
		global: vscode.Uri.joinPath(context.globalStorageUri, 'sounds.json'),
	});
	let rememberTimer: ReturnType<typeof setTimeout> | undefined;
	let remembering: Promise<unknown> = Promise.resolve();
	function rememberSoundsSoon(list: SoundInfo[]): void {
		clearTimeout(rememberTimer);
		rememberTimer = setTimeout(() => {
			const write = async (file: vscode.Uri | undefined, kept: SoundInfo[]) => {
				if (!file) return;
				await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
				await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(kept)));
			};
			const files = soundFiles();
			const shared = list.filter((sound) => sound.tag !== 'local' && !/^(github:|https:)/.test(sound.tag ?? ''));
			remembering = Promise.all([write(files.workspace, list), write(files.global, shared)]).catch((error: Error) =>
				output.appendLine(`sound list not kept: ${error.message}`),
			);
		}, 2000);
	}
	async function readSounds(): Promise<SoundInfo[]> {
		const files = soundFiles();
		for (const file of [files.workspace, files.global]) {
			if (!file) continue;
			try {
				const list = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
				if (Array.isArray(list)) return list;
			} catch {
				// Never written, or not readable. Try the next one.
			}
		}
		return [];
	}
	async function recallSounds(): Promise<void> {
		const list = await readSounds();
		// An engine may have answered while the file was read. Its list is the newer one.
		if (list.length && !browser.allSounds().length) browser.setSounds(list);
	}

	// ---- the cache of remote samples ------------------------------------------------

	const workspaceUris = () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
	const describe = (usage: CacheUsage) =>
		`${formatBytes(usage.bytes)} in ${usage.files} files${usage.packs.length ? ` (${usage.packs.join(', ')})` : ''}`;

	async function showPackCache(): Promise<void> {
		const usage = await packs.usage(workspaceUris());
		if (!usage.files) return void vscode.window.showInformationMessage('The sample pack cache is empty.');
		const answer = await vscode.window.showInformationMessage(`Sample pack cache (.strdltn/cache): ${describe(usage)}.`, 'Clear cache');
		if (answer) await clearPackCache();
	}

	async function clearPackCache(): Promise<void> {
		if (packs.busy) return void vscode.window.showWarningMessage('A sample pack is being downloaded. Clear the cache when it is done.');
		const usage = await packs.usage(workspaceUris());
		if (!usage.files) return void vscode.window.showInformationMessage('The sample pack cache is empty.');
		const answer = await vscode.window.showWarningMessage(
			'Delete the sample pack cache?',
			{
				modal: true,
				detail: `${describe(usage)}, in .strdltn/cache. A song that loads a pack downloads it again the next time it is opened or edited. To stop that, turn off the setting strdltn.remoteSamples.cache.`,
			},
			'Delete',
		);
		if (answer !== 'Delete') return;
		await packs.clear(workspaceUris());
		void vscode.window.showInformationMessage(`Sample pack cache deleted: ${formatBytes(usage.bytes)}.`);
	}

	function previewSound(name: string, index: number): void {
		const session = activeEditorSession() ?? lastSession();
		// Samples and plain waves play in the Browser without this. What is left needs the
		// engine: soundfonts, supersaw, firmwares.
		if (!session) return void vscode.window.showInformationMessage(`"${name}" is played by the Strudel engine: open a .strudel file first.`);
		session.preview(name, index);
	}

	/**
	 * Inserts at the cursor of whichever editor the user is working in. The Strudel
	 * editor is a webview, so `activeTextEditor` is undefined while it is the active tab.
	 */
	async function insertText(text: string, bare?: string, argument?: InsertArgument): Promise<void> {
		const strudel = activeEditorSession();
		const native = vscode.window.activeTextEditor;
		if (strudel) return strudel.insert(text, bare, argument);
		// Only into a Strudel file. A click in the Sounds view (before the Browser) while a
		// markdown file had the focus typed sound names into it, and nobody saw it happen.
		if (isStrudel(native)) {
			const code = native.document.getText();
			await native.edit((builder) =>
				native.selections.forEach((selection) => {
					builder.replace(selection, chooseInsert(code, native.document.offsetAt(selection.start), text, bare, argument));
				}),
			);
			return;
		}
		const last = lastSession('editor');
		if (last) return last.insert(text, bare, argument);
		// A tab of ours is in front (the firmware screen), and the song is in the native editor beside it.
		const visible = vscode.window.visibleTextEditors.find(isStrudel);
		if (visible) {
			const code = visible.document.getText();
			await visible.edit((builder) => builder.replace(visible.selection, chooseInsert(code, visible.document.offsetAt(visible.selection.start), text, bare, argument)));
			return;
		}
		void vscode.window.showInformationMessage('Open a .strudel file to insert into.');
	}

	/** The song an insert goes into, picked as insertText picks it. */
	function insertTarget(): vscode.TextDocument | undefined {
		const native = vscode.window.activeTextEditor;
		return (activeEditorSession() ?? (isStrudel(native) ? undefined : lastSession('editor')))?.document ?? (isStrudel(native) ? native.document : vscode.window.visibleTextEditors.find(isStrudel)?.document);
	}

	/**
	 * A firmware's line at the cursor. A cached firmware plays only in a song that loads it, so when the song has no
	 * `firmware('<url>')` for it, that line goes in first, at the top (firmwareLoadEdit). Both editors follow a
	 * WorkspaceEdit, and the cursor moves with the text above it, so the line at the cursor still lands where it was.
	 */
	async function insertFirmware(text: string, bare: string, url?: string): Promise<void> {
		const document = insertTarget();
		if (url && document) {
			const code = lf(document.getText());
			const load = firmwareLoadEdit(code, url);
			if (load) {
				const at = lineColumn(code, load.offset);
				const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
				const edit = new vscode.WorkspaceEdit();
				edit.insert(document.uri, new vscode.Position(at.line, at.character), load.text.replace(/\n/g, eol));
				await vscode.workspace.applyEdit(edit);
			}
		}
		return insertText(text, bare);
	}

	/**
	 * Puts the cursor at an offset of a song: in its Strudel editor when it has one,
	 * else in the native editor, opened where the song already shows.
	 */
	async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> {
		const strudel = find(document.uri, 'editor');
		if (strudel) {
			strudel.panel.reveal(undefined, false);
			return strudel.select(offset);
		}
		const shown = vscode.window.visibleTextEditors.find((e) => e.document === document);
		const at = lineColumn(lf(document.getText()), offset);
		const position = new vscode.Position(at.line, at.character);
		await vscode.window.showTextDocument(document, { viewColumn: shown?.viewColumn, selection: new vscode.Range(position, position) });
	}

	/** New samples, snippets and songs show up without a reload. */
	function watchFolders(): void {
		// The Songs of the Browser are every .strudel file of the workspace, so it follows all
		// of them. Not changes: it shows names, and a save does not change a name.
		const songFiles = vscode.workspace.createFileSystemWatcher('**/*.strudel', false, true, false);
		// Renders and recordings show under Render in the Library, so a new .wav or .mp3 is looked at too.
		const audioFiles = vscode.workspace.createFileSystemWatcher('**/*.{wav,mp3}', false, true, false);
		let filesTimer: ReturnType<typeof setTimeout> | undefined;
		const filesChanged = () => {
			// A checkout or a copied folder fires one event per file.
			clearTimeout(filesTimer);
			filesTimer = setTimeout(() => void songs.refresh(), 300);
		};
		// The colors and tags of the project, when git or a hand edit changes the file.
		const indexFile = vscode.workspace.createFileSystemWatcher(`**/${INDEX_FILE}`);
		let indexTimer: ReturnType<typeof setTimeout> | undefined;
		const indexChanged = () => {
			clearTimeout(indexTimer);
			indexTimer = setTimeout(() => void browser.refresh(), 300);
		};
		context.subscriptions.push(
			songFiles,
			songFiles.onDidCreate(filesChanged),
			songFiles.onDidDelete(filesChanged),
			audioFiles,
			audioFiles.onDidCreate(filesChanged),
			audioFiles.onDidDelete(filesChanged),
			indexFile,
			indexFile.onDidCreate(indexChanged),
			indexFile.onDidChange(indexChanged),
		);
		let watchers: vscode.Disposable[] = [];
		let samplesTimer: ReturnType<typeof setTimeout> | undefined;
		const samplesChanged = () => {
			// Copying a folder of samples fires one event per file.
			clearTimeout(samplesTimer);
			samplesTimer = setTimeout(() => sessions.forEach((s) => void s.refreshSamples()), 500);
		};
		let firmwareTimer: ReturnType<typeof setTimeout> | undefined;
		const firmwareChanged = () => {
			clearTimeout(firmwareTimer);
			firmwareTimer = setTimeout(() => sessions.forEach((s) => void s.refreshFirmware()), 500);
		};
		const create = () => {
			watchers.forEach((w) => w.dispose());
			const configuration = vscode.workspace.getConfiguration('strdltn');
			const samplesWatcher = vscode.workspace.createFileSystemWatcher(`**/${configuration.get('samplesFolder', 'samples')}/**`);
			const libWatcher = vscode.workspace.createFileSystemWatcher(`**/${SnippetLibrary.folderName()}/**/*.strudel`);
			const firmwareWatcher = vscode.workspace.createFileSystemWatcher(`**/${configuration.get('firmwareFolder', 'firmware')}/**`);
			watchers = [
				samplesWatcher,
				libWatcher,
				firmwareWatcher,
				firmwareWatcher.onDidCreate(firmwareChanged),
				firmwareWatcher.onDidDelete(firmwareChanged),
				firmwareWatcher.onDidChange(firmwareChanged),
				samplesWatcher.onDidCreate(samplesChanged),
				samplesWatcher.onDidDelete(samplesChanged),
				libWatcher.onDidCreate(() => snippets.refresh()),
				libWatcher.onDidDelete(() => snippets.refresh()),
				// A saved edit can change the header, which the Browser shows.
				libWatcher.onDidChange(() => snippets.refresh()),
			];
		};
		create();
		context.subscriptions.push(
			{ dispose: () => watchers.forEach((w) => w.dispose()) },
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('strdltn')) return;
				create();
				samplesChanged();
				void snippets.refresh();
			}),
		);
	}

	/** Play, Stop, Record or Render on one engine. A render takes the song's `// @length`, else the setting. */
	function transportOn(session: Session, action: 'play' | 'stop' | 'record' | 'render'): void {
		if (action === 'play') return session.play();
		if (action === 'stop') return session.stop();
		if (action === 'record') return session.record();
		const fallback = vscode.workspace.getConfiguration('strdltn.render').get<number>('cycles', DEFAULT_RENDER_CYCLES);
		session.render(renderCycles(session.document.getText(), fallback));
	}

	/** The engine a command acts on, once its page is loaded: a record or render sent before then would be lost. */
	async function readySession(): Promise<Session | undefined> {
		const session = activeEditorSession() ?? (await stageForActiveTextEditor()) ?? onlySession();
		for (let i = 0; session && !session.ready && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 100));
		return session?.ready ? session : undefined;
	}

	function onlySession(): Session | undefined {
		return sessions.size === 1 ? [...sessions][0] : undefined;
	}

	/** A stage that is being opened. A second play in the meantime waits for it instead of opening another. */
	let openingStage: Promise<Session> | undefined;

	async function stageForActiveTextEditor(): Promise<Session | undefined> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'strudel') return undefined;
		const existing = find(editor.document.uri, 'stage');
		if (existing) return existing;
		return (openingStage ??= openStage(editor).finally(() => (openingStage = undefined)));
	}

	/**
	 * Opens the stage of a file: below the code by default, or beside it
	 * (`strdltn.stage.position`). VS Code has no "below" for a new panel, so an empty
	 * group is split off under the code first and the stage is created in it. Then the
	 * focus goes back to the code. The user can drag the stage anywhere after that.
	 */
	async function openStage(editor: vscode.TextEditor): Promise<Session> {
		const below = vscode.workspace.getConfiguration('strdltn').get('stage.position', 'below') === 'below';
		if (below) await vscode.commands.executeCommand('workbench.action.newGroupBelow');
		const name = editor.document.uri.path.split('/').pop();
		const panel = vscode.window.createWebviewPanel(
			STAGE_VIEW_TYPE,
			`Stage: ${name}`,
			{ viewColumn: below ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside, preserveFocus: !below },
			{ retainContextWhenHidden: true },
		);
		const session = new Session(context, editor.document, panel, 'stage', host);
		sessions.add(session);
		updateStatus();
		if (below) await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
		return session;
	}

	async function toggleMode(): Promise<void> {
		const strudel = activeEditorSession();
		const native = vscode.window.activeTextEditor;
		let uri: vscode.Uri;
		let target: string;
		let column: vscode.ViewColumn | undefined;
		if (strudel) {
			uri = strudel.document.uri;
			target = 'default';
			column = strudel.panel.viewColumn;
		} else if (native?.document.languageId === 'strudel') {
			uri = native.document.uri;
			target = EDITOR_VIEW_TYPE;
			column = native.viewColumn;
		} else {
			return;
		}
		await vscode.commands.executeCommand('vscode.openWith', uri, target, column);
		// openWith swaps the tab in place (measured in 1.130). If a build leaves the old
		// tab open, close it so the file is never shown twice.
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input;
				const stale =
					target === 'default'
						? input instanceof vscode.TabInputCustom && input.viewType === EDITOR_VIEW_TYPE && input.uri.toString() === uri.toString()
						: input instanceof vscode.TabInputText && input.uri.toString() === uri.toString();
				if (stale) await vscode.window.tabGroups.close(tab, true);
			}
		}
	}

	// Last, when everything they use exists.
	void Promise.all([snippets.refresh(), songs.refresh()]).then(() => browser.start());
	void recallSounds();
	updateStatus();

	return {
		sessions: () =>
			[...sessions].map((s) => ({ mode: s.mode, uri: s.document.uri.toString(), started: s.started, error: s.error, logs: [...s.logs] })),
		status: () => (statusVisible ? { text: status.text, tooltip: String(status.tooltip ?? '') } : undefined),
		packCache: () => packs.usage(workspaceUris()),
		midi: async () => ({ ports: await midi.listPorts(), stats: await midi.stats() }),
		rememberedSounds: async () => {
			await remembering;
			return (await readSounds()).length;
		},
		sounds: () => browser.allSounds(),
		snippets: () => snippets.all().map((snippet) => snippet.name),
		files: () => songs.all(),
		identity,
		snippetDetails: () =>
			snippets.all().map((s) => ({ name: s.name, folder: s.folder, title: s.title, category: s.category, fields: s.fields.length, codeStartsWith: s.code.slice(0, 40) })),
		browserCounts: () => Object.fromEntries(CATEGORIES.map(({ id }) => [id, browser.find({ category: id }).length])),
		browserFind: (filter) => browser.find(filter).map((item) => item.id),
		browserGroups: (category) => [...new Set(browser.find({ category }).map((item) => item.group))].sort(),
		browserShow: async (filter, open) => {
			// The filter is the same in every view; Results shows what it picks.
			await vscode.commands.executeCommand(viewOf('results') + '.focus');
			// A view opened for the first time needs a moment before it takes messages.
			for (let i = 0; i < 20 && !browser.state(); i++) await new Promise((resolve) => setTimeout(resolve, 250));
			browser.show(filter, open);
			// The webview reports what it shows after it has drawn.
			await new Promise((resolve) => setTimeout(resolve, 600));
			return browser.state();
		},
		browserMessage: (message) => browser.handle(message),
		browserPreviews: () => [...browser.previews],
		mixer: () => mixer.current(),
		devices: () => devices.current(),
		firmware: () => ({ installed: firmwareLibrary.all(), screen: screen.current() }),
		firmwareScreen: (id) => (id ? screen.show(id) : screen.close()),
		mixerShow: async (unfold) => {
			if (!mixerPlace.floating) await vscode.commands.executeCommand('strdltn.mixer.focus');
			return mixer.show(unfold);
		},
		mixerSlider: (index, value) => mixer.moveSlider(index, value),
		mixerToggle: (chain, button) => mixer.toggle(chain, button),
		mixerTempo: (bpm) => mixer.setTempo(bpm),
		mixerCable: (from, drop) => mixer.cable(from, drop),
		mixerReveal: (chain) => mixer.revealChain(chain),
		revealText: async (text) => {
			const session = frontEditor() ?? [...sessions].find((s) => s.panel.visible);
			if (!session) return false;
			const offset = lf(session.document.getText()).indexOf(text);
			if (offset < 0) return false;
			await revealOffset(session.document, offset);
			return true;
		},
		midiSend: (port, bytes) => midi.sendNow(port, bytes),
		mixerPlace: async (where) => {
			if (where === 'dock') await mixerPlace.dock();
			else await mixerPlace.float(where === 'float');
			return { floating: mixerPlace.floating, pages: mixer.pages };
		},
		packs: () => packs.list(),
		previewSounds: () => context.globalState.get('strdltn.previewSounds', true),
	};
}

export function deactivate(): void {}
