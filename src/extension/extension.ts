import * as vscode from 'vscode';
import { Session } from './session';

const EDITOR_VIEW_TYPE = 'vstrudel.editor';
const STAGE_VIEW_TYPE = 'vstrudel.stage';

/** What `activate` returns. Only the integration test in `src/test/` uses it. */
export interface VstrudelApi {
	sessions(): { mode: string; uri: string; started: boolean; logs: string[] }[];
}

export function activate(context: vscode.ExtensionContext): VstrudelApi {
	const output = vscode.window.createOutputChannel('vstrudel');
	const sessions = new Set<Session>();
	const forget = (session: Session) => sessions.delete(session);

	const find = (uri: vscode.Uri, mode: Session['mode']) =>
		[...sessions].find((s) => s.mode === mode && s.document.uri.toString() === uri.toString());
	const activeEditorSession = () => [...sessions].find((s) => s.mode === 'editor' && s.panel.active);

	context.subscriptions.push(
		output,
		vscode.window.registerCustomEditorProvider(
			EDITOR_VIEW_TYPE,
			{
				resolveCustomTextEditor(document, panel) {
					// The Strudel editor replaces the stage of the same file. Two engines on
					// one file would play the pattern twice.
					find(document.uri, 'stage')?.panel.dispose();
					sessions.add(new Session(context, document, panel, 'editor', output, forget));
				},
			},
			// Without retainContextWhenHidden the webview is destroyed when its tab is
			// hidden, and the sound stops with it.
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
		),

		vscode.commands.registerCommand('vstrudel.play', () => {
			const session = activeEditorSession() ?? stageForActiveTextEditor() ?? onlySession();
			session?.play();
		}),
		vscode.commands.registerCommand('vstrudel.stop', () => sessions.forEach((s) => s.stop())),
		vscode.commands.registerCommand('vstrudel.openStage', () => stageForActiveTextEditor()),
		vscode.commands.registerCommand('vstrudel.toggleMode', toggleMode),
	);

	const api: VstrudelApi = {
		sessions: () =>
			[...sessions].map((s) => ({ mode: s.mode, uri: s.document.uri.toString(), started: s.started, logs: [...s.logs] })),
	};

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
		const session = new Session(context, editor.document, panel, 'stage', output, forget);
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
		// openWith is expected to swap the tab in place. If a build leaves the old tab
		// open, close it so the file is never shown twice.
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

	return api;
}

export function deactivate(): void {}
