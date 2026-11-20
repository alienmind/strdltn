import * as vscode from 'vscode';
import type { SoundInfo } from '../shared/protocol';
import { FilesProvider } from './files';
import { formatBytes, PackCache, type CacheUsage } from './packs';
import { Session, type SessionHost } from './session';
import { SnippetsView, type Snippet } from './snippets';
import { SoundsProvider, soundText, type SoundNode } from './sounds';

/** `git describe` of the checkout this bundle was built from. Set by scripts/build.mjs. */
declare const __BUILD__: string;

const EDITOR_VIEW_TYPE = 'vstrudel.editor';
const STAGE_VIEW_TYPE = 'vstrudel.stage';

/** What `activate` returns. Only the integration test in `src/test/` uses it. */
export interface VstrudelApi {
	sessions(): { mode: string; uri: string; started: boolean; error?: string; logs: string[] }[];
	/** What the status bar item shows, or undefined while it is hidden. */
	status(): { text: string; tooltip: string } | undefined;
	/** What the caches of the open workspace folders hold. */
	packCache(): Promise<CacheUsage>;
	/** How many sounds the list holds that is kept for the next start. */
	rememberedSounds(): Promise<number>;
	sounds(): SoundInfo[];
	soundGroups(): { label: string; count: number }[];
	snippets(): string[];
	/** The files of the Files view, as paths from the workspace folder. */
	files(): string[];
	/** Opens one top folder of the Files view. */
	expandFilesFolder(name: string): Promise<void>;
	/** The rows at the top of the Files view. */
	filesTopLevel(): string[];
	snippetDetails(): { name: string; folder: string; title: string; category?: string; fields: number; codeStartsWith: string }[];
	/** Opens one group of the Sounds view, or one drum machine bank. */
	expandSoundGroup(label: string): Promise<void>;
	expandSoundBank(name: string): Promise<void>;
	soundBanks(group?: string): string[];
	/** Shows the row of one snippet in the Snippets view. */
	expandSnippet(name: string): Promise<void>;
	/** Moves a slider of the stage of the active text editor. For the test. */
	setStageSlider(index: number, value: number): void;
	/** The remote sample packs seen so far and whether they are in the cache. */
	packs(): { source: string; files: number; complete: boolean; note?: string }[];
	previewSounds(): boolean;
	identity: string;
}

