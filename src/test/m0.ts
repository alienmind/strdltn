// Integration test that runs inside a real VS Code (see scripts/test-vscode.mjs).
// It drives the extension through its commands and reads what the webviews logged.
// It records facts rather than asserting them: the result file is the M0 report.
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { VstrudelApi } from '../extension/extension';

const EDITOR = 'vstrudel.editor';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(): Promise<void> {
	const out = process.env.VSTRUDEL_TEST_OUT;
	const result: Record<string, unknown> = { vscode: vscode.version, steps: {} };
	const steps = result.steps as Record<string, unknown>;
	const save = () => out && writeFileSync(out, JSON.stringify(result, null, 2));
	try {
		const extension = vscode.extensions.getExtension<VstrudelApi>('vstrudel.vstrudel')!;
		const api = await extension.activate();
		const folder = vscode.workspace.workspaceFolders![0].uri;
		const demo = vscode.Uri.joinPath(folder, 'demo.strudel');
		const hydra = vscode.Uri.joinPath(folder, 'hydra.strudel');

		const session = (mode: string, uri: vscode.Uri) => api.sessions().find((s) => s.mode === mode && s.uri === uri.toString());
		const until = async (test: () => boolean, ms: number) => {
			const end = Date.now() + ms;
			while (Date.now() < end) {
				if (test()) return true;
				await sleep(200);
			}
			return false;
		};
		const has = (mode: string, uri: vscode.Uri, text: string) => !!session(mode, uri)?.logs.some((line) => line.includes(text));
		const last = (mode: string, uri: vscode.Uri, text: string) =>
			session(mode, uri)
				?.logs.filter((line) => line.includes(text))
				.at(-1);
		const problems = (mode: string, uri: vscode.Uri) =>
			session(mode, uri)?.logs.filter((line) => /\] (error|warn): /.test(line)) ?? [];
		const tabs = (uri: vscode.Uri) =>
			vscode.window.tabGroups.all.flatMap((group) =>
				group.tabs
					.filter((tab) => (tab.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString())
					.map((tab) => (tab.input instanceof vscode.TabInputCustom ? 'custom' : tab.input instanceof vscode.TabInputText ? 'text' : 'other')),
			);

		// 1. The Strudel editor opens and loads the document and the local samples.
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		steps.editorLoaded = await until(() => has('editor', demo, 'local samples'), 30000);
		steps.environment = session('editor', demo)?.logs.slice(0, 5);
		save();

		// 2. Play from a command, with no click inside the webview.
		await vscode.commands.executeCommand('vstrudel.play');
		steps.editorPlayOutcome = (await until(() => has('editor', demo, 'report:') || has('editor', demo, 'click inside the webview'), 20000))
			? 'answered'
			: 'timeout';
		steps.editorReport = last('editor', demo, 'report:');
		steps.editorNeedsClick = has('editor', demo, 'click inside the webview');
		await sleep(4000);
		steps.editorStartedAfter4s = session('editor', demo)?.started;
		save();

		// 3. Hide the editor tab for a while. The engine should survive.
		const other = await vscode.workspace.openTextDocument({ content: 'hidden tab test', language: 'plaintext' });
		await vscode.window.showTextDocument(other);
		await sleep(6000);
		steps.editorStartedWhileHidden = session('editor', demo)?.started;
		steps.editorSessionAliveWhileHidden = !!session('editor', demo);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.commands.executeCommand('vstrudel.stop');
		await sleep(500);
		steps.editorStartedAfterStop = session('editor', demo)?.started;
		steps.editorProblems = problems('editor', demo);
		save();

		// 4. Switch to the native editor.
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		await sleep(500);
		let before = Date.now();
		await vscode.commands.executeCommand('vstrudel.toggleMode');
		steps.toggleToNativeMs = Date.now() - before;
		await sleep(500);
		steps.tabsAfterToggleToNative = tabs(demo);
		steps.activeTextEditorIsDemo = vscode.window.activeTextEditor?.document.uri.toString() === demo.toString();
		steps.editorSessionGoneAfterToggle = !session('editor', demo);

		// 5. Play from the native editor: a stage opens beside it.
		await vscode.commands.executeCommand('vstrudel.play');
		steps.stagePlayOutcome = (await until(() => has('stage', demo, 'report:') || has('stage', demo, 'click inside the webview'), 30000))
			? 'answered'
			: 'timeout';
		steps.stageReport = last('stage', demo, 'report:');
		steps.stageNeedsClick = has('stage', demo, 'click inside the webview');

		// 6. An edit to the document reaches the stage.
		const document = await vscode.workspace.openTextDocument(demo);
		const marker = '// integration test edit\n';
		const insert = new vscode.WorkspaceEdit();
		insert.insert(demo, new vscode.Position(0, 0), marker);
		await vscode.workspace.applyEdit(insert);
		await sleep(500);
		await vscode.commands.executeCommand('vstrudel.play');
		await sleep(3000);
		steps.documentLength = document.getText().length;
		steps.stageReportAfterEdit = last('stage', demo, 'report:');
		steps.stageProblems = problems('stage', demo);
		await vscode.commands.executeCommand('vstrudel.stop');
		save();

		// 7. Switch back. The stage closes and the Strudel editor has the edit.
		await vscode.window.showTextDocument(document);
		before = Date.now();
		await vscode.commands.executeCommand('vstrudel.toggleMode');
		steps.toggleToStrudelMs = Date.now() - before;
		steps.editorReloaded = await until(() => has('editor', demo, 'local samples'), 30000);
		steps.tabsAfterToggleToStrudel = tabs(demo);
		steps.stageGoneAfterToggle = !session('stage', demo);
		await vscode.commands.executeCommand('vstrudel.play');
		await until(() => has('editor', demo, 'report:'), 15000);
		steps.editorReportAfterToggle = last('editor', demo, 'report:');
		await vscode.commands.executeCommand('vstrudel.stop');

		// Leave the file as it was.
		const remove = new vscode.WorkspaceEdit();
		remove.delete(demo, new vscode.Range(0, 0, 1, 0));
		await vscode.workspace.applyEdit(remove);
		await sleep(500);
		steps.documentRestored = !document.getText().includes(marker.trim());
		steps.documentDirty = document.isDirty;
		save();

		// 8. Hydra: loaded from unpkg.com at run time, needs WebGL.
		await vscode.commands.executeCommand('vscode.openWith', hydra, EDITOR);
		steps.hydraLoaded = await until(() => has('editor', hydra, 'local samples'), 30000);
		await vscode.commands.executeCommand('vstrudel.play');
		await until(() => has('editor', hydra, 'report:') || has('editor', hydra, 'click inside the webview'), 30000);
		await sleep(3000);
		steps.hydraReport = last('editor', hydra, 'report:');
		steps.hydraProblems = problems('editor', hydra);
		await vscode.commands.executeCommand('vstrudel.stop');
		result.finished = true;
	} catch (error) {
		result.error = String((error as Error)?.stack ?? error);
	}
	save();
	// Revert rather than save: the test must not write to the template.
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
}
