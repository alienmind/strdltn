// Captures the showcase: one continuous take of demo.strudel from start to end, picture and sound together, as
// the knobs moved during the take change the sound (doc/VIDEO.md, "Showcase").
//
//   node scripts/showcase.mjs
//
// The runner (this file) records the VS Code window's repaints, makes the real clicks of the opening (the
// [str]dltn icon, Songs, the demo, Play) and logs where the cursor goes, and takes the song from the engine's
// test hook (`record` in src/webview/main.ts) from the moment Play is clicked. The driver (showcase-driver.cjs)
// runs inside the VS Code window and plays the arrangement: what the editor and the Mixer show per section, and
// the knobs, sent as MIDI through a loopback port. They talk through files in a signal folder.
// Writes tmp/showcase/frames/*.jpg, tmp/showcase/song.wav and tmp/showcase/manifest.json.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const video = resolve(import.meta.dirname, '..');
const repo = resolve(video, '..');
const out = join(repo, 'tmp', 'showcase');
const FPS = 30;
// The size the page is laid out at, whatever the screen: 2560x1440, so the Mixer's strips and the cables under them
// show whole (the maintainer, 2026-11-22: 1920x1080 cut the cables). SIZE=1920x1080 for another.
const [W, H] = (process.env.SIZE ?? '2560x1440').split('x').map(Number);
// The song of the take: the demo without its explanatory comments (the maintainer, 2026-11-22). SONG=... for another.
const SONG = process.env.SONG ?? 'sea_of_souls.strudel';

const exe = process.env.VSCODE_EXE ?? join(repo, '.vscode-test', readdirSync(join(repo, '.vscode-test')).find((d) => d.startsWith('vscode-win32')), 'Code.exe');
const profile = mkdtempSync(join(tmpdir(), 'showcase-'));
const signals = join(profile, 'signals');
mkdirSync(signals, { recursive: true });
mkdirSync(join(profile, 'user', 'User'), { recursive: true });
writeFileSync(
	join(profile, 'user', 'User', 'settings.json'),
	JSON.stringify({
		'workbench.startupEditor': 'none',
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		'chat.commandCenter.enabled': false,
		'git.openRepositoryInParentFolders': 'never',
		'window.zoomLevel': 0,
		'workbench.colorTheme': 'Default Dark Modern',
		'workbench.tips.enabled': false,
		'window.commandCenter': false,
		'editor.minimap.enabled': false,
		'strdltn.midi.debug': false,
	}),
);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'frames'), { recursive: true });

const env = Object.fromEntries(Object.entries(process.env).filter(([n]) => !/^(ELECTRON_|VSCODE_)/.test(n)));
Object.assign(env, { SHOWCASE_SIGNALS: signals, SHOWCASE_WS: join(repo, 'template'), SHOWCASE_SONG: SONG });
const PORT = 9346;
const child = spawn(exe, [
	`--remote-debugging-port=${PORT}`, '--mute-audio',
	`--extensionDevelopmentPath=${repo}`, `--extensionTestsPath=${join(video, 'scripts', 'showcase-driver.cjs')}`,
	`--user-data-dir=${join(profile, 'user')}`, `--extensions-dir=${join(profile, 'extensions')}`,
	'--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', join(repo, 'template'),
], { env, stdio: 'ignore' });

const shots = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return []; } };

/** A DevTools connection kept open: calls by id, and events to a handler. */
async function session(url, onEvent = () => {}) {
	const s = new WebSocket(url);
	await new Promise((ok, no) => { s.onopen = ok; s.onerror = no; });
	let n = 1;
	const wait = new Map();
	s.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id) { wait.get(m.id)?.(m); wait.delete(m.id); } else onEvent(m);
	};
	const send = (method, params = {}) => new Promise((ok) => {
		const id = n++;
		wait.set(id, ok);
		s.send(JSON.stringify({ id, method, params }));
		setTimeout(() => wait.has(id) && (wait.delete(id), ok({ error: 'timeout' })), 30000);
	});
	const ev = async (expression, userGesture = false) => {
		const r = await send('Runtime.evaluate', { expression, userGesture, awaitPromise: true, returnByValue: true });
		return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
	};
	return { send, ev, close: () => s.close() };
}

const workbench = async () => (await targets()).find((t) => t.type === 'page' && t.url.startsWith('vscode-file://'));
const webviews = async () => (await targets()).filter((t) => t.url.includes('vscode-webview') && t.webSocketDebuggerUrl);
const HOOK = `(() => { for (const w of [window, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentWindow } catch { return null } })]) if (w && w.__strdltnTest) return w.__strdltnTest; })()`;

