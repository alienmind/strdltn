import * as vscode from 'vscode';
import type { SoundInfo } from '../shared/protocol';
import { Session } from './session';
import { SnippetsProvider, snippetText, type Snippet } from './snippets';
import { SoundsProvider, soundText, type SoundNode } from './sounds';

const EDITOR_VIEW_TYPE = 'vstrudel.editor';
const STAGE_VIEW_TYPE = 'vstrudel.stage';

/** What `activate` returns. Only the integration test in `src/test/` uses it. */
export interface VstrudelApi {
	sessions(): { mode: string; uri: string; started: boolean; logs: string[] }[];
	sounds(): SoundInfo[];
	soundGroups(): { label: string; count: number }[];
	snippets(): string[];
}

export function activate(context: vscode.ExtensionContext): VstrudelApi {
	const output = vscode.window.createOutputChannel('vstrudel');
	const sessions = new Set<Session>();
	const sounds = new SoundsProvider();
	const snippets = new SnippetsProvider();
	const sessionEvents = {
		onDispose: (session: Session) => void sessions.delete(session),
		// Every engine loads the same packs, so the list of the engine that spoke last is the list.
		onSounds: (list: SoundInfo[]) => sounds.setSounds(list),
	};

	const find = (uri: vscode.Uri, mode: Session['mode']) =>
		[...sessions].find((s) => s.mode === mode && s.document.uri.toString() === uri.toString());
	const activeEditorSession = () => [...sessions].find((s) => s.mode === 'editor' && s.panel.active);
	/** The session the user was in last. Focus is in a side bar view when this is asked. */
	const lastSession = (mode?: Session['mode']) =>
		[...sessions].filter((s) => !mode || s.mode === mode).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];

	context.subscriptions.push(
		output,
		vscode.window.registerCustomEditorProvider(
			EDITOR_VIEW_TYPE,
			{
				resolveCustomTextEditor(document, panel) {
					// The Strudel editor replaces the stage of the same file. Two engines on
					// one file would play the pattern twice.
					find(document.uri, 'stage')?.panel.dispose();
					sessions.add(new Session(context, document, panel, 'editor', output, sessionEvents));
				},
			},
			// Without retainContextWhenHidden the webview is destroyed when its tab is
			// hidden, and the sound stops with it.
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
		),
		vscode.window.createTreeView('vstrudel.sounds', { treeDataProvider: sounds, showCollapseAll: true }),
		vscode.window.createTreeView('vstrudel.snippets', { treeDataProvider: snippets }),

		vscode.commands.registerCommand('vstrudel.play', () => {
			const session = activeEditorSession() ?? stageForActiveTextEditor() ?? onlySession();
			session?.play();
		}),
		vscode.commands.registerCommand('vstrudel.stop', () => sessions.forEach((s) => s.stop())),
		vscode.commands.registerCommand('vstrudel.openStage', () => stageForActiveTextEditor()),
		vscode.commands.registerCommand('vstrudel.toggleMode', toggleMode),

		vscode.commands.registerCommand('vstrudel.previewSound', (node: SoundNode) => {
			if (node.kind === 'group') return;
			const session = activeEditorSession() ?? lastSession();
			if (!session) return void vscode.window.showInformationMessage('Open a .strudel file to hear sounds.');
			session.preview(node.sound.name, node.kind === 'variation' ? node.index : 0);
		}),
		vscode.commands.registerCommand('vstrudel.insertSound', (node: SoundNode) => {
			const text = soundText(node);
			if (text) return insertText(text);
		}),
		vscode.commands.registerCommand('vstrudel.copySoundName', (node: SoundNode) => {
			const text = soundText(node);
			if (text) return vscode.env.clipboard.writeText(text);
		}),
		vscode.commands.registerCommand('vstrudel.refreshSounds', () => Promise.all([...sessions].map((s) => s.refreshSamples()))),
		vscode.commands.registerCommand('vstrudel.insertSnippet', async (snippet: Snippet) => insertText(await snippetText(snippet))),
		vscode.commands.registerCommand('vstrudel.openSnippet', (snippet: Snippet) =>
			vscode.commands.executeCommand('vscode.openWith', snippet.uri, 'default'),
		),
		vscode.commands.registerCommand('vstrudel.refreshSnippets', () => snippets.refresh()),
	);

	watchFolders();
	void snippets.refresh();

	/**
	 * Inserts at the cursor of whichever editor the user is working in. The Strudel
	 * editor is a webview, so `activeTextEditor` is undefined while it is the active tab.
	 */
	async function insertText(text: string): Promise<void> {
		const strudel = activeEditorSession();
		const native = vscode.window.activeTextEditor;
		if (strudel) return strudel.insert(text);
		if (native) {
			await native.edit((builder) => native.selections.forEach((selection) => builder.replace(selection, text)));
			return;
		}
		const last = lastSession('editor');
		if (last) return last.insert(text);
		void vscode.window.showInformationMessage('Open a file to insert into.');
	}

	/** New samples and new snippets show up without a reload. */
	function watchFolders(): void {
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
			const libWatcher = vscode.workspace.createFileSystemWatcher(`**/${SnippetsProvider.folderName()}/**/*.strudel`);
			watchers = [
				samplesWatcher,
				libWatcher,
				samplesWatcher.onDidCreate(samplesChanged),
				samplesWatcher.onDidDelete(samplesChanged),
				libWatcher.onDidCreate(() => snippets.refresh()),
				libWatcher.onDidDelete(() => snippets.refresh()),
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
		const session = new Session(context, editor.document, panel, 'stage', output, sessionEvents);
		sessions.add(session);
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

	return {
		sessions: () =>
			[...sessions].map((s) => ({ mode: s.mode, uri: s.document.uri.toString(), started: s.started, logs: [...s.logs] })),
		sounds: () => sounds.all(),
		soundGroups: () => sounds.groups().map((group) => ({ label: group.label, count: group.sounds.length })),
		snippets: () => snippets.all().map((snippet) => snippet.name),
	};
}

export function deactivate(): void {}
