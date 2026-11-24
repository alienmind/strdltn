// Integration test that runs inside a real VS Code (see scripts/test-vscode.mjs).
// It drives the extension through its commands and reads what the webviews logged.
// It records facts rather than asserting them: the result file is the M0 report.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { StrdltnApi } from '../extension/extension';
import { diffText } from '../shared/protocol';

const EDITOR = 'strdltn.editor';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(): Promise<void> {
	const out = process.env.VSTRUDEL_TEST_OUT;
	const result: Record<string, unknown> = { vscode: vscode.version, steps: {} };
	const steps = result.steps as Record<string, unknown>;
	const save = () => out && writeFileSync(out, JSON.stringify(result, null, 2));
	try {
		const extension = vscode.extensions.getExtension<StrdltnApi>('strdltn.strdltn')!;
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
		/**
		 * Real clicks and keys, sent by the runner through the DevTools protocol (see
		 * "real input" in scripts/test-vscode.mjs). Resolves to what the editor holds after.
		 */
		let inputCount = 0;
		const input = async (match: string, actions: unknown[]): Promise<{ log?: { click: number; head?: number; focused?: boolean; error?: string }[]; text?: string; head?: number; error?: string }> => {
			if (!shots) return { error: 'no runner' };
			const name = `input-${++inputCount}`;
			writeFileSync(join(shots, `${name}.input`), JSON.stringify({ match, actions }));
			const done = join(shots, `${name}.done`);
			if (!(await until(() => existsSync(done), 60000))) return { error: 'the runner did not answer' };
			await sleep(100);
			return JSON.parse(readFileSync(done, 'utf8'));
		};

		/**
		 * One case: real input, then the facts. `expect` gets the text before and gives the
		 * text that should result. `during` runs on the host while the keys are typed.
		 */
		/** Text with every line ending as `\n`, as the Strudel editor holds it. Offsets of a click are in it. */
		const lf = (value: string) => value.replace(/\r\n/g, '\n');
		const textLf = async (uri: vscode.Uri) => lf(await text(uri));
		const typingCase = async (uri: vscode.Uri, actions: unknown[], expect: (before: string) => string, during?: () => Promise<void>) => {
			const before = await textLf(uri);
			const eol = (await text(uri)).includes('\r\n');
			const running = input('written by the integration test', actions);
			if (during) {
				// Starts once the first typed key has reached the document.
				await until(() => vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && lf(d.getText()) !== before), 20000);
				await during();
			}
			const done = await running;
			// The last edit travels from the editor to the host after the runner has read it.
			await sleep(800);
			const after = await textLf(uri);
			// The editor read again now, when everything in flight has arrived.
			const editor = (await input('written by the integration test', [])).text;
			const wanted = expect(before);
			const clicks = (done.log ?? []).map((c) => ({ ...c, landed: c.head === c.click }));
			const difference = (a: string, b: string) => {
				const change = diffText(a, b);
				return change && { at: change.from, expected: a.slice(change.from, change.to).slice(0, 60), got: change.insert.slice(0, 60) };
			};
			return {
				clicks,
				documentAsExpected: after === wanted,
				editorSameAsDocument: editor === after,
				lineEndingsKept: (await text(uri)).includes('\r\n') === eol,
				...(after !== wanted ? { documentDiff: difference(wanted, after) } : {}),
				...(editor !== undefined && editor !== after ? { editorDiff: difference(after, editor) } : {}),
				...(done.error ? { error: done.error } : {}),
			};
		};

		/** The cases on a song with `eol` as its line ending. A file checked out on Windows can have `\r\n`. */
		async function typingCases(eol: '\n' | '\r\n'): Promise<Record<string, unknown>> {
			const song = [
				'// typing test, written by the integration test and deleted after it',
				'const VOL = slider(0.5, 0, 1)',
				'$drums: s("bd sd [~ bd] sd").gain(VOL)',
				'  .room(.2)._scope()',
				'$hats: s("hh*8").gain(.4)',
				'',
			].join('\n');
			const uri = vscode.Uri.joinPath(folder, eol === '\n' ? 'zz-typing-test.strudel' : 'zz-typing-test-crlf.strudel');
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(song.replace(/\n/g, eol)));
			const cases: Record<string, unknown> = {};
			try {
				await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR);
				await until(() => has('editor', uri, 'local samples'), 30000);
				await vscode.commands.executeCommand('strdltn.play');
				await until(() => has('editor', uri, 'report:'), 30000);
				await sleep(1000);
				const at = (needle: string, after = 0) => song.indexOf(needle) + after;
				const insertAt = (offset: number, what: string) => (before: string) => before.slice(0, offset) + what + before.slice(offset);

				// Into a string, while the mini-notation there is highlighted on every beat.
				const sd = at('sd [');
				cases.clickIntoString = await typingCase(uri, [{ click: sd }, { type: 'hh ' }], insertAt(sd, 'hh '));
				// At the end of a line, right after an inline scope (a widget the editor draws there).
				const scopeEnd = (await textLf(uri)).indexOf('._scope()') + '._scope()'.length;
				cases.afterInlineScope = await typingCase(uri, [{ click: scopeEnd }, { type: '.lpf(800)' }], insertAt(scopeEnd, '.lpf(800)'));
				// Fast, as a person types: no pause between keys.
				const end = (await textLf(uri)).length;
				const fast = '$extra: s("cp*2").gain(.3) // fast typing check 0123456789';
				cases.fastTyping = await typingCase(uri, [{ click: end }, { type: fast }], insertAt(end, fast));
				// Typing while the host changes the file somewhere else: an agent, a save that
				// trims spaces, an insert from the Browser into the native editor.
				const firstLineEnd = (await textLf(uri)).indexOf('\n');
				const typed = ' and more words typed slowly here';
				const fromHost = '// a line from the host\n';
				// VS Code may refuse the edit while the document moves under it (`applyEdit` gives
				// false, seen once in 8 runs on 2026-11-21); then only the typed text is expected.
				let hostEditTaken = false;
				cases.typingWhileTheHostEdits = await typingCase(
					uri,
					[{ click: firstLineEnd }, { type: typed, delay: 30 }],
					(before) => (hostEditTaken ? fromHost : '') + insertAt(firstLineEnd, typed)(before),
					async () => {
						const edit = new vscode.WorkspaceEdit();
						edit.insert(uri, new vscode.Position(0, 0), fromHost);
						hostEditTaken = await vscode.workspace.applyEdit(edit);
					},
				);
				(cases.typingWhileTheHostEdits as Record<string, unknown>).hostEditTaken = hostEditTaken;
				// Typing while a fader of the Mixer writes its number.
				const hats = (await textLf(uri)).indexOf('$hats');
				cases.typingWhileAFaderMoves = await typingCase(
					uri,
					[{ click: hats }, { type: '// ', delay: 60 }],
					(before) => insertAt(hats, '// ')(before).replace('slider(0.5,', 'slider(0.75,'),
					async () => api.mixerSlider(0, '0.75'),
				);
				// Harder: ten host edits 20 ms apart while keys come with no pause.
				const lastLine = (await textLf(uri)).lastIndexOf('\n');
				const burst = 'abcdefghijklmnopqrstuvwxyz0123456789';
				// VS Code refuses an edit made for a version of the document that has moved on
				// (`applyEdit` gives false), so only the edits it took are expected.
				let hostEditsTaken = 0;
				cases.typingWhileTheHostEditsOften = await typingCase(
					uri,
					[{ click: lastLine }, { type: burst }],
					(before) => '// host\n'.repeat(hostEditsTaken) + insertAt(lastLine, burst)(before),
					async () => {
						for (let i = 0; i < 10; i++) {
							const edit = new vscode.WorkspaceEdit();
							edit.insert(uri, new vscode.Position(0, 0), '// host\n');
							if (await vscode.workspace.applyEdit(edit)) hostEditsTaken++;
							await sleep(20);
						}
					},
				);
				(cases.typingWhileTheHostEditsOften as Record<string, unknown>).hostEditsTaken = hostEditsTaken;
				// Undo takes back what was typed.
				const vol = (await textLf(uri)).indexOf('VOL =');
				cases.undo = await typingCase(uri, [{ click: vol }, { type: 'zz' }, { wait: 300 }, { key: 'z', ctrl: true }], (before) => before);
				// Clicks in demo.strudel while it plays with its full page visuals (Hydra, scopes,
				// the piano roll), the closest to how the maintainer works. Nothing is typed: only
				// where the cursor goes.
				if (eol !== '\n') return cases;
				const demoNow = await text(demo);
				await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
				await vscode.commands.executeCommand('strdltn.play');
				await sleep(3000);
				const spots = ['$kick:', 'bank("tr909")', '.gain(BASS_VOL)', 'lpenv(part(ACID_ENERGY))', '$riser:', '.kaleid('].map((needle) => demoNow.indexOf(needle) + 2);
				const clicks = await input('@title Sea of Souls', spots.map((click) => ({ click })));
				cases.clicksInPlayingDemo = {
					landed: (clicks.log ?? []).map((c) => `${c.click}->${c.head}${c.head === c.click ? '' : ' MISSED'}${c.focused ? '' : ' unfocused'} ${JSON.stringify(c).slice(0, 300)}`),
					untouched: (await text(demo)) === demoNow,
					error: clicks.error,
				};
			} finally {
				await vscode.commands.executeCommand('strdltn.stop');
				// Saved first: closing a changed file asks "Save?" in a dialog nobody answers.
				await (await vscode.workspace.openTextDocument(uri)).save();
				const open = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => (tab.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString());
				await vscode.window.tabGroups.close(open, true);
				await vscode.workspace.fs.delete(uri);
			}
			return cases;
		}

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
		await vscode.commands.executeCommand('strdltn.play');
		steps.editorPlayed = await until(() => has('editor', demo, 'report:'), 30000);
		steps.editorReport = last('editor', demo, 'report:');
		steps.editorNeedsClick = has('editor', demo, 'click inside the webview');
		await sleep(4000);
		steps.editorStartedAfter4s = session('editor', demo)?.started;
		steps.statusPlaying = api.status()?.text;
		save();

		// 2a. An error in the code: a problem of the file, and the status bar says so.
		// The old pattern keeps playing, as on strudel.cc.
		const clean = await text(demo);
		const problemList = () =>
			vscode.languages.getDiagnostics(demo).map((d) => `${d.range.start.line}:${d.range.start.character}-${d.range.end.character} ${d.source}: ${d.message}`);
		const breakWith = async (line: string) => {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(demo, new vscode.Position(0, 0), `${line}\n`);
			await vscode.workspace.applyEdit(edit);
			await sleep(500);
			await vscode.commands.executeCommand('strdltn.play');
			await until(() => vscode.languages.getDiagnostics(demo).length > 0, 10000);
			const seen = problemList();
			const status = api.status();
			await restore(demo, clean);
			return { seen, status, goneAfterEdit: vscode.languages.getDiagnostics(demo).length === 0 };
		};
		steps.errorUnknownFunction = await breakWith('$: s("bd").lfpx(200)');
		steps.errorSyntax = await breakWith('$: s("bd"))');
		steps.errorMini = await breakWith('$: s("bd [sd")');
		await vscode.commands.executeCommand('strdltn.play');
		steps.errorGoneAfterGoodPlay = await until(() => session('editor', demo)?.error === undefined, 10000);
		steps.statusAfterFix = api.status()?.text;
		save();

		// 2a2. Theme and font size from the settings, without a reload.
		const configuration = vscode.workspace.getConfiguration('strdltn');
		const settingsLine = () => last('editor', demo, 'settings:') ?? '';
		steps.settingsAtStart = settingsLine();
		await configuration.update('editor.theme', 'githubLight', vscode.ConfigurationTarget.Global);
		await configuration.update('editor.fontSize', 22, vscode.ConfigurationTarget.Global);
		steps.settingsApplied = await until(() => settingsLine().includes('theme=githubLight') && settingsLine().includes('size=22'), 5000);
		steps.settingsAfter = settingsLine();
		await sleep(1000);
		await shot('theme');
		await configuration.update('editor.theme', undefined, vscode.ConfigurationTarget.Global);
		await configuration.update('editor.fontSize', undefined, vscode.ConfigurationTarget.Global);
		steps.settingsBack = await until(() => settingsLine() === steps.settingsAtStart, 5000);
		save();

		// 2a3. The Mixer: the model of demo.strudel, every strip folded, then bass unfolded.
		const mixer = api.mixer();
		const sliderName = (i?: number) => (i === undefined ? undefined : mixer.model?.sliders[i].label);
		steps.mixerSong = mixer.song;
		steps.mixerModel = mixer.model && {
			chains: mixer.model.chains.map((c) => `${c.name} gain=${sliderName(c.gain)} controls=${c.controls.map(sliderName).join('+')} orbit=${c.orbit}`),
			ducks: mixer.model.ducks.map((d) => `${mixer.model!.chains[d.from].name}->${d.to === undefined ? 'empty' : mixer.model!.chains[d.to].name}@${d.orbit}`),
			global: mixer.model.global.length,
		};
		steps.mixerFolded = await api.mixerShow([]);
		await sleep(800);
		await shot('mixer');
		steps.mixerBass = await api.mixerShow(['bass']);
		await sleep(800);
		await shot('mixer-bass');
		// Spike W1: the Mixer moves to an editor tab, into a window of its own and back.
		// Each move should give a new page that unfolds bass again, from the host's memory.
		const mixerMove = async (where: 'tab' | 'float' | 'dock') => {
			const before = api.mixer().pages;
			const place = await api.mixerPlace(where);
			const newPage = await until(() => api.mixer().pages > before, 8000);
			await sleep(1500);
			const state = api.mixer().state;
			return { ...place, newPage, strips: state?.strips.length, unfolded: state?.strips.filter((s) => s.unfolded).map((s) => s.name) };
		};
		steps.mixerTab = await mixerMove('tab');
		await shot('mixer-tab');
		steps.mixerFloat = await mixerMove('float');
		steps.mixerDock = await mixerMove('dock');
		await shot('mixer-docked');
		save();

		// 2a3b. M, S and G of the Mixer, on a scratch song, so demo.strudel stays as it is.
		{
			const uri = vscode.Uri.joinPath(folder, 'zz-mixer-test.strudel');
			const song = '// mixer test, written by the integration test and deleted after it\n$kick: s("bd*4").gain(slider(0.7, 0, 1))\n$riser: s("pulse").orbit(4)\n';
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(song));
			const results: Record<string, unknown> = {};
			try {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
				await until(() => api.mixer().song?.endsWith('zz-mixer-test.strudel') === true && api.mixer().model?.chains.length === 2, 5000);
				const click = async (name: string, chain: number, button: 'mute' | 'solo' | 'gain' | 'scope') => {
					await api.mixerToggle(chain, button);
					await sleep(600);
					results[name] = (await textLf(uri)).split('\n').slice(1, 3);
				};
				await click('muteKick', 0, 'mute');
				await click('soloKick', 0, 'solo');
				await click('unmuteKick', 0, 'mute');
				await click('gainOnRiser', 1, 'gain');
				await click('gainOffRiser', 1, 'gain');
				await click('unsoloKick', 0, 'solo');
				await click('scopeOnRiser', 1, 'scope');
				await click('scopeOffRiser', 1, 'scope');
				results.model = api.mixer().model?.chains.map((c) => `${c.label} muted=${c.muted} solo=${c.solo} gain=${c.gain !== undefined}`);
				// The BPM box: typed, then a double click back to Strudel's default.
				await api.mixerTempo(128);
				await sleep(600);
				results.tempo128 = { line: (await textLf(uri)).split('\n')[1], bpm: api.mixer().model?.tempo?.bpm };
				await api.mixerTempo(undefined);
				await sleep(600);
				// Cables, as a drop sends them: kick onto riser (orbit 4, its own), then pulled off.
				const cable = async (name: string, drop: { to: number; move?: number } | { orbit: number }) => {
					await api.mixerCable(0, drop);
					await sleep(600);
					results[name] = { lines: (await textLf(uri)).split('\n').slice(1, 3), ducks: api.mixer().model?.ducks.map((d) => `${d.from}>${d.to}@${d.orbit}`) };
				};
				await cable('duckRiser', { to: 1 });
				await cable('pullOff', { orbit: 4 });
				results.tempoDefault = { lines: (await textLf(uri)).split('\n').length, tempo: api.mixer().model?.tempo ?? 'none' };
				await api.mixerShow([]);
				await shot('mixer-buttons');
			} finally {
				await (await vscode.workspace.openTextDocument(uri)).save();
				const open = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => (tab.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString());
				await vscode.window.tabGroups.close(open, true);
				await vscode.workspace.fs.delete(uri);
			}
			steps.mixerButtons = results;
			save();
		}

		// 2a4. Clicking and typing in the Strudel editor with real input, while a song plays.
		// Each case says where the click put the cursor, whether the document is the text
		// we expected, and whether the editor holds the same text as the document. The
		// maintainer saw text corrupted and clicks that did not move the cursor.
		steps.typing = await typingCases('\n');
		steps.typingCrlf = await typingCases('\r\n');
		save();

		// 2b. The Browser: the engine's own list, preview and insert.
		const demoText = await text(demo);
		steps.soundsArrived = await until(() => api.sounds().length > 50, 40000);
		steps.browserCounts = api.browserCounts();
		// The list is written to a file 2 seconds after it settles, for the next start.
		await sleep(2500);
		steps.rememberedSounds = await api.rememberedSounds();
		const pick = (test: (s: { name: string; type: string; tag?: string; count: number }) => boolean) => api.sounds().find(test);
		const picks = {
			local: pick((s) => s.tag === 'local'),
			sample: pick((s) => s.name === 'bd'),
			drumMachine: pick((s) => s.tag === 'drum-machines'),
			synth: pick((s) => s.name === 'sawtooth'),
			soundfont: pick((s) => s.type === 'soundfont'),
		};
		steps.soundPicks = Object.fromEntries(Object.entries(picks).map(([key, s]) => [key, s && `${s.name} (${s.type}, ${s.count})`]));
		await vscode.commands.executeCommand('strdltn.browser.focus');
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
		await vscode.commands.executeCommand('notifications.clearAll');
		steps.drumBanks = api.browserGroups('drums').length;
		steps.previewSoundsOn = api.previewSounds();
		steps.snippetDetails = api.snippetDetails().slice(0, 3);
		// The songs: every folder with .strudel files, and nothing else.
		steps.files = api.files().length;
		steps.songFolders = api.browserGroups('songs');
		steps.filesByFolder = Object.fromEntries(
			[...new Set(api.files().map((path) => path.split('/').slice(0, -1).join('/') || '.'))].map((folder) => [
				folder,
				api.files().filter((path) => (path.split('/').slice(0, -1).join('/') || '.') === folder).length,
			]),
		);
		// What the Browser shows for a few filters, as the webview reports it, and the same
		// filters worked out in the host.
		const everything = { query: '', chips: [], color: undefined, place: undefined, scope: undefined };
		steps.browserAll = await api.browserShow({ ...everything, category: 'all' });
		await sleep(800);
		await shot('browser');
		steps.browserSongs = await api.browserShow({ ...everything, category: 'songs' }, ['examples']);
		await sleep(800);
		await shot('files-view');
		const tr909 = api.browserGroups('drums').find((bank) => /^rolandtr909$/i.test(bank));
		steps.browserDrums = await api.browserShow({ ...everything, category: 'drums' }, tr909 ? [tr909] : []);
		await sleep(800);
		await shot('sounds-view');
		steps.browserSearch = await api.browserShow({ ...everything, category: 'all', query: '909 bd' });
		steps.browserSearchHost = api.browserFind({ category: 'all', query: '909 bd' }).slice(0, 5);
		steps.browserChips = await api.browserShow({ ...everything, category: 'drums', chips: ['Drums/Kick', 'Maker/Roland'] });
		await sleep(800);
		await shot('browser-chips');
		steps.browserFunctions = await api.browserShow({ ...everything, category: 'functions', query: 'lpf' });
		await sleep(800);
		await shot('reference');
		// One search over every view: lpf finds functions, snippets and songs together.
		steps.browserSearchAll = await api.browserShow({ ...everything, category: 'all', query: 'lpf' });
		await sleep(500);
		await shot('browser-global');
		// "All" of the Library: sounds only, so lpf finds nothing there.
		steps.browserLibraryOnly = await api.browserShow({ ...everything, category: 'all', scope: 'library', query: 'lpf' });
		// "All" of the Reference.
		steps.browserReferenceOnly = await api.browserShow({ ...everything, category: 'all', scope: 'reference', query: 'filter' });
		// A color from the dots of the details pane: the project file keeps it. The file is
		// removed again when the test made it, so the template stays as it is in git.
		const indexFile = vscode.Uri.joinPath(folder, 'strdltn.index.json');
		const indexExisted = await vscode.workspace.fs.stat(indexFile).then(() => true, () => false);
		await api.browserMessage({ type: 'color', ids: ['sound:bd'], color: 1, on: true });
		steps.browserColorSaved = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(indexFile))).items?.['sound:bd'];
		steps.browserColorFilter = await api.browserShow({ ...everything, category: 'all', color: 1 });
		await sleep(800);
		await shot('browser-color');
		await api.browserMessage({ type: 'color', ids: ['sound:bd'], color: 1, on: false });
		if (!indexExisted) await vscode.workspace.fs.delete(indexFile);
		await vscode.commands.executeCommand('workbench.action.closeSidebar');
		await sleep(1200);
		await shot('editor');
		await vscode.commands.executeCommand('strdltn.browser.focus');
		const previews: Record<string, boolean> = {};
		for (const [key, sound] of Object.entries(picks)) {
			if (!sound) continue;
			await vscode.commands.executeCommand('strdltn.previewSound', { kind: 'sound', sound });
			previews[key] = await until(() => has('editor', demo, `preview: ${sound.name}:0`), 15000);
			await sleep(700);
		}
		steps.previews = previews;
		// A click on the name of a sound: heard, with preview on, and nothing is typed.
		const previewCount = (mode: string) => session(mode, demo)?.logs.filter((line) => line.includes('preview: bd:0')).length ?? 0;
		if (picks.sample) {
			const heardBefore = previewCount('editor');
			const playedBefore = api.browserPreviews().length;
			// What the Browser sends when a row is clicked with preview on. No song plays here,
			// so Results plays the sample itself, without the engine.
			await api.browserMessage({ type: 'play', id: `sound:${picks.sample.name}` });
			steps.clickSoundInStrudelEditor = {
				playedByBrowser: await until(() => api.browserPreviews().length > playedBefore, 8000),
				byBrowser: api.browserPreviews().slice(playedBefore),
				byEngine: previewCount('editor') > heardBefore,
				typedNothing: (await text(demo)) === demoText,
			};
			// A plain wave is made in the page too.
			const wavesBefore = api.browserPreviews().length;
			await api.browserMessage({ type: 'play', id: 'sound:sawtooth' });
			steps.previewWaveByBrowser = (await until(() => api.browserPreviews().length > wavesBefore, 5000)) && api.browserPreviews().slice(wavesBefore);
		}
		if (picks.soundfont) {
			await vscode.commands.executeCommand('strdltn.insertSound', { kind: 'sound', sound: picks.soundfont });
			steps.insertSoundInStrudelEditor = await until(() => false, 1500).then(async () => (await text(demo)).includes(picks.soundfont!.name));
			await restore(demo, demoText);
			// The same through the insert button of a row in the Browser, and the .bank() button of a heading.
			await api.browserMessage({ type: 'insert', id: `sound:${picks.soundfont.name}` });
			await sleep(1000);
			steps.browserInsertSoundAtCursor = (await text(demo)).includes(picks.soundfont.name);
			// A soundfont needs a note: insert types the code that plays it.
			steps.browserInsertSoundAsCode = (await text(demo)).includes(`note("c3").s("${picks.soundfont.name}")`);
			await restore(demo, demoText);
			await api.browserMessage({ type: 'insertText', text: '.bank("RolandTR909")' });
			await sleep(1000);
			steps.browserInsertBankAtCursor = (await text(demo)).length === demoText.length + '.bank("RolandTR909")'.length;
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

		// 2d. Two songs play. Stop is for the one in front, then for the one that still
		// plays in the other tab. Stop all is for both.
		const second = vscode.Uri.joinPath(folder, 'examples', '01-chords-and-bass.strudel');
		const playing = () => [session('editor', demo)?.started, session('editor', second)?.started];
		await vscode.commands.executeCommand('vscode.openWith', second, EDITOR);
		await until(() => has('editor', second, 'local samples'), 30000);
		await vscode.commands.executeCommand('strdltn.play');
		await until(() => has('editor', second, 'report:'), 30000);
		await sleep(1000);
		steps.twoSongsPlaying = playing();
		steps.statusSecondSong = api.status()?.text;
		await vscode.commands.executeCommand('strdltn.stop');
		await sleep(500);
		steps.afterStopInFront = playing();
		const plain = await vscode.workspace.openTextDocument({ content: 'not a song', language: 'plaintext' });
		await vscode.window.showTextDocument(plain);
		await sleep(500);
		steps.statusInAnotherTab = api.status()?.text;
		await vscode.commands.executeCommand('strdltn.stop');
		await sleep(500);
		steps.afterStopElsewhere = playing();
		steps.statusNothingPlays = api.status()?.text ?? 'hidden';
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.commands.executeCommand('vscode.openWith', second, EDITOR);
		await vscode.commands.executeCommand('strdltn.play');
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		await vscode.commands.executeCommand('strdltn.play');
		await until(() => playing().every(Boolean), 10000);
		steps.twoSongsPlayingAgain = playing();
		await vscode.commands.executeCommand('strdltn.stopAll');
		await sleep(500);
		steps.afterStopAll = playing();
		await vscode.commands.executeCommand('vscode.openWith', second, EDITOR);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		await vscode.commands.executeCommand('strdltn.play');
		await until(() => !!session('editor', demo)?.started, 10000);
		save();

		// 3. Hide the editor tab for a while. The engine should survive.
		const other = await vscode.workspace.openTextDocument({ content: 'hidden tab test', language: 'plaintext' });
		await vscode.window.showTextDocument(other);
		await sleep(process.env.VSTRUDEL_TEST_QUICK === '1' ? 1000 : 6000);
		steps.editorStartedWhileHidden = session('editor', demo)?.started;
		steps.editorSessionAliveWhileHidden = !!session('editor', demo);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.commands.executeCommand('strdltn.stop');
		await sleep(500);
		steps.editorStartedAfterStop = session('editor', demo)?.started;
		steps.editorProblems = problems('editor', demo);
		save();

		// 4. Switch to the native editor.
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		await sleep(500);
		let before = Date.now();
		await vscode.commands.executeCommand('strdltn.toggleMode');
		steps.toggleToNativeMs = Date.now() - before;
		await sleep(500);
		steps.tabsAfterToggleToNative = tabs(demo);
		steps.activeTextEditorIsDemo = vscode.window.activeTextEditor?.document.uri.toString() === demo.toString();
		steps.editorSessionGoneAfterToggle = !session('editor', demo);

		// 4b. The Snippets view, inserting into the native editor.
		steps.snippets = api.snippets();

		// 4a. A click on a sound does not type into a file that is not a Strudel file.
		const notes = await vscode.workspace.openTextDocument({ content: 'notes', language: 'markdown' });
		await vscode.window.showTextDocument(notes);
		await vscode.commands.executeCommand('strdltn.insertSound', { kind: 'sound', sound: { name: 'bd', type: 'sample', count: 1 } });
		await sleep(500);
		steps.otherFileUntouched = notes.getText() === 'notes';
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		await vscode.commands.executeCommand('notifications.clearAll');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(demo));
		steps.browserSnippets = await api.browserShow({ ...everything, category: 'snippets' });
		await sleep(800);
		await shot('snippets-view');
		const snippetBody = 's("[~ hh]*4").bank("RolandTR909").gain(.6)';
		const nativeBefore = await text(demo);
		const snippetUri = vscode.Uri.joinPath(folder, 'lib', 'drums', 'offbeat-hats.strudel');
		await vscode.commands.executeCommand('strdltn.insertSnippet', { uri: snippetUri, name: 'drums/offbeat-hats' });
		await sleep(700);
		steps.insertSnippetInNativeEditor = count(await text(demo), snippetBody) === count(nativeBefore, snippetBody) + 1;
		await restore(demo, nativeBefore);
		// The insert button of a snippet row in the Browser, into the native editor at its cursor.
		await api.browserMessage({ type: 'insert', id: 'snippet:drums/offbeat-hats' });
		await sleep(700);
		steps.browserInsertSnippetInNativeEditor = count(await text(demo), snippetBody) === count(nativeBefore, snippetBody) + 1;
		await restore(demo, nativeBefore);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		// 5. Play from the native editor: a stage opens beside it.
		await vscode.commands.executeCommand('strdltn.play');
		steps.stagePlayed = await until(() => has('stage', demo, 'report:'), 40000);
		steps.stageReport = last('stage', demo, 'report:');
		steps.stageNeedsClick = has('stage', demo, 'click inside the webview');
		steps.stageDock = last('stage', demo, 'dock:');
		{
			// The same click from the native editor: heard through the stage, nothing typed.
			const textBefore = await text(demo);
			const heardBefore = previewCount('stage');
			await api.browserMessage({ type: 'play', id: 'sound:bd' });
			steps.clickSoundInNativeEditor = {
				heard: await until(() => previewCount('stage') > heardBefore, 5000),
				typedNothing: (await text(demo)) === textBefore,
			};
			// The song plays, so the preview waits for the next beat and says which.
			steps.previewOnBeat = last('stage', demo, 'preview: bd:0');
		}
		// Move the first fader of the Mixer while the stage plays. The number in the code has to follow.
		const beforeSlider = await text(demo);
		api.mixerSlider(0, '0.123');
		steps.sliderWroteCode = await until(() => vscode.workspace.textDocuments.some((d) => d.uri.toString() === demo.toString() && d.getText().includes('slider(0.123,')), 5000);
		const afterSlider = await text(demo);
		steps.sliderChangedOnlyTheNumber = afterSlider.length - beforeSlider.length === '0.123'.length - (/slider\(([\d.]+),/.exec(beforeSlider)?.[1].length ?? 0);
		await restore(demo, beforeSlider);
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
		await vscode.commands.executeCommand('strdltn.play');
		await sleep(3000);
		steps.documentLength = document.getText().length;
		steps.stageReportAfterEdit = last('stage', demo, 'report:');
		steps.stageProblems = problems('stage', demo);
		await vscode.commands.executeCommand('strdltn.stop');
		save();

		// 7. Switch back. The stage closes and the Strudel editor has the edit.
		await vscode.window.showTextDocument(document);
		before = Date.now();
		await vscode.commands.executeCommand('strdltn.toggleMode');
		steps.toggleToStrudelMs = Date.now() - before;
		steps.editorReloaded = await until(() => has('editor', demo, 'local samples'), 30000);
		steps.tabsAfterToggleToStrudel = tabs(demo);
		steps.stageGoneAfterToggle = !session('stage', demo);
		await vscode.commands.executeCommand('strdltn.play');
		await until(() => has('editor', demo, 'report:'), 15000);
		steps.editorReportAfterToggle = last('editor', demo, 'report:');
		await vscode.commands.executeCommand('strdltn.stop');

		// Leave the file as it was.
		const remove = new vscode.WorkspaceEdit();
		remove.delete(demo, new vscode.Range(0, 0, 1, 0));
		await vscode.workspace.applyEdit(remove);
		await sleep(500);
		steps.documentRestored = !document.getText().includes(marker.trim());
		steps.documentDirty = document.isDirty;
		save();

		// VSTRUDEL_TEST_QUICK=1 leaves out the two long parts, the pack download and the
		// play of every template file. For a change that does not touch them.
		const quick = process.env.VSTRUDEL_TEST_QUICK === '1';
		steps.quick = quick;

		// 7a. A song that loads a pack from GitHub: its sounds are listed before it has
		// played, and the pack is copied into the cache of the workspace.
		const coastline = vscode.Uri.joinPath(folder, 'examples', '05-coastline.strudel');
		if (!quick) {
		await vscode.commands.executeCommand('vscode.openWith', coastline, EDITOR);
		steps.packListedBeforePlay = await until(() => api.sounds().some((s) => s.tag === 'github:eddyflux/crate'), 40000);
		steps.packItems = api.browserFind({ place: 'packs' }).length;
		steps.packBanks = api.browserGroups('drums').filter((bank) => bank.startsWith('crate'));
		steps.packCached = await until(() => api.packs().some((pack) => pack.source === 'github:eddyflux/crate' && pack.complete), 180000);
		steps.packs = api.packs();
		steps.packServedFromCache = await until(() => has('editor', coastline, 'github:eddyflux/crate (cached): registered'), 20000);
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

		// 7a2. A pack by its https address, and a map written in the song with a remote
		// base. The first play of the map is from the network, the next from the cache.
		// On a later run both are in the cache from the start.
		const packSong = vscode.Uri.joinPath(folder, 'zz-pack-test.strudel');
		const address = 'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json';
		const base = 'github:tidalcycles/dirt-samples';
		const song = `samples('${address}')\nsamples({ zzbd: 'bd/BT0A0A7.wav' }, '${base}')\n$: s("zzbd*2")\n`;
		try {
			await vscode.workspace.fs.writeFile(packSong, new TextEncoder().encode(song));
			await vscode.commands.executeCommand('vscode.openWith', packSong, EDITOR);
			steps.httpsPackListed = await until(() => api.sounds().some((s) => s.tag === address), 40000);
			steps.httpsPackCached = await until(() => api.packs().some((pack) => pack.source === address && pack.complete), 120000);
			steps.httpsPackServedFromCache = await until(() => has('editor', packSong, `${address} (cached): registered`), 20000);
			await vscode.commands.executeCommand('strdltn.play');
			await until(() => has('editor', packSong, 'report:'), 30000);
			steps.baseFirstPlay = last('editor', packSong, `samples from ${base}`);
			steps.baseFilesCached = await until(() => api.packs().some((pack) => pack.source === base && pack.complete), 60000);
			await vscode.commands.executeCommand('strdltn.play');
			steps.baseServedFromCache = await until(() => has('editor', packSong, `samples from ${base}: cache`), 10000);
			await sleep(2000);
			steps.packSongProblems = problems('editor', packSong);
			await vscode.commands.executeCommand('strdltn.stop');
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} finally {
			await vscode.workspace.fs.delete(packSong).then(undefined, () => undefined);
		}
		steps.packs = api.packs();
		}
		steps.packCache = await api.packCache();
		save();

		// 7a3. FM-1 Synths under Plugins in the Library (Firmware Marketplace in doc/TODO.md). OBERVAVE, loaded by a song,
		// is cached and listed under Installed. The hub's list fills Available, and each firmware gets a picture of its
		// screen. The screen runs in the popup. Insert puts the line that plays OBERVAVE into a song without one, with the
		// song's firmware() line first, once. A double click on an Available one installs it into firmware/, and a song
		// plays it from there with no firmware() line.
		{
			const obervave = 'https://raw.githubusercontent.com/Vibe-FM-SDK/vibe-fm-sdk/main/firmwares/obervave.wasm';
			const loader = vscode.Uri.joinPath(folder, 'zz-firmware-load.strudel');
			const target = vscode.Uri.joinPath(folder, 'zz-firmware-insert.strudel');
			const firmwareFolder = vscode.Uri.joinPath(folder, 'firmware');
			const hadFirmwareFolder = await vscode.workspace.fs.stat(firmwareFolder).then(
				() => true,
				() => false,
			);
			const found: Record<string, unknown> = {};
			steps.firmware = found;
			let installedId: string | undefined;
			try {
				await vscode.workspace.fs.writeFile(loader, new TextEncoder().encode(`firmware('${obervave}')\n$: note("c2").s("vibefm1:obervave")\n`));
				await vscode.commands.executeCommand('vscode.openWith', loader, EDITOR);
				found.installed = await until(() => api.firmware().installed.some((fw) => fw.id === 'obervave'), 60000);
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				const all = { query: '', chips: [] as string[], color: undefined, place: undefined, scope: undefined, builtin: undefined };
				await api.browserShow({ ...all, category: 'fm1' }, ['Installed', 'Available']);
				found.hubListed = await until(() => api.firmware().hub > 0, 30000);
				found.hub = api.firmware().hub;
				found.hubError = api.firmware().hubError;
				found.available = api.firmware().available.length;
				found.counts = { plugins: api.browserCounts().plugins, fm1: api.browserCounts().fm1 };
				found.oldCategoriesGone = !('instruments' in api.browserCounts()) && !('firmware' in api.browserCounts());
				// Pictures: OBERVAVE's and the first Available ones, which the Library shows at the top.
				const first = api.firmware().available.slice(0, 3);
				found.picturesOfFirst = await until(() => ['obervave', ...first].every((id) => api.firmware().pictures.includes(`firmware:${id}`) || api.firmware().picturesFailed.some((f) => f.startsWith(`firmware:${id}:`))), 180000);
				await sleep(800);
				found.results = await api.browserShow({ ...all, category: 'fm1' }, ['Installed', 'Available']);
				await shot('firmware-library');

				// The screen popup: frames painted, with the firmware run on the page's thread and no sound.
				api.firmwareScreen('obervave');
				found.screenPainted = await until(() => (api.firmware().screen.state?.frames ?? 0) >= 30, 20000);
				found.screen = api.firmware().screen;
				await shot('firmware-screen');
				api.firmwareScreen(undefined);

				// Insert into a song that does not load the firmware: the load line after its comments, the line at the cursor.
				// The cursor goes before the marker on its own line, so the inserted line is `$: note(...)// here`, which plays.
				const song = '// a song without firmware\n\n$: s("bd*2")\n// here\n';
				await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(song));
				await vscode.commands.executeCommand('vscode.openWith', target, EDITOR);
				await until(() => has('editor', target, 'local samples'), 30000);
				found.cursorPlaced = await api.revealText('// here');
				await sleep(500);
				await api.browserMessage({ type: 'insert', id: 'firmware:obervave' });
				await sleep(1500);
				const once = lf(await text(target));
				const insert: Record<string, unknown> = {
					text: once,
					loadLineAfterComments: once.startsWith(`// a song without firmware\nfirmware('${obervave}')\n`),
					playLineAtCursor: once.includes('\n$: note("c2 eb2 g2 bb2").s("vibefm1:obervave")// here'),
				};
				found.insert = insert;
				await vscode.commands.executeCommand('strdltn.play');
				found.played = await until(() => has('editor', target, 'report:'), 30000);
				await sleep(2500);
				found.problems = problems('editor', target);
				found.engineKnowsIt = has('editor', target, 'vibefm1: obervave');
				await shot('firmware-inserted');
				await vscode.commands.executeCommand('strdltn.stop');
				// A second insert: the song loads the firmware now, so only the line at the cursor goes in.
				await api.browserMessage({ type: 'insert', id: 'firmware:obervave' });
				await sleep(1500);
				const twice = lf(await text(target));
				insert.loadLineOnceAfterTwoInserts = count(twice, `firmware('${obervave}')`) === 1;
				insert.playLinesAfterTwoInserts = count(twice, 's("vibefm1:obervave")');
				await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

				// Install by a double click on an Available row (the page sends `insert` for it, as Enter does).
				installedId = first.find((id) => api.firmware().pictures.includes(`firmware:${id}`)) ?? first[0];
				if (installedId) {
					await api.browserMessage({ type: 'insert', id: `firmware:${installedId}` });
					const installed = await until(() => api.firmware().installed.some((fw) => fw.id === installedId && fw.from === 'folder'), 60000);
					const meta = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(firmwareFolder, installedId, 'firmware.json')).then(
						(bytes) => JSON.parse(new TextDecoder().decode(bytes)),
						() => undefined,
					);
					found.install = { id: installedId, installed, name: meta?.name, leftAvailable: !api.firmware().available.includes(installedId) };
					// The installed one plays in a song without a firmware() line.
					await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(`$: note("c2 eb2").s("vibefm1:${installedId}")\n`));
					await vscode.commands.executeCommand('vscode.openWith', target, EDITOR);
					await until(() => has('editor', target, 'local samples'), 30000);
					await vscode.commands.executeCommand('strdltn.play');
					(found.install as Record<string, unknown>).played = await until(() => has('editor', target, 'report:'), 30000);
					await sleep(2500);
					(found.install as Record<string, unknown>).problems = problems('editor', target);
					(found.install as Record<string, unknown>).engineKnowsIt = has('editor', target, `vibefm1: ${installedId}`) || !!last('editor', target, 'vibefm1:')?.includes(installedId);
					await vscode.commands.executeCommand('strdltn.stop');
					await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
				}
				found.pictures = { shown: api.firmware().pictures.length, made: api.firmware().picturesMade.length, failed: api.firmware().picturesFailed };
			} catch (error) {
				found.error = String(error);
			} finally {
				await vscode.workspace.fs.delete(loader).then(undefined, () => undefined);
				await vscode.workspace.fs.delete(target).then(undefined, () => undefined);
				// The test must not leave a GPL firmware in the template.
				if (installedId) await vscode.workspace.fs.delete(vscode.Uri.joinPath(firmwareFolder, installedId), { recursive: true }).then(undefined, () => undefined);
				if (!hadFirmwareFolder) await vscode.workspace.fs.delete(firmwareFolder, { recursive: true }).then(undefined, () => undefined);
			}
			save();
		}

		// 7b. Every snippet and example of the template plays. This is what catches a
		// function or a sound name that the pinned Strudel version does not have.
		const files = (await vscode.workspace.findFiles('{lib,examples}/**/*.strudel')).sort((a, b) => a.path.localeCompare(b.path));
		const fileProblems: Record<string, string[]> = {};
		let filesChecked = 0;
		for (const file of quick ? [] : files) {
			if (file.path.includes('hydra')) continue;
			filesChecked++;
			await vscode.commands.executeCommand('vscode.openWith', file, EDITOR);
			await until(() => has('editor', file, 'local samples'), 30000);
			await vscode.commands.executeCommand('strdltn.play');
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
			// The Devices view while OBERVAVE plays (phase 4 step 7): its copies, their parameters, the frames that
			// reached the view, and a picture. Then one panel maximized, and taken out into a tab and back.
			if (file.path.endsWith('07-vibefm1-obervave.strudel')) {
				await vscode.commands.executeCommand('strdltn.devices.focus');
				const framesAt = api.devices().frames;
				await until(() => api.devices().frames > framesAt + 30, 15000);
				const now = api.devices();
				steps.devices = {
					list: now.devices.map((d) => `${d.key} params=${d.params.length}`),
					frames: now.frames - framesAt,
					panels: now.state?.panels,
				};
				await shot('devices');
				save();
			}
			// MIDI through the extension host's worker (phase 5): the ports it found, and how late it sent.
			if (file.path.endsWith('09-midi-out.strudel')) steps.midi = await api.midi();
			await vscode.commands.executeCommand('strdltn.stop');
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			save();
		}
		steps.filesChecked = filesChecked;
		steps.fileProblems = fileProblems;
		save();

		// 8. Hydra: loaded from unpkg.com at run time, needs WebGL.
		if (!quick) {
		await vscode.commands.executeCommand('vscode.openWith', hydra, EDITOR);
		steps.hydraLoaded = await until(() => has('editor', hydra, 'local samples'), 30000);
		await vscode.commands.executeCommand('strdltn.play');
		steps.hydraPlayed = await until(() => has('editor', hydra, 'report:'), 40000);
		await sleep(3000);
		steps.hydraReport = last('editor', hydra, 'report:');
		steps.hydraProblems = problems('editor', hydra);
		await vscode.commands.executeCommand('workbench.action.closeSidebar');
		await sleep(1500);
		await shot('hydra');
		await vscode.commands.executeCommand('strdltn.stop');
		}
		// 9. Pictures for README.md and doc/ABOUT.md: the window as a user sees it while a
		// song plays. The Strudel editor on the kick and its sliders and scopes, the Library
		// on Drums with the TR-909 open in Results, the Mixer with bass unfolded.
		// The pictures in doc/ are cut out of it, see "Screenshots" in doc/ARCHITECTURE.md.
		await vscode.commands.executeCommand('vscode.openWith', demo, EDITOR);
		await until(() => has('editor', demo, 'local samples'), 30000);
		await vscode.commands.executeCommand('strdltn.play');
		await until(() => has('editor', demo, 'report:'), 30000);
		const tr909doc = api.browserGroups('drums').find((bank) => /^rolandtr909$/i.test(bank));
		await api.browserShow({ query: '', chips: [], color: undefined, place: undefined, scope: undefined, builtin: undefined, category: 'drums' }, tr909doc ? [tr909doc] : []);
		await api.mixerShow(['bass']);
		const kick = api.mixer().model?.chains.findIndex((chain) => chain.name === 'kick') ?? -1;
		if (kick >= 0) api.mixerReveal(kick);
		const framesBefore = api.mixer().scopeFrames;
		await sleep(3000);
		// The scopes of the song reach the Mixer while it plays, about 20 frames a second.
		steps.mixerScopes = { frames: api.mixer().scopeFrames - framesBefore, scopes: api.mixer().lastScopes };
		await shot('doc-overview');
		await vscode.commands.executeCommand('strdltn.stop');
		result.finished = true;
		result.logs = api.sessions().map((s) => ({ mode: s.mode, uri: s.uri.split('/').pop(), logs: s.logs }));
	} catch (error) {
		result.error = String((error as Error)?.stack ?? error);
	}
	save();
	// Revert rather than save: the test must not write to the template.
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
}