// The page laid out at W x H whatever the screen allows the window (the maintainer's screen gives 1440x900): a
// device metrics override, kept on a session that stays open for the whole take.
let emulation;
let casting = false;
let lastFrame = 0;
async function fullHd() {
	emulation = await session((await workbench()).webSocketDebuggerUrl, (m) => {
		if (m.method !== 'Page.screencastFrame') return;
		void emulation.send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
		if (casting) keep(Buffer.from(m.params.data, 'base64'), m.params.metadata.timestamp);
	});
	await emulation.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
}

/** A picture of the window at time t (seconds, as the screencast's timestamps). */
function keep(jpeg, t) {
	const name = `r${String(shots.length).padStart(5, '0')}.jpg`;
	writeFileSync(join(out, 'frames', name), jpeg);
	shots.push({ name, t });
	lastFrame = Date.now() / 1000;
}

/**
 * The screencast under a device metrics override sends repaints irregularly: in a take on 2026-11-22 none came for
 * 45 s after Play, and none from bar 62 to the end, while the window answered. So when none came for 0.4 s, a
 * screenshot is taken instead, and the take always has a picture at least about three times a second.
 */
let shooting = false;
async function watchdog() {
	if (!casting || shooting || Date.now() / 1000 - lastFrame < 0.4) return;
	shooting = true;
	const t = Date.now() / 1000;
	const shot = await emulation.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
	if (shot.result) keep(Buffer.from(shot.result.data, 'base64'), t);
	shooting = false;
}

// The "Click to enable audio" layer, should the editor show it: clicked as the promo's capture does.
const OVERLAY = `(() => { for (const d of [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument } catch { return null } })]) { const o = d && d.getElementById('unlock'); if (o && o.classList.contains('visible')) { o.click(); return 'clicked'; } } return 'none'; })()`;
async function clickOverlay() {
	for (const t of await webviews()) {
		try {
			const s = await session(t.webSocketDebuggerUrl);
			await s.ev(OVERLAY, true);
			s.close();
		} catch {}
	}
}

// No scrollbars in the video (the maintainer): VS Code's own, and every webview's.
const HIDE_WORKBENCH = `(() => { if (document.getElementById('showcase-css')) return; const s = document.createElement('style'); s.id = 'showcase-css'; s.textContent = '.monaco-scrollable-element > .scrollbar, .monaco-scrollable-element > .shadow { display: none !important; }'; document.head.appendChild(s); })()`;
const HIDE_PAGE = `(() => { for (const d of [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument } catch { return null } })]) { if (!d || !d.head || d.getElementById('showcase-css')) continue; const s = d.createElement('style'); s.id = 'showcase-css'; s.textContent = '::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }'; d.head.appendChild(s); } })()`;
async function hideScrollbars() {
	await emulation?.ev(HIDE_WORKBENCH);
	for (const t of await webviews()) {
		try {
			const s = await session(t.webSocketDebuggerUrl);
			await s.ev(HIDE_PAGE);
			s.close();
		} catch {}
	}
}

// The window at 1920x1080, as far as the screen allows.
async function size() {
	const wb = await workbench();
	const browser = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
	const b = await session(browser);
	const w = await b.send('Browser.getWindowForTarget', { targetId: wb.id });
	if (w.result) await b.send('Browser.setWindowBounds', { windowId: w.result.windowId, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'normal' } });
	b.close();
}

/**
 * Where an element of a webview is in the window. A webview is an iframe in the workbench (found by the id in its
 * address), and holds an inner frame with the page; `find` runs in that page and returns a rect in it.
 */