export function activate(context: vscode.ExtensionContext): VstrudelApi {
	const output = vscode.window.createOutputChannel('vstrudel');
	// Says which copy is running: the promoted one in the maintainer's own editor
	// (extensionMode Production) or the work in progress in a development host.
	const identity = `vstrudel ${context.extension.packageJSON.version} (build ${__BUILD__}, ${vscode.ExtensionMode[context.extensionMode].toLowerCase()})`;
	output.appendLine(identity);
	const sessions = new Set<Session>();
	const packs = new PackCache(output);
	const sounds = new SoundsProvider(context.extensionUri);
	const snippets = new SnippetsView();
	// Whether a click on a sound also plays it. A button at the top of the Sounds view
	// flips it, and the choice is kept between sessions.
	const PREVIEW_KEY = 'vstrudel.previewSounds';
	let previewSounds = context.globalState.get(PREVIEW_KEY, true);
	const setPreview = (on: boolean) => {
		previewSounds = on;
		void context.globalState.update(PREVIEW_KEY, on);
		void vscode.commands.executeCommand('setContext', PREVIEW_KEY, on);
		// In words beside the title of the view. The icon alone was read both ways.
		soundsView.description = on ? 'preview on' : 'preview off';
	};
	const diagnostics = vscode.languages.createDiagnosticCollection('vstrudel');
	// Right side, beside the language of the file: it is about the file in front.
	const status = vscode.window.createStatusBarItem('vstrudel.status', vscode.StatusBarAlignment.Right, 101);
	status.name = 'vstrudel';
	status.command = 'vstrudel.togglePlay';
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
		diagnostics,
		onDispose: (session) => {
			sessions.delete(session);
			updateStatus();
		},
		// Every engine loads the same packs, so the list of the engine that spoke last is the list.
		onSounds: (list) => {
			sounds.setSounds(list);
			rememberSoundsSoon(list);
		},
		onState: () => updateStatus(),
	};

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
	/** A song that still plays in a tab that is not in front. The one the user was in last. */
	const playingElsewhere = () =>
		[...sessions].filter((s) => s.started).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];

	const soundsView = vscode.window.createTreeView('vstrudel.sounds', { treeDataProvider: sounds, showCollapseAll: true });
	setPreview(previewSounds);
	const snippetsView = vscode.window.createTreeView('vstrudel.snippets', { treeDataProvider: snippets, showCollapseAll: true });
	const files = new FilesProvider();
	const filesView = vscode.window.createTreeView('vstrudel.files', { treeDataProvider: files, showCollapseAll: true });

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
		soundsView,
		diagnostics,
		status,
		vscode.window.onDidChangeActiveTextEditor(() => updateStatus()),
		// The view keeps its page while hidden, so open cards and the filter survive a
		// switch to another side bar view.
		snippetsView,
		// The logo at the top of the side bar. The header of a side bar takes text only,
		// so the picture is a view of its own: a page with one image and no script.
		vscode.window.registerWebviewViewProvider('vstrudel.logo', {
			resolveWebviewView(view) {
				view.webview.options = { localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
				const logo = view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.jpg'));
				view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src 'unsafe-inline'">
<style>html, body { margin: 0; padding: 0; overflow: hidden; } img { display: block; width: 100%; height: auto; }</style></head>
<body><img src="${logo}" alt="vstrudel - VS Code extension, live coding in strudel.cc"></body></html>`;
			},
		}),
		filesView,
		vscode.commands.registerCommand('vstrudel.refreshFiles', () => files.refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => files.refresh()),

		vscode.commands.registerCommand('vstrudel.play', () => {
			const session = activeEditorSession() ?? stageForActiveTextEditor() ?? onlySession();
			session?.play();
		}),
		// Stop is for the song in front. With nothing playing there, it is for the song
		// that plays in another tab, so the key always ends a sound you hear.
		vscode.commands.registerCommand('vstrudel.stop', () => {
			const front = frontSession();
			(front?.started ? front : (playingElsewhere() ?? front))?.stop();
		}),
		vscode.commands.registerCommand('vstrudel.stopAll', () => sessions.forEach((s) => s.stop())),
		// The click on the status bar item.
		vscode.commands.registerCommand('vstrudel.togglePlay', () => {
			const session = frontSession() ?? (isStrudel(vscode.window.activeTextEditor) ? undefined : playingElsewhere());
			if (session?.started) return session.stop();
			return vscode.commands.executeCommand('vstrudel.play');
		}),
		vscode.commands.registerCommand('vstrudel.showPackCache', showPackCache),
		vscode.commands.registerCommand('vstrudel.clearPackCache', clearPackCache),
		vscode.commands.registerCommand('vstrudel.openStage', () => stageForActiveTextEditor()),
		vscode.commands.registerCommand('vstrudel.toggleMode', toggleMode),

		vscode.commands.registerCommand('vstrudel.previewSound', previewSound),
		// A click on a sound selects it, and plays it when preview is on. It never types:
		// text goes into the code only through the insert button of the row.
		vscode.commands.registerCommand('vstrudel.clickSound', (node: SoundNode) => {
			if (previewSounds) previewSound(node);
		}),
		vscode.commands.registerCommand('vstrudel.insertSound', (node: SoundNode) => {
			const text = soundText(node);
			if (text) return insertText(text);
		}),
		vscode.commands.registerCommand('vstrudel.insertBank', (node: SoundNode) => {
			if (node.kind === 'bank') return insertText(`.bank("${node.name}")`);
		}),
		vscode.commands.registerCommand('vstrudel.enablePreview', () => setPreview(true)),
		vscode.commands.registerCommand('vstrudel.disablePreview', () => setPreview(false)),
		vscode.commands.registerCommand('vstrudel.copySoundName', (node: SoundNode) => {
			const text = soundText(node);
			if (text) return vscode.env.clipboard.writeText(text);
		}),
		vscode.commands.registerCommand('vstrudel.refreshSounds', () => Promise.all([...sessions].map((s) => s.refreshSamples()))),
		// The header of a snippet describes it. Only the code goes into the song.
		vscode.commands.registerCommand('vstrudel.insertSnippet', (snippet: Pick<Snippet, 'name'>) => {
			const found = snippets.find(snippet.name);
			if (found) return insertText(found.code);
		}),
		vscode.commands.registerCommand('vstrudel.openSnippet', (snippet: Pick<Snippet, 'name'>) => {
			const found = snippets.find(snippet.name);
			// The native editor: a snippet is edited as text, header included.
			if (found) return vscode.commands.executeCommand('vscode.openWith', found.uri, 'default');
		}),
		vscode.commands.registerCommand('vstrudel.refreshSnippets', () => snippets.refresh()),
		vscode.commands.registerCommand('vstrudel.showVersion', () => vscode.window.showInformationMessage(identity)),
	);

	watchFolders();
	void snippets.refresh();

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
			status.text = '$(debug-stop) vstrudel: stopped';
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
		status.text = `$(${icon}) vstrudel: ${where}${text}`;
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
		if (list.length && !sounds.all().length) sounds.setSounds(list);
	}

	// ---- the cache of remote samples ------------------------------------------------

	const workspaceUris = () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
	const describe = (usage: CacheUsage) =>
		`${formatBytes(usage.bytes)} in ${usage.files} files${usage.packs.length ? ` (${usage.packs.join(', ')})` : ''}`;

	async function showPackCache(): Promise<void> {
		const usage = await packs.usage(workspaceUris());
		if (!usage.files) return void vscode.window.showInformationMessage('The sample pack cache is empty.');
		const answer = await vscode.window.showInformationMessage(`Sample pack cache (.vstrudel/cache): ${describe(usage)}.`, 'Clear cache');
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
				detail: `${describe(usage)}, in .vstrudel/cache. A song that loads a pack downloads it again the next time it is opened or edited. To stop that, turn off the setting vstrudel.remoteSamples.cache.`,
			},
			'Delete',
		);
		if (answer !== 'Delete') return;
		await packs.clear(workspaceUris());
		void vscode.window.showInformationMessage(`Sample pack cache deleted: ${formatBytes(usage.bytes)}.`);
	}

	function previewSound(node: SoundNode): void {
		if (node.kind === 'group' || node.kind === 'bank') return;
		const session = activeEditorSession() ?? lastSession();
		if (!session) return void vscode.window.showInformationMessage('Open a .strudel file to hear sounds.');
		session.preview(node.sound.name, node.kind === 'variation' ? node.index : 0);
	}

	/**
	 * Inserts at the cursor of whichever editor the user is working in. The Strudel
	 * editor is a webview, so `activeTextEditor` is undefined while it is the active tab.
	 */
	async function insertText(text: string): Promise<void> {
		const strudel = activeEditorSession();
		const native = vscode.window.activeTextEditor;
		if (strudel) return strudel.insert(text);
		// Only into a Strudel file. A click in the Sounds view while a markdown file had
		// the focus typed sound names into it, and nobody saw it happen.
		if (isStrudel(native)) {
			await native.edit((builder) => native.selections.forEach((selection) => builder.replace(selection, text)));
			return;
		}
		const last = lastSession('editor');
		if (last) return last.insert(text);
		void vscode.window.showInformationMessage('Open a .strudel file to insert into.');
	}

	/** New samples and new snippets show up without a reload. */
	function watchFolders(): void {
		// The Files view lists every .strudel file of the workspace, so it follows all of
		// them. Not changes: the view shows names, and a save does not change a name.
		const songs = vscode.workspace.createFileSystemWatcher('**/*.strudel', false, true, false);
		let filesTimer: ReturnType<typeof setTimeout> | undefined;
		const filesChanged = () => {
			// A checkout or a copied folder fires one event per file.
			clearTimeout(filesTimer);
			filesTimer = setTimeout(() => void files.refresh(), 300);
		};
		context.subscriptions.push(songs, songs.onDidCreate(filesChanged), songs.onDidDelete(filesChanged));
		let watchers: vscode.Disposable[] = [];
		let samplesTimer: ReturnType<typeof setTimeout> | undefined;
		const samplesChanged = () => {
			// Copying a folder of samples fires one event per file.
			clearTimeout(samplesTimer);
			samplesTimer = setTimeout(() => sessions.forEach((s) => void s.refreshSamples()), 500);
		};
		const create = () => {
			watchers.forEach((w) => w.dispose());
			const configuration = vscode.workspace.getConfiguration('vstrudel');
			const samplesWatcher = vscode.workspace.createFileSystemWatcher(`**/${configuration.get('samplesFolder', 'samples')}/**`);
			const libWatcher = vscode.workspace.createFileSystemWatcher(`**/${SnippetsView.folderName()}/**/*.strudel`);
			watchers = [
				samplesWatcher,
				libWatcher,
				samplesWatcher.onDidCreate(samplesChanged),
				samplesWatcher.onDidDelete(samplesChanged),
				libWatcher.onDidCreate(() => snippets.refresh()),
				libWatcher.onDidDelete(() => snippets.refresh()),
				// A saved edit can change the header, which the view shows.
				libWatcher.onDidChange(() => snippets.refresh()),
			];
		};
		create();
		context.subscriptions.push(
			{ dispose: () => watchers.forEach((w) => w.dispose()) },
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('vstrudel')) return;
				create();
				samplesChanged();
				void snippets.refresh();
			}),
		);
	}

	function onlySession(): Session | undefined {
		return sessions.size === 1 ? [...sessions][0] : undefined;
	}

	function stageForActiveTextEditor(): Session | undefined {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'strudel') return undefined;
		const existing = find(editor.document.uri, 'stage');
		if (existing) return existing;
		const name = editor.document.uri.path.split('/').pop();
		const panel = vscode.window.createWebviewPanel(
			STAGE_VIEW_TYPE,
			`Stage: ${name}`,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ retainContextWhenHidden: true },
		);
		const session = new Session(context, editor.document, panel, 'stage', host);
		sessions.add(session);
		updateStatus();
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

	void files.refresh();
	// Last, when everything they use exists.
	void recallSounds();
	updateStatus();

	return {
		sessions: () =>
			[...sessions].map((s) => ({ mode: s.mode, uri: s.document.uri.toString(), started: s.started, error: s.error, logs: [...s.logs] })),
		status: () => (statusVisible ? { text: status.text, tooltip: String(status.tooltip ?? '') } : undefined),
		packCache: () => packs.usage(workspaceUris()),
		rememberedSounds: async () => {
			await remembering;
			return (await readSounds()).length;
		},
		sounds: () => sounds.all(),
		soundGroups: () => sounds.groups().map((group) => ({ label: group.label, count: group.sounds.length })),
		snippets: () => snippets.all().map((snippet) => snippet.name),
		files: () => files.all(),
		filesTopLevel: () => files.getChildren().map((node) => node.item.name),
		expandFilesFolder: async (name) => {
			const node = files.getChildren().find((child) => child.item.kind === 'folder' && child.item.name === name);
			if (node) await filesView.reveal(node, { expand: true, focus: false, select: false });
		},
		identity,
		snippetDetails: () =>
			snippets.all().map((s) => ({ name: s.name, folder: s.folder, title: s.title, category: s.category, fields: s.fields.length, codeStartsWith: s.code.slice(0, 40) })),
		expandSoundGroup: async (label) => {
			const node = sounds.group(label);
			if (node) await soundsView.reveal(node, { expand: true, focus: false, select: false });
		},
		expandSoundBank: async (name) => {
			const node = sounds.bank(name);
			if (node) await soundsView.reveal(node, { expand: true, focus: false, select: false });
		},
		soundBanks: (label = 'Drum machines') => sounds.banksOf(label),
		expandSnippet: async (name) => {
			const node = snippets.node(name);
			if (node) await snippetsView.reveal(node, { expand: true, focus: false, select: true });
		},
		setStageSlider: (index, value) => lastSession('stage')?.setSlider(index, value),
		packs: () => packs.list(),
		previewSounds: () => previewSounds,
	};
}

export function deactivate(): void {}
