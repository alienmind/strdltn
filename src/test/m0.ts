// Integration test that runs inside a real VS Code (see scripts/test-vscode.mjs).
// It drives the extension through its commands and reads what the webviews logged.
// It records facts rather than asserting them: the result file is the M0 report.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
		result.identity = api.identity;
		const folder = vscode.workspace.workspaceFolders![0].uri;
		const demo = vscode.Uri.joinPath(folder, 'demo.strudel');
		const hydra = vscode.Uri.joinPath(folder, 'examples', '04-hydra-visuals.strudel');

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
		// Asks the runner (scripts/test-vscode.mjs) for a picture of the whole window.
		const shots = process.env.VSTRUDEL_TEST_SHOTS;
		const shot = async (name: string) => {
			if (!shots) return;
			writeFileSync(join(shots, `${name}.request`), '');
			await until(() => existsSync(join(shots, `${name}.png`)), 8000);
		};
		const text = async (uri: vscode.Uri) => (await vscode.workspace.openTextDocument(uri)).getText();
		const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
		const restore = async (uri: vscode.Uri, original: string) => {
			const document = await vscode.workspace.openTextDocument(uri);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), original);
			await vscode.workspace.applyEdit(edit);
			await sleep(300);
		};
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
		steps.editorPlayed = await until(() => has('editor', demo, 'report:'), 30000);
		steps.editorReport = last('editor', demo, 'report:');
		steps.editorNeedsClick = has('editor', demo, 'click inside the webview');
		await sleep(4000);
		steps.editorStartedAfter4s = session('editor', demo)?.started;
		save();

		// 2b. The Sounds view: the engine's own list, preview and insert.
		const demoText = await text(demo);
		steps.soundsArrived = await until(() => api.sounds().length > 50, 40000);
		steps.soundGroups = api.soundGroups();
		const pick = (test: (s: { name: string; type: string; tag?: string; count: number }) => boolean) => api.sounds().find(test);
		const picks = {
			local: pick((s) => s.tag === 'local'),
			sample: pick((s) => s.name === 'bd'),
			drumMachine: pick((s) => s.tag === 'drum-machines'),
			synth: pick((s) => s.name === 'sawtooth'),
			soundfont: pick((s) => s.type === 'soundfont'),
		};
		steps.soundPicks = Object.fromEntries(Object.entries(picks).map(([key, s]) => [key, s && `${s.name} (${s.type}, ${s.count})`]));
		await vscode.commands.executeCommand('vstrudel.sounds.focus');
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
		await vscode.commands.executeCommand('notifications.clearAll');
		steps.soundBanks = api.soundBanks().length;
		steps.previewSoundsOn = api.previewSounds();
		steps.snippetDetails = api.snippetDetails().slice(0, 3);
		await api.expandSoundGroup('Synths');
		await api.expandSoundBank('RolandTR909');
		await vscode.commands.executeCommand('vstrudel.snippets.focus');
		await sleep(1200);
		api.expandSnippet('bass/acid-303');
		await sleep(1500);
		await shot('sounds-view');
		await vscode.commands.executeCommand('workbench.action.closeSidebar');
		await sleep(1200);
		await shot('editor');
		await vscode.commands.executeCommand('vstrudel.sounds.focus');
		const previews: Record<string, boolean> = {};
		for (const [key, sound] of Object.entries(picks)) {
			if (!sound) continue;
			await vscode.commands.executeCommand('vstrudel.previewSound', { kind: 'sound', sound });
			previews[key] = await until(() => has('editor', demo, `preview: ${sound.name}:0`), 15000);
			await sleep(700);
		}
		steps.previews = previews;
		if (picks.soundfont) {
			await vscode.commands.executeCommand('vstrudel.insertSound', { kind: 'sound', sound: picks.soundfont });
			steps.insertSoundInStrudelEditor = await until(() => false, 1500).then(async () => (await text(demo)).includes(picks.soundfont!.name));
			await restore(demo, demoText);
		}
		steps.soundProblems = problems('editor', demo);
		save();

		// 2c. A new folder of samples shows up without a reload.
		const zap = vscode.Uri.joinPath(folder, 'samples', 'zap-test');
		try {
			await vscode.workspace.fs.copy(vscode.Uri.joinPath(folder, 'samples', 'blip'), zap, { overwrite: true });
			steps.newSampleFolderSeen = await until(() => api.sounds().some((s) => s.name === 'zap-test'), 20000);
		} finally {
			await vscode.workspace.fs.delete(zap, { recursive: true }).then(undefined, () => undefined);
		}
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

		// 4b. The Snippets view, inserting into the native editor.
		steps.snippets = api.snippets();
		await vscode.commands.executeCommand('vstrudel.snippets.focus');
		await sleep(1000);
		await shot('snippets-view');
		const snippetBody = 's("[~ hh]*4").bank("RolandTR909").gain(.6)';
		const nativeBefore = await text(demo);
		const snippetUri = vscode.Uri.joinPath(folder, 'lib', 'drums', 'offbeat-hats.strudel');
		await vscode.commands.executeCommand('vstrudel.insertSnippet', { uri: snippetUri, name: 'drums/offbeat-hats' });
		await sleep(700);
		steps.insertSnippetInNativeEditor = count(await text(demo), snippetBody) === count(nativeBefore, snippetBody) + 1;
		await restore(demo, nativeBefore);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		// 5. Play from the native editor: a stage opens beside it.
		await vscode.commands.executeCommand('vstrudel.play');
		steps.stagePlayed = await until(() => has('stage', demo, 'report:'), 40000);
		steps.stageReport = last('stage', demo, 'report:');
		steps.stageNeedsClick = has('stage', demo, 'click inside the webview');
		await vscode.commands.executeCommand('workbench.action.closeSidebar');
		await sleep(2500);
		await shot('stage');

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

		// 7a. A song that loads a pack from GitHub: its sounds are listed before it has
		// played, and the pack is copied into the cache of the workspace.
		const coastline = vscode.Uri.joinPath(folder, 'examples', '05-coastline.strudel');
		await vscode.commands.executeCommand('vscode.openWith', coastline, EDITOR);
		steps.packListedBeforePlay = await until(() => api.sounds().some((s) => s.tag === 'github:eddyflux/crate'), 40000);
		steps.packGroup = api.soundGroups().find((group) => group.label.startsWith('github:'));
		steps.packBanks = api.soundBanks('github:eddyflux/crate');
		steps.packCached = await until(() => api.packs().some((pack) => pack.source === 'github:eddyflux/crate' && pack.complete), 180000);
		steps.packs = api.packs();
		steps.packServedFromCache = await until(() => has('editor', coastline, 'github:eddyflux/crate (cached): registered'), 20000);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		save();

		// 7b. Every snippet and example of the template plays. This is what catches a
		// function or a sound name that the pinned Strudel version does not have.
		const files = (await vscode.workspace.findFiles('{lib,examples}/**/*.strudel')).sort((a, b) => a.path.localeCompare(b.path));
		const fileProblems: Record<string, string[]> = {};
		let filesChecked = 0;
		for (const file of files) {
			if (file.path.includes('hydra')) continue;
			filesChecked++;
			await vscode.commands.executeCommand('vscode.openWith', file, EDITOR);
			await until(() => has('editor', file, 'local samples'), 30000);
			await vscode.commands.executeCommand('vstrudel.play');
			const played = await until(() => has('editor', file, 'report:'), 30000);
			await sleep(3000);
			const logs = session('editor', file)?.logs ?? [];
			// Not problems: the capability probes (they report a refusal as text), and
			// upstream's message for a kick that ducks an orbit before anything played on it.
			const bad = logs.filter(
				(line) => /error|not found/i.test(line) && !/click inside|\] info: (midi|webgpu|audio outputs): |duck target orbit/.test(line),
			);
			if (!played) bad.unshift('did not play');
			else if (!last('editor', file, 'report:')?.includes('started=true')) bad.unshift('did not start');
			if (bad.length) fileProblems[vscode.workspace.asRelativePath(file)] = [...new Set(bad)].slice(0, 5);
			await vscode.commands.executeCommand('vstrudel.stop');
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			save();
		}
		steps.filesChecked = filesChecked;
		steps.fileProblems = fileProblems;
		save();

		// 8. Hydra: loaded from unpkg.com at run time, needs WebGL.
		await vscode.commands.executeCommand('vscode.openWith', hydra, EDITOR);
		steps.hydraLoaded = await until(() => has('editor', hydra, 'local samples'), 30000);
		await vscode.commands.executeCommand('vstrudel.play');
		steps.hydraPlayed = await until(() => has('editor', hydra, 'report:'), 40000);
		await sleep(3000);
		steps.hydraReport = last('editor', hydra, 'report:');
		steps.hydraProblems = problems('editor', hydra);
		await vscode.commands.executeCommand('workbench.action.closeSidebar');
		await sleep(1500);
		await shot('hydra');
		await vscode.commands.executeCommand('vstrudel.stop');
		result.finished = true;
		result.logs = api.sessions().map((s) => ({ mode: s.mode, uri: s.uri.split('/').pop(), logs: s.logs }));
	} catch (error) {
		result.error = String((error as Error)?.stack ?? error);
	}
	save();
	// Revert rather than save: the test must not write to the template.
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
}