async function inWebview(find, wb) {
	for (const t of await webviews()) {
		const id = new URL(t.url).searchParams.get('id');
		const s = await session(t.webSocketDebuggerUrl);
		const inner = await s.ev(`(() => {
			const frame = document.querySelector('iframe');
			const doc = frame ? frame.contentDocument : document;
			if (!doc) return null;
			const r = (${find})(doc);
			if (!r) return null;
			const f = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
			return { x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 };
		})()`);
		s.close();
		if (!inner) continue;
		const outer = await wb.ev(`(() => { const f = [...document.querySelectorAll('iframe')].find((f) => f.src.includes(${JSON.stringify(id)})); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
		if (outer) return { x: outer.x + inner.x, y: outer.y + inner.y };
	}
	return null;
}

const rectOf = (selector, text) => `(doc) => { const el = [...doc.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.trim().startsWith(${JSON.stringify(text)})` : 'true'}); return el ? el.getBoundingClientRect() : null; }`;

// The cursor: where it is, and every move and click with its time, for the composition to draw.
const cursor = { x: 960, y: 700 };
const cursorLog = [];
async function moveAndClick(wb, to, { double = false } = {}) {
	const from = { ...cursor };
	const ms = 700;
	cursorLog.push({ t: Date.now() / 1000, x: from.x, y: from.y, kind: 'from' });
	cursorLog.push({ t: Date.now() / 1000 + ms / 1000, x: to.x, y: to.y, kind: 'to' });
	await sleep(ms);
	Object.assign(cursor, to);
	// A double click with a person's gaps between the presses: sent back to back it was taken for one click once.
	for (const [type, clickCount, pause] of [['mouseMoved', 0, 30], ['mousePressed', 1, 60], ['mouseReleased', 1, 90], ...(double ? [['mousePressed', 2, 60], ['mouseReleased', 2, 0]] : [])]) {
		await wb.send('Input.dispatchMouseEvent', { type, x: to.x, y: to.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount });
		await sleep(pause);
	}
	cursorLog.push({ t: Date.now() / 1000, x: to.x, y: to.y, kind: double ? 'double' : 'click' });
	await sleep(250);
}

// Typing as a person does (the maintainer, 2026-11-22: "a normal human pace with some micro errors and delays"):
// 70 to 220 ms a key, longer after punctuation and spaces, a pause now and then to think, and about one key in
// twenty-five a neighbour on the keyboard, noticed, deleted and typed again.
const NEIGHBOURS = { a: 'sq', s: 'ad', d: 'sf', f: 'dg', l: 'k;', o: 'ip', i: 'uo', e: 'wr', r: 'et', t: 'ry', n: 'bm', c: 'xv', j: 'hk' };
const rand = (a, b) => a + Math.random() * (b - a);
async function key(wb, k) {
	const codes = { End: 35, Home: 36, Enter: 13, Backspace: 8 };
	const params = { key: k, code: k, windowsVirtualKeyCode: codes[k], nativeVirtualKeyCode: codes[k] };
	// CodeMirror acts on the key-down (Enter, Backspace, End); a `char` event too would type a second line break.
	await wb.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
	await wb.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
async function type(wb, text) {
	for (const ch of text) {
		const typo = NEIGHBOURS[ch] && Math.random() < 0.04;
		if (typo) {
			await wb.send('Input.insertText', { text: NEIGHBOURS[ch][Math.floor(Math.random() * NEIGHBOURS[ch].length)] });
			await sleep(rand(250, 550));
			await key(wb, 'Backspace');
			await sleep(rand(120, 260));
		}
		if (ch === '\n') await key(wb, 'Enter');
		else await wb.send('Input.insertText', { text: ch });
		// The maintainer asked for slightly faster than a first take's 70 to 220 ms.
		let wait = rand(45, 140);
		if (/[ (,.]/.test(ch)) wait += rand(20, 100);
		if (Math.random() < 0.04) wait += rand(250, 600);
		await sleep(wait);
	}
}
async function ctrlEnter(wb) {
	const params = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 };
	await wb.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
	await wb.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

/**
 * The camera's wishes, for the composition: at time t, show this part of the window. `full` is the whole window;
 * `editor`, `panel` and `sidebar` are VS Code's parts; `line` is a line of code that holds `text`, with air around it.
 */
const zoomLog = [];
async function zoom(wb, body) {
	let rect = null;
	if (body.region === 'line') {
		const at = await inWebview(`(doc) => { const l = [...doc.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(${JSON.stringify(body.text)})); return l ? l.getBoundingClientRect() : null; }`, wb);
		// `at` is the middle of the line's box, which spans the whole editor: the zoom starts where the code
		// starts, just right of the side bar and the gutter, or it cut the start of the line off.
		if (at) rect = { x: 360, y: at.y - 170, w: 900, h: 340 };
	} else if (body.region !== 'full') {
		const selector = { editor: '.part.editor', panel: '.part.panel', sidebar: '.part.sidebar' }[body.region];
		rect = await wb.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
	}
	zoomLog.push({ t: Date.now() / 1000, rect });
}

let recording = null;
let audioStart = 0;

async function startScreencast() {
	casting = true;
	lastFrame = Date.now() / 1000;
	await emulation.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: W, maxHeight: H });
	return { send: (method, params) => emulation.send(method, params), close: () => {} };
}

/** The engine page that plays the song: the webview whose hook's text is the song's. */
async function engine() {
	const head = readFileSync(join(repo, 'template', SONG), 'utf8').split('\n')[0];
	for (const t of await webviews()) {
		const s = await session(t.webSocketDebuggerUrl);
		const text = await s.ev(`(() => { const h = ${HOOK}; return h ? h.text().split('\\n')[0] : null })()`);
		if (text === head) return s;
		s.close();
	}
	return null;
}

/** The panel's top edge: 43% of the height, so the panel holds the Mixer's strips and its cables. */
const PANEL_TOP = Math.round(H * 0.43);

/** The bottom panel to about half the window, by its edge, as a person drags it: the Mixer shows whole. */
async function tallPanel(wb) {
	const panel = await wb.ev(`(() => { const p = document.querySelector('.part.panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top }; })()`);
	if (!panel) return;
	const y = panel.top - 2;
	await wb.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panel.x, y, button: 'none' });
	await wb.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: panel.x, y, button: 'left', clickCount: 1 });
	for (let i = 1; i <= 10; i++) {
		await wb.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panel.x, y: y + ((PANEL_TOP - y) * i) / 10, button: 'left' });
		await sleep(30);
	}
	await wb.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panel.x, y: PANEL_TOP, button: 'left', clickCount: 1 });
	await sleep(500);
}

