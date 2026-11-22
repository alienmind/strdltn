// Runs inside the showcase's VS Code (extensionTestsPath): sets the stage, waits for the runner (showcase.mjs) to
// open the demo and press Play, then follows the song bar by bar: what the editor and the Mixer show in each
// section, and two knobs played through a loopback MIDI port, as a person would turn them. The template is never
// written: the demo is reverted and closed at the end.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signals = process.env.SHOWCASE_SIGNALS;
const SONG = process.env.SHOWCASE_SONG || 'sea_of_souls.strudel';
// One bar of the demo: 133 BPM, four beats.
const BAR = (60 / 133) * 4 * 1000;
// The loopback port the knobs come through: loopMIDI on the maintainer's PC.
const PORT = 'loopMIDI Port';
const DJ_CC = 21;
const SQUELCH_CC = 22;

exports.run = async () => {
	const api = await vscode.extensions.getExtension('strdltn.strdltn').activate();
	const wait = async (file) => {
		while (!fs.existsSync(path.join(signals, file))) await sleep(50);
		return fs.readFileSync(path.join(signals, file), 'utf8');
	};
	try {
		// The stage: no song open, the Mixer in the bottom panel. The runner clicks the rest.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('strdltn.mixer.focus');
		await vscode.commands.executeCommand('workbench.view.explorer');
		await sleep(2500);

		fs.writeFileSync(path.join(signals, 'ready'), '');
		const t0 = Number(await wait('playing')) * 1000;
		// No song started: nothing to follow.
		if (!t0) throw new Error('the runner did not start the song');
		const at = async (bar) => {
			const ms = t0 + bar * BAR - Date.now();
			if (ms > 0) await sleep(ms);
		};
		const say = (line) => fs.appendFileSync(path.join(signals, 'driver.log'), `[driver] ${line}\n`);
		const show = (names) => void api.mixerShow(names);
		const cc = (number, value) => api.midiSend(PORT, [0xb0, number, Math.max(0, Math.min(127, Math.round(value)))]);
		/** A knob turned from one value to another over `bars`, one message per step, as a hand does. */
		const turn = async (number, from, to, bars) => {
			const steps = Math.max(1, Math.abs(to - from));
			const ms = (bars * BAR) / steps;
			for (let i = 0; i <= steps; i++) {
				await cc(number, from + ((to - from) * i) / steps);
				await sleep(ms);
			}
		};
		/** A click on the knob button of the line that holds `text`, then the knob turned once: mapped. */
		let clicks = 0;
		const learn = async (text, number, value) => {
			const id = `k${++clicks}`;
			fs.writeFileSync(path.join(signals, `${id}.click`), JSON.stringify({ text }));
			const clicked = await wait(`${id}.clicked`);
			await sleep(1200);
			// Twice: the first message through a port that just opened can come late or not at all.
			const sent = await cc(number, value);
			await sleep(120);
			await cc(number, value);
			await sleep(1500);
			const doc = vscode.workspace.textDocuments.find((d) => d.uri.path.endsWith(SONG));
			say(`learn ${text}: click ${clicked}, MIDI sent ${sent}, .knob(${number}) in the code: ${!!doc?.getText().includes(`.knob(${number})`)}`);
		};

		// The camera: the whole window, a part of it, or a line of code (the runner finds where).
		let asks = 0;
		const zoom = async (region, text) => {
			const id = `z${++asks}`;
			fs.writeFileSync(path.join(signals, `${id}.zoom`), JSON.stringify({ region, text }));
			await wait(`${id}.zoom.done`);
		};
		/** The editor glides to the line that holds `text` (the maintainer: no jumps while the song plays). */
		const scroll = async (text, ms = 3500) => {
			const id = `s${++asks}`;
			fs.writeFileSync(path.join(signals, `${id}.scroll`), JSON.stringify({ text, ms }));
			await wait(`${id}.scroll.done`);
		};
		/** Typing at the cursor, as a person: the runner types it key by key; `run` ends with Ctrl+Enter. */
		const type = async (text, { before = [], run = false } = {}) => {
			const id = `t${++asks}`;
			fs.writeFileSync(path.join(signals, `${id}.type`), JSON.stringify({ text, before, run }));
			await wait(`${id}.type.done`);
		};

		// COUNTDOWN (bars 0 to 10): the vocals count down; the riser builds. A first MIDI message opens the loopback
		// port's output and input, so the first knob mapped later is not the one that pays for it.
		await cc(127, 0);
		await scroll('$vocals:');
		await zoom('full');
		await at(2);
		await zoom('editor');
		await at(7);
		await zoom('full');

		// INTRO (10 to 26): the drums come in, the Mixer's meters move; the pad at bar 19, its filter opening,
		// then gated from bar 23.
		await at(10);
		await scroll('$kick:');
		await at(12);
		await zoom('panel');
		await at(16);
		await zoom('full');
		await at(19);
		await scroll('const PAD_CUTOFF');
		show(['pad']);
		await zoom('line', 'const PAD_CUTOFF');

		await at(25);
		await zoom('full');

		// VERSE (26 to 42): bass and acid. The bass's squelch gets a knob that sits low: its dim handle climbs,
		// catches the fader, and the squelch rises into the BUILD.
		await at(26);
		show(['bass']);
		await scroll('const BASS_SQUELCH');
		await zoom('line', 'const BASS_SQUELCH');
		await at(27.5);
		await learn('const BASS_SQUELCH', SQUELCH_CC, 16);
		await at(29);
		await zoom('panel');
		await at(30);
		await turn(SQUELCH_CC, 16, 100, 4);
		await at(36);
		await zoom('full');
		await scroll('$acid:');

		// BUILD (42 to 50): the band thins out with the high-pass; the squelch comes back down.
		await at(42);
		await scroll('const BUILD_HPF');
		await zoom('line', 'const BUILD_HPF');
		show(['bass', 'riser']);
		void turn(SQUELCH_CC, 100, 64, 6);
		await at(45);
		await zoom('full');

		// DROP (50 to 66): everything, the clap, the chords. A DJ filter is typed in, the song updated with Ctrl+Enter,
		// a knob mapped to it; over the last 4 bars the filter closes into the BREAKDOWN.
		await at(50);
		show(['@master']);
		// One place for all of it, at the end of the song: a new line above `all(...)`, then `djf(DJ).` into that line,
		// then the knob. Three places far apart made the camera arrive four bars late (a take on 2026-11-22).
		await at(50.5);
		await scroll('all(x=>');
		await api.revealText('all(x=>');
		await zoom('line', 'all(x=>');
		await type('const DJ = slider(.5, 0, 1)\n');
		await api.revealText('fft(4)');
		await type('djf(DJ).', { run: true });
		await sleep(1200);
		await zoom('line', 'const DJ');
		await learn('const DJ', DJ_CC, 64);
		await at(60);
		await zoom('panel');
		await at(62);
		await turn(DJ_CC, 64, 18, 3.75);

		// BREAKDOWN (66 to 74): the filter opens again on its first beat; the vocals and the gated pad.
		await at(66);
		await turn(DJ_CC, 18, 64, 0.25);
		await zoom('full');
		await scroll('$vocals:');

		// FINAL DROP (74 to 90): OBERVAVE joins, playing the pad's chords; its screen in the Devices tab.
		await at(74);
		await vscode.commands.executeCommand('strdltn.devices.focus');
		await scroll('$fm:');
		await at(75);
		await zoom('panel');
		await at(80);
		await zoom('full');
		await at(82);
		await vscode.commands.executeCommand('strdltn.mixer.focus');
		show(['fm']);


		// OUTRO (90 to 100), then the END's silence.
		await at(90);
		await scroll('$riser:');
		show([]);
		await at(104.5);
		await vscode.commands.executeCommand('strdltn.stop');
		await sleep(1500);
	} catch (error) {
		fs.writeFileSync(path.join(signals, 'error.txt'), String(error?.stack ?? error));
	}
	fs.writeFileSync(path.join(signals, 'finished'), '');
	// The runner downloads the song from the demo's page: close it only after that.
	while (!fs.existsSync(path.join(signals, 'collected'))) await sleep(200);
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
};
