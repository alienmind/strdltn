// Runs src/test/m0.ts inside a real desktop VS Code and prints what it recorded.
//
// The instance has its own throwaway profile, so your own settings are not touched.
// `--quick` (pnpm test:quick) is for a small change: no sound on the speakers, and
// without the long parts (the pack downloads, the play of every template file, Hydra
// and the wait with a hidden tab). The full run is the regression test and is audible.
//
// Other arguments go to VS Code, for example:
//   pnpm test:vscode -- --autoplay-policy=no-user-gesture-required
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const profile = mkdtempSync(join(tmpdir(), 'strdltn-test-'));
const out = join(profile, 'result.json');
// This script may itself be started from a VS Code terminal or extension. Those set
// variables that would make the new Code.exe run as plain Node or attach to the parent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ELECTRON_|VSCODE_)/.test(name)));
env.VSTRUDEL_TEST_OUT = out;
const quick = process.argv.includes('--quick') || process.env.VSTRUDEL_TEST_QUICK === '1';
if (quick) env.VSTRUDEL_TEST_QUICK = '1';
// The test asks for pictures of the window by dropping `<name>.request` files here.
// They end up as .strdltn/tmp/shots/<name>.png, for a person or an agent to look at.
const shots = join(root, '.strdltn', 'tmp', 'shots');
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const strdltnIgnore = join(root, '.strdltn', '.gitignore');
if (!existsSync(strdltnIgnore)) writeFileSync(strdltnIgnore, '# Managed by strdltn (cache and temporary files). Safe to delete.\n*\n');
env.VSTRUDEL_TEST_SHOTS = shots;

// A quiet window for the screenshots: no welcome tab, no git question, no chat panel.
mkdirSync(join(profile, 'user', 'User'), { recursive: true });
writeFileSync(
	join(profile, 'user', 'User', 'settings.json'),
	JSON.stringify({
		'workbench.startupEditor': 'none',
		'git.openRepositoryInParentFolders': 'never',
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		'chat.commandCenter.enabled': false,
		'window.zoomLevel': 0,
	}),
);

const args = [
	`--extensionDevelopmentPath=${root}`,
	`--extensionTestsPath=${join(root, 'dist/test/m0.cjs')}`,
	`--user-data-dir=${join(profile, 'user')}`,
	`--extensions-dir=${join(profile, 'extensions')}`,
	'--disable-workspace-trust',
	'--skip-welcome',
	'--skip-release-notes',
	'--disable-updates',
	...process.argv.slice(2).filter((argument) => argument !== '--quick'),
	join(root, 'template'),
];

// A webview only starts audio after a real click inside it (measured, see
// doc/ARCHITECTURE.md). The extension shows a "Click to enable audio" overlay for that.
// Nobody is there to click in a test, so we click the overlay through the Chrome
// DevTools Protocol. `userGesture: true` makes the browser treat it as a real click.
const DEBUG_PORT = 9339;
args.unshift(`--remote-debugging-port=${DEBUG_PORT}`);
// Chromium's own switch. The engine runs as always, only the output of the window is
// silent, so the test records the same facts. It goes in front: VS Code reads the word
// after a switch it does not know as its value, and the last word is the folder to open.
if (quick) args.unshift('--mute-audio');
const overlayScript = (click) => `(() => {
	const documents = [document, ...[...document.querySelectorAll('iframe')].map((frame) => { try { return frame.contentDocument; } catch { return null; } })];
	for (const doc of documents) {
		const overlay = doc?.getElementById('unlock');
		if (overlay?.classList.contains('visible')) { ${click ? 'overlay.click();' : ''} return 'visible'; }
	}
	return 'none';
})()`;

/** One Chrome DevTools Protocol call on one target. Resolves to its result, or undefined. */
function cdp(webSocketUrl, method, params) {
	return new Promise((done) => {
		const socket = new WebSocket(webSocketUrl);
		const finish = (value) => {
			clearTimeout(timer);
			socket.close();
			done(value);
		};
		const timer = setTimeout(() => finish(undefined), 5000);
		socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
		socket.onmessage = (event) => finish(JSON.parse(event.data).result);
		socket.onerror = () => finish(undefined);
	});
}