async function opening() {
	const target = await workbench();
	const wb = await session(target.webSocketDebuggerUrl);
	await tallPanel(wb);
	const cast = await startScreencast();
	const videoStart = Date.now() / 1000;
	await sleep(1500);
	// 1. The [str]dltn icon in the activity bar.
	const icon = await wb.ev(`(() => { const a = [...document.querySelectorAll('.activitybar .action-item a, .activitybar .action-item')].find((e) => /dltn/i.test(e.getAttribute('aria-label') || '')); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	if (icon) await moveAndClick(wb, icon);
	await sleep(1500);
	// 2. Songs, in the Library's categories.
	const songs = await inWebview(rectOf('.nav-row', 'Songs'), wb);
	if (songs) await moveAndClick(wb, songs);
	await sleep(1500);
	// 3. The demo in the Results: a double click opens it. Once more if the editor did not come.
	const demo = await inWebview(rectOf('.row .label', SONG.replace(/\.strudel$/, '')), wb);
	for (let attempt = 0; demo && attempt < 2; attempt++) {
		await moveAndClick(wb, demo, { double: true });
		await sleep(4000);
		if (await engine()) break;
	}
	await sleep(1000);
	// 4. A click into the code: the editor's page may start sound after a click inside it.
	const code = await inWebview(rectOf('.cm-content'), wb);
	if (code) await moveAndClick(wb, { x: code.x, y: code.y - 120 });
	await sleep(800);
	// 5. Play, in Music Controls at the top of the Library. The engine records from the moment its output exists,
	// which is after Play; the demo's first bar is silent, so nothing is lost.
	const play = await inWebview(`(doc) => { const b = [...doc.querySelectorAll('button')].find((b) => /^play/i.test(b.title || '')); return b ? b.getBoundingClientRect() : null; }`, wb);
	if (play) await moveAndClick(wb, play);
	const e = await engine();
	for (let i = 0; e && i < 100 && !recording; i++) {
		const said = await e.ev(`${HOOK}.record.start()`);
		if (String(said).startsWith('recording')) {
			audioStart = Date.now() / 1000;
			recording = e;
			console.log('[song]', said);
		} else await sleep(50);
	}
	return { wb, cast, videoStart, found: { icon: !!icon, songs: !!songs, demo: !!demo, code: !!code, play: !!play, engine: !!e, recording: !!recording } };
}

let state;
process.on('unhandledRejection', (e) => console.log('[runner] error:', e?.stack ?? e));
try {
	// Wait for the window, size it, and for the driver to say the stage is set.
	while (!(await workbench())) await sleep(500);
	await sleep(2000);
	await size();
	await fullHd();
	const hiding = setInterval(() => void hideScrollbars().then(clickOverlay), 1500);
	const dog = setInterval(() => void watchdog(), 100);
	process.on('exit', () => (clearInterval(hiding), clearInterval(dog)));
	while (!existsSync(join(signals, 'ready'))) await sleep(200);
	state = await opening();
	console.log('[opening]', JSON.stringify(state.found));
	writeFileSync(join(signals, 'playing'), String(audioStart));
	// The driver plays the arrangement and the knobs; it asks for clicks on knob buttons.
	while (!existsSync(join(signals, 'finished'))) {
		for (const want of readdirSync(signals).filter((f) => f.endsWith('.click'))) {
			const body = JSON.parse(readFileSync(join(signals, want), 'utf8'));
			rmSync(join(signals, want));
			// A knob button left of the line that holds `text`, in the Strudel editor's gutter.
			const at = await inWebview(`(doc) => {
				const line = [...doc.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(${JSON.stringify(body.text)}));
				if (!line) return null;
				const y = line.getBoundingClientRect();
				const knob = [...doc.querySelectorAll('.strdltn-knob')].find((k) => { const r = k.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (y.top + y.height / 2)) < y.height / 2; });
				return knob ? knob.getBoundingClientRect() : null;
			}`, state.wb);
			if (at) await moveAndClick(state.wb, at);
			writeFileSync(join(signals, want.replace(/\.click$/, '.clicked')), at ? 'ok' : 'not found');
		}
		for (const want of readdirSync(signals).filter((f) => /\.(type|zoom|scroll)$/.test(f))) {
			const body = JSON.parse(readFileSync(join(signals, want), 'utf8'));
			rmSync(join(signals, want));
			if (want.endsWith('.zoom')) await zoom(state.wb, body);
			// A glide of the editor to a line, in the demo's page (its test hook's scrollTo).
			else if (want.endsWith('.scroll')) await recording?.ev(`${HOOK}.scrollTo(${JSON.stringify(body.text)}, ${body.ms ?? 3500})`);
			else {
				for (const k of body.before ?? []) await key(state.wb, k);
				await sleep(rand(300, 700));
				await type(state.wb, body.text);
				if (body.run) {
					await sleep(rand(400, 900));
					await ctrlEnter(state.wb);
				}
			}
			writeFileSync(join(signals, want + '.done'), 'ok');
		}
		await sleep(100);
	}
	if (existsSync(join(signals, 'error.txt'))) console.log('[driver]', readFileSync(join(signals, 'error.txt'), 'utf8'));
	if (existsSync(join(signals, 'driver.log'))) console.log(readFileSync(join(signals, 'driver.log'), 'utf8'));
} catch (error) {
	console.log('[runner] error:', error?.stack ?? error);
} finally {
	const videoEnd = Date.now() / 1000;
	if (state) {
		casting = false;
		await state.cast.send('Page.stopScreencast');
	}
	if (recording) {
		const { chunks, peak } = await recording.ev(`${HOOK}.record.stop()`);
		console.log(`[song] peak ${peak.toFixed(3)} of full scale (${(20 * Math.log10(peak)).toFixed(1)} dB), scaled to 0.95`);
		const parts = [];
		for (let i = 0; i < chunks; i++) {
			const part = await recording.ev(`${HOOK}.record.chunk(${i})`);
			if (typeof part !== 'string') throw new Error(`chunk ${i} of ${chunks} did not come: ${part}`);
			parts.push(Buffer.from(part, 'base64'));
		}
		writeFileSync(join(out, 'song.wav'), Buffer.concat(parts));
		recording.close();
		console.log('[song]', Math.round(Buffer.concat(parts).length / 1e6), 'MB');
	}
	writeFileSync(join(signals, 'collected'), '');
	if (state) {
		// The 30 fps grid: each frame shows the last repaint before its time.
		const frames = [];
		let k = 0;
		for (let i = 0; i < Math.round((videoEnd - state.videoStart) * FPS); i++) {
			const t = state.videoStart + i / FPS;
			while (k + 1 < shots.length && shots[k + 1].t <= t) k++;
			frames.push(shots[k]?.name ?? shots[0]?.name);
		}
		const dpr = await state.wb.ev('window.devicePixelRatio');
		writeFileSync(
			join(out, 'manifest.json'),
			JSON.stringify({
				fps: FPS,
				frames,
				audioOffset: audioStart - state.videoStart,
				dpr,
				window: await state.wb.ev('({ w: window.innerWidth, h: window.innerHeight })'),
				cursor: cursorLog.map((c) => ({ ...c, t: c.t - state.videoStart })),
				zoom: zoomLog.map((z) => ({ ...z, t: z.t - state.videoStart })),
			}),
		);
		console.log(`[take] ${shots.length} repaints, ${frames.length} frames, audio from ${(audioStart - state.videoStart).toFixed(2)} s`);
		state.wb.close();
	}
	emulation?.close();
	await sleep(1500);
	child.kill();
	// Windows may still hold the profile's files a moment after the window closed; a leftover in %TEMP% is harmless.
	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {}
}
