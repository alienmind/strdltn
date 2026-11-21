// Runs inside the capture's VS Code (extensionTestsPath). It sets up each scene through the extension's API and asks
// the runner (capture.mjs) to record it, by dropping files into the signal folder:
//   <name>.want  -> the runner does it (record the song, or record a scene for <seconds>) and answers <name>.done
// The template is never written: every song opened is reverted and closed at the end.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signals = process.env.PROMO_SIGNALS;
const ws = process.env.PROMO_WS;
const only = process.env.PROMO_ONLY || '';
const durations = JSON.parse(process.env.PROMO_SCENES);

async function ask(name, body = {}) {
	fs.writeFileSync(path.join(signals, `${name}.want`), JSON.stringify(body));
	const done = path.join(signals, `${name}.done`);
	while (!fs.existsSync(done)) await sleep(200);
	return fs.readFileSync(done, 'utf8');
}

exports.run = async () => {
	const api = await vscode.extensions.getExtension('strdltn.strdltn').activate();
	const open = async (file) => {
		await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(ws, file)), 'strdltn.editor');
		await sleep(5000);
	};
	const play = async () => {
		await vscode.commands.executeCommand('strdltn.play');
		await sleep(3000);
	};
	const want = (id) => !only || only === id || (only === 'scenes' && id !== 'song');
	try {
		// The song: the whole demo, recorded from the engine while nothing else happens.
		if (want('song')) {
			await open('demo.strudel');
			await play();
			await ask('song', { file: 'demo.strudel', seconds: Number(process.env.PROMO_SONG_SECONDS) });
			await vscode.commands.executeCommand('strdltn.stop');
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}

		// 01: the demo playing, the Library at the side and the Mixer below.
		if (want('01-hook') || want('02-browser') || want('03-mixer')) {
			await open('demo.strudel');
			await vscode.commands.executeCommand('workbench.view.extension.strdltn');
			await play();
			await vscode.commands.executeCommand('strdltn.mixer.focus');
			// The editor on the kick, where the code lights up as it plays.
			const kick = api.mixer().model?.chains.findIndex((chain) => chain.name === 'kick') ?? -1;
			if (kick >= 0) api.mixerReveal(kick);
			await sleep(2000);
		}
		if (want('01-hook')) await ask('01-hook', { seconds: durations['01-hook'] });

		// 02: the Library, then the TR-909, then a search, a step every third of the scene.
		if (want('02-browser')) {
			const everything = { query: '', chips: [], color: undefined, place: undefined, scope: undefined };
			const tr909 = api.browserGroups('drums').find((bank) => /^rolandtr909$/i.test(bank));
			await api.browserShow({ ...everything, category: 'all' });
			const third = (durations['02-browser'] * 1000) / 3;
			const steps = (async () => {
				await sleep(third);
				await api.browserShow({ ...everything, category: 'drums' }, tr909 ? [tr909] : []);
				await sleep(third);
				await api.browserShow({ ...everything, category: 'all', query: '909 bd' });
			})();
			await ask('02-browser', { seconds: durations['02-browser'] });
			await steps;
		}

		// 03: the Mixer, the bass unfolded, its fader riding up and down. The code follows.
		if (want('03-mixer')) {
			await api.mixerShow(['bass']);
			const model = api.mixer().model;
			const index = model?.sliders.findIndex((s) => s.constant === 'BASS_VOL') ?? -1;
			const ride = (async () => {
				if (index < 0) return;
				const ms = durations['03-mixer'] * 1000;
				const start = Date.now();
				while (Date.now() - start < ms) {
					const t = (Date.now() - start) / ms;
					api.mixerSlider(index, (0.3 + 0.6 * Math.sin(Math.PI * t)).toFixed(3));
					await sleep(120);
				}
			})();
			await ask('03-mixer', { seconds: durations['03-mixer'] });
			await ride;
		}
		if (want('01-hook') || want('02-browser') || want('03-mixer')) {
			await vscode.commands.executeCommand('strdltn.stop');
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}

		// 04: OBERVAVE from the VIBE FM SDK, two copies with their own screens in the Devices tab.
		if (want('04-devices') || want('05-files')) {
			await open('examples/07-vibefm1-obervave.strudel');
			await play();
			await vscode.commands.executeCommand('strdltn.devices.focus');
			// The firmware is fetched and compiled on its first note.
			await sleep(8000);
		}
		if (want('04-devices')) await ask('04-devices', { seconds: durations['04-devices'] });

		// 05: the files of the project, the songs folder open.
		if (want('05-files')) {
			await vscode.commands.executeCommand('workbench.view.explorer');
			await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.join(ws, 'examples', '07-vibefm1-obervave.strudel')));
			await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.join(ws, 'samples', 'sos-vocals')));
			await sleep(1500);
			await ask('05-files', { seconds: durations['05-files'] });
		}
		if (want('04-devices') || want('05-files')) {
			await vscode.commands.executeCommand('strdltn.stop');
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	} catch (error) {
		fs.writeFileSync(path.join(signals, 'error.txt'), String(error?.stack ?? error));
	}
	fs.writeFileSync(path.join(signals, 'finished'), '');
	await sleep(500);
};