const evaluateIn = async (webSocketUrl, expression, userGesture) =>
	(await cdp(webSocketUrl, 'Runtime.evaluate', { expression, userGesture }))?.result?.value;

async function takeRequestedShots(targets) {
	const requests = readdirSync(shots).filter((file) => file.endsWith('.request'));
	if (!requests.length) return;
	const workbench = targets.find((target) => target.type === 'page' && target.url.startsWith('vscode-file://'));
	if (!workbench?.webSocketDebuggerUrl) return;
	for (const request of requests) {
		const picture = await cdp(workbench.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
		rmSync(join(shots, request), { force: true });
		if (picture?.data) writeFileSync(join(shots, request.replace(/\.request$/, '.png')), Buffer.from(picture.data, 'base64'));
	}
}

/** A DevTools connection kept open for a run of calls, so typing does not open a socket per key. */
async function cdpSession(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let next = 1;
	const waiting = new Map();
	socket.onmessage = (event) => {
		const reply = JSON.parse(event.data);
		waiting.get(reply.id)?.(reply.result);
		waiting.delete(reply.id);
	};
	return {
		send: (method, params) =>
			new Promise((resolve) => {
				const id = next++;
				waiting.set(id, resolve);
				socket.send(JSON.stringify({ id, method, params }));
				setTimeout(() => waiting.has(id) && (waiting.delete(id), resolve(undefined)), 5000);
			}),
		close: () => socket.close(),
	};
}

// ---- real input for the test ----------------------------------------------------------
//
// The test drops `<name>.input` (a list of actions, JSON) next to the screenshot requests.
// The actions are sent to the VS Code window as real mouse and key events through the
// DevTools protocol (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`): the browser
// treats them as a person's input, routes them to the frame under the pointer or with the
// focus, and the editor in the webview gets them the way it gets a click and a key. The
// result goes to `<name>.done`.
//
// Actions: { click: offset } puts the pointer on that character of the Strudel editor in
// front and clicks; { type: "text" } presses a key per character; { key: "Enter" } and
// { key: "z", ctrl: true }; { wait: ms }.

const KEYS = {
	Enter: { code: 'Enter', keyCode: 13, text: '\r' },
	Backspace: { code: 'Backspace', keyCode: 8 },
	ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
	ArrowRight: { code: 'ArrowRight', keyCode: 39 },
	ArrowUp: { code: 'ArrowUp', keyCode: 38 },
	ArrowDown: { code: 'ArrowDown', keyCode: 40 },
	Home: { code: 'Home', keyCode: 36 },
	End: { code: 'End', keyCode: 35 },
};

/**
 * The test hook of our page. The DevTools target of a webview is VS Code's outer page; ours
 * is the frame inside it (same origin, so not a target of its own).
 */
const HOOK = `(() => { for (const w of [window, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentWindow } catch { return null } })]) if (w && w.__strdltnTest) return w.__strdltnTest; })()`;
/** Where that frame sits in the outer page. */
const HOOK_FRAME = `(() => { const f = [...document.querySelectorAll('iframe')].find((f) => { try { return f.contentWindow.__strdltnTest } catch { return false } }); const r = f ? f.getBoundingClientRect() : { left: 0, top: 0 }; return { left: r.left, top: r.top } })()`;

const evaluate = async (session, expression) => (await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;

/** The webview of the Strudel editor that is shown, and where its frame sits in the window. */
async function strudelEditorFrame(targets, workbench, match) {
	for (const target of targets) {
		if (!target.url.startsWith('vscode-webview://') || !target.webSocketDebuggerUrl) continue;
		const session = await cdpSession(target.webSocketDebuggerUrl).catch(() => undefined);
		if (!session) continue;
		const facts = await evaluate(
			session,
			`(() => { const t = ${HOOK}; return t && t.mode() === 'editor' && t.text().includes(${JSON.stringify(match)}) ? { width: innerWidth, height: innerHeight, inner: ${HOOK_FRAME} } : null })()`,
		);
		if (!facts) {
			session.close();
			continue;
		}
		// The frame in the window with the same size as this page. A webview is an iframe
		// over the editor area, and the page inside fills it.
		const box = await evaluate(
			workbench,
			`(() => { const f = [...document.querySelectorAll('iframe')].map((i) => i.getBoundingClientRect()).find((r) => Math.abs(r.width - ${facts.width}) < 2 && Math.abs(r.height - ${facts.height}) < 2); return f && { left: f.left, top: f.top } })()`,
		);
		if (box) return { session, box: { left: box.left + facts.inner.left, top: box.top + facts.inner.top } };
		session.close();
	}
	return undefined;
}

async function runInputs(targets) {
	const requests = readdirSync(shots).filter((file) => file.endsWith('.input'));
	if (!requests.length) return;
	const page = targets.find((target) => target.type === 'page' && target.url.startsWith('vscode-file://'));
	if (!page?.webSocketDebuggerUrl) return;
	const workbench = await cdpSession(page.webSocketDebuggerUrl);
	for (const request of requests) {
		const file = join(shots, request);
		// `match`: text the editor holds. Every open Strudel editor is a webview, and one kept in
		// the background still says it is visible, so the text tells them apart.
		const { match, actions } = JSON.parse(readFileSync(file, 'utf8'));
		rmSync(file, { force: true });
		const log = [];
		const frame = await strudelEditorFrame(targets, workbench, match);
		if (!frame) {
			writeFileSync(file.replace(/\.input$/, '.done'), JSON.stringify({ error: 'no Strudel editor in front' }));
			continue;
		}
		const key = async (name, ctrl = false) => {
			const known = KEYS[name] ?? { code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0) };
			const base = { key: name, code: known.code, windowsVirtualKeyCode: known.keyCode, modifiers: ctrl ? 2 : 0 };
			await workbench.send('Input.dispatchKeyEvent', { type: known.text && !ctrl ? 'keyDown' : 'rawKeyDown', ...base, ...(known.text && !ctrl ? { text: known.text } : {}) });
			await workbench.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
		};
		for (const action of actions) {
			if ('click' in action) {
				await evaluate(frame.session, `${HOOK}.reveal(${action.click})`);
				await new Promise((done) => setTimeout(done, 150));
				const at = await evaluate(frame.session, `${HOOK}.coords(${action.click})`);
				if (!at) {
					log.push({ click: action.click, error: 'not on screen' });
					continue;
				}
				const before = await evaluate(frame.session, `${HOOK}.posAt(${at.x}, ${at.y})`);
				await evaluate(frame.session, `${HOOK}.measure()`);
				const measured = await evaluate(frame.session, `(() => { const t = ${HOOK}; const c = t.coords(${action.click}); return { coords: c, pos: c && t.posAt(c.x, c.y).pos, geometry: t.geometry(${action.click}) } })()`);
				const x = frame.box.left + at.x;
				const y = frame.box.top + at.y;
				await workbench.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
				await workbench.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
				await workbench.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
				await new Promise((done) => setTimeout(done, 100));
				log.push({ click: action.click, measured, geometry: await evaluate(frame.session, `${HOOK}.geometry(${action.click})`), at, before, after: await evaluate(frame.session, `${HOOK}.coords(${action.click})`), head: await evaluate(frame.session, `${HOOK}.head()`), focused: await evaluate(frame.session, `${HOOK}.focused()`) });
			} else if ('type' in action) {
				for (const char of action.type) {
					await workbench.send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char, unmodifiedText: char });
					await workbench.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
					if (action.delay) await new Promise((done) => setTimeout(done, action.delay));
				}
			} else if ('key' in action) {
				await key(action.key, action.ctrl);
			} else if ('wait' in action) {
				await new Promise((done) => setTimeout(done, action.wait));
			}
		}
		await new Promise((done) => setTimeout(done, 300));
		const text = await evaluate(frame.session, `${HOOK}.text()`);
		const head = await evaluate(frame.session, `${HOOK}.head()`);
		frame.session.close();
		writeFileSync(file.replace(/\.input$/, '.done'), JSON.stringify({ log, text, head }));
	}
	workbench.close();
}

let running = true;
(async () => {
	while (running) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
			await takeRequestedShots(targets);
			await runInputs(targets);
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
const timeout = setTimeout(() => child.kill(), 15 * 60 * 1000);
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
