// Runs src/test/m0.ts inside a real desktop VS Code and prints what it recorded.
//
// The instance has its own throwaway profile, so your own settings are not touched.
// Extra arguments go to VS Code, for example:
//   pnpm test:vscode -- --autoplay-policy=no-user-gesture-required
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--test'], { cwd: root, stdio: 'inherit' });

// Set VSCODE_EXE to test against a VS Code you already have. Otherwise the stable
// build is downloaded once into .vscode-test/. We do not default to the installed one:
// it refuses to start a second instance while an update is pending.
const executable = process.env.VSCODE_EXE ?? (await downloadAndUnzipVSCode('stable'));
if (!existsSync(executable)) throw new Error(`VS Code not found at ${executable}.`);

const profile = mkdtempSync(join(tmpdir(), 'vstrudel-test-'));
const out = join(profile, 'result.json');
// This script may itself be started from a VS Code terminal or extension. Those set
// variables that would make the new Code.exe run as plain Node or attach to the parent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ELECTRON_|VSCODE_)/.test(name)));
env.VSTRUDEL_TEST_OUT = out;

const args = [
	`--extensionDevelopmentPath=${root}`,
	`--extensionTestsPath=${join(root, 'dist/test/m0.cjs')}`,
	`--user-data-dir=${join(profile, 'user')}`,
	`--extensions-dir=${join(profile, 'extensions')}`,
	'--disable-workspace-trust',
	'--skip-welcome',
	'--skip-release-notes',
	'--disable-updates',
	...process.argv.slice(2),
	join(root, 'template'),
];

// A webview only starts audio after a real click inside it (measured, see
// doc/ARCHITECTURE.md). The extension shows a "Click to enable audio" overlay for that.
// Nobody is there to click in a test, so we click the overlay through the Chrome
// DevTools Protocol. `userGesture: true` makes the browser treat it as a real click.
const DEBUG_PORT = 9339;
args.unshift(`--remote-debugging-port=${DEBUG_PORT}`);
const overlayScript = (click) => `(() => {
	const documents = [document, ...[...document.querySelectorAll('iframe')].map((frame) => { try { return frame.contentDocument; } catch { return null; } })];
	for (const doc of documents) {
		const overlay = doc?.getElementById('unlock');
		if (overlay?.classList.contains('visible')) { ${click ? 'overlay.click();' : ''} return 'visible'; }
	}
	return 'none';
})()`;

function evaluateIn(webSocketUrl, expression, userGesture) {
	return new Promise((done) => {
		const socket = new WebSocket(webSocketUrl);
		const finish = (value) => {
			clearTimeout(timer);
			socket.close();
			done(value);
		};
		const timer = setTimeout(() => finish(undefined), 3000);
		socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, userGesture } }));
		socket.onmessage = (event) => finish(JSON.parse(event.data).result?.result?.value);
		socket.onerror = () => finish(undefined);
	});
}

let running = true;
(async () => {
	while (running) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
			for (const target of targets) {
				if (!target.url.startsWith('vscode-webview://') || !target.webSocketDebuggerUrl) continue;
				// Look first without a gesture. An evaluation with userGesture gives the
				// page user activation even when it clicks nothing, and that would hide
				// whether a click was needed at all.
				if ((await evaluateIn(target.webSocketDebuggerUrl, overlayScript(false), false)) !== 'visible') continue;
				await evaluateIn(target.webSocketDebuggerUrl, overlayScript(true), true);
				console.log('test: clicked the audio overlay');
			}
		} catch {
			// VS Code is still starting, or already gone.
		}
		await new Promise((done) => setTimeout(done, 700));
	}
})();

const child = spawn(executable, args, { env, stdio: 'inherit' });
const timeout = setTimeout(() => child.kill(), 6 * 60 * 1000);
child.on('exit', (code) => {
	running = false;
	clearTimeout(timeout);
	console.log(existsSync(out) ? readFileSync(out, 'utf8') : 'no result file was written');
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	} catch {
		// VS Code can still hold a file for a moment. The folder is in the temp directory.
	}
	process.exit(code ?? 1);
});
