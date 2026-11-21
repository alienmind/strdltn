// Captures the promo's scenes from a throwaway VS Code with the extension, and records the demo song from the engine.
//
//   node scripts/capture.mjs            the song and every scene
//   node scripts/capture.mjs song       only the song
//   node scripts/capture.mjs scenes     only the scenes
//   node scripts/capture.mjs 03-mixer   one scene
//
// The window is muted (--mute-audio): the song is taken from superdough's output by the engine's test hook
// (`record` in src/webview/main.ts), not from the speakers. Frames come from Chrome's screencast of the VS Code
// window, every repaint saved with its time and laid on a 30 fps grid: frame i shows the last repaint before i/30 s,
// as in MuseColor's capture. Writes tmp/promo/captures/<scene>/, captures/manifest.json and song/demo.wav.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const video = resolve(import.meta.dirname, '..');
const repo = resolve(video, '..');
const assets = join(repo, 'tmp', 'promo');
const config = JSON.parse(readFileSync(join(video, 'video.config.json'), 'utf8'));
const durations = JSON.parse(readFileSync(join(assets, 'voice', config.voice, 'durations.json'), 'utf8'));
const only = process.argv[2] ?? '';
// A scene lasts its line, plus the air before (the line starts 0.3 s in) and after.
const AIR = 0.3 + 0.7;
const sceneSeconds = Object.fromEntries(Object.entries(durations).map(([id, d]) => [id, Math.round((d + AIR) * 100) / 100]));

const exe = process.env.VSCODE_EXE ?? join(repo, '.vscode-test', readdirSync(join(repo, '.vscode-test')).find((d) => d.startsWith('vscode-win32')), 'Code.exe');
const profile = mkdtempSync(join(tmpdir(), 'promo-'));
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
	}),
);
const env = Object.fromEntries(Object.entries(process.env).filter(([n]) => !/^(ELECTRON_|VSCODE_)/.test(n)));
Object.assign(env, {
	PROMO_SIGNALS: signals,
	PROMO_WS: join(repo, 'template'),
	PROMO_ONLY: only,
	PROMO_SCENES: JSON.stringify(sceneSeconds),
	PROMO_SONG_SECONDS: String(config.songSeconds),
});
const PORT = 9345;
const child = spawn(exe, [
	`--remote-debugging-port=${PORT}`, '--mute-audio',
	`--extensionDevelopmentPath=${repo}`, `--extensionTestsPath=${join(video, 'scripts', 'driver.cjs')}`,
	`--user-data-dir=${join(profile, 'user')}`, `--extensions-dir=${join(profile, 'extensions')}`,
	'--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', join(repo, 'template'),
], { env, stdio: 'ignore' });

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
/** The test hook of the engine page inside a webview target, as scripts/test-vscode.mjs finds it. */
const HOOK = `(() => { for (const w of [window, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentWindow } catch { return null } })]) if (w && w.__strdltnTest) return w.__strdltnTest; })()`;
const OVERLAY = `(() => { for (const d of [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument } catch { return null } })]) { const o = d && d.getElementById('unlock'); if (o && o.classList.contains('visible')) { o.click(); return 'clicked'; } } return 'none'; })()`;

// The window at 1920x1080, as far as the screen allows. The frames are scaled to the video in the composition.
let sized = false;
async function size() {
	const wb = await workbench();
	if (!wb || sized) return;
	sized = true;
	const browser = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
	const b = await session(browser);
	const w = await b.send('Browser.getWindowForTarget', { targetId: wb.id });
	if (w.result) await b.send('Browser.setWindowBounds', { windowId: w.result.windowId, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'normal' } });
	b.close();
}

async function clickOverlay() {
	for (const t of (await targets()).filter((t) => t.url.includes('vscode-webview') && t.webSocketDebuggerUrl)) {
		const s = await session(t.webSocketDebuggerUrl);
		await s.ev(OVERLAY, true);
		s.close();
	}
}

/** The engine page that plays `file`: the webview whose hook's text has the song's title line. */
async function engineOf(file) {
	const head = readFileSync(join(repo, 'template', file), 'utf8').split('\n')[0];
	for (const t of (await targets()).filter((t) => t.url.includes('vscode-webview') && t.webSocketDebuggerUrl)) {
		const s = await session(t.webSocketDebuggerUrl);
		const text = await s.ev(`(() => { const h = ${HOOK}; return h ? h.text().split('\\n')[0] : null })()`);
		if (text === head) return s;
		s.close();
	}
	return undefined;
}

async function recordSong({ file, seconds }) {
	const engine = await engineOf(file);
	if (!engine) throw new Error(`no engine plays ${file}`);
	console.log('[song]', await engine.ev(`${HOOK}.record.start()`));
	await sleep(seconds * 1000);
	const { chunks, peak } = await engine.ev(`${HOOK}.record.stop()`);
	console.log(`[song] peak ${peak.toFixed(3)} of full scale (${(20 * Math.log10(peak)).toFixed(1)} dB), scaled to 0.95`);
	const parts = [];
	for (let i = 0; i < chunks; i++) parts.push(Buffer.from(await engine.ev(`${HOOK}.record.chunk(${i})`), 'base64'));
	engine.close();
	mkdirSync(join(assets, 'song'), { recursive: true });
	const out = join(assets, 'song', file.replace(/\.strudel$/, '.wav'));
	writeFileSync(out, Buffer.concat(parts));
	console.log('[song]', out, Math.round(Buffer.concat(parts).length / 1e6), 'MB');
}

async function recordScene(id, seconds) {
	const dir = join(assets, 'captures', id);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const wb = await workbench();
	const shots = [];
	let s;
	s = await session(wb.webSocketDebuggerUrl, (m) => {
		if (m.method !== 'Page.screencastFrame') return;
		const name = `r${String(shots.length).padStart(5, '0')}.jpg`;
		writeFileSync(join(dir, name), Buffer.from(m.params.data, 'base64'));
		shots.push({ name, t: m.params.metadata.timestamp });
		void s.send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
	});
	const first = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
	const start = Date.now() / 1000;
	writeFileSync(join(dir, 'r-first.jpg'), Buffer.from(first.result.data, 'base64'));
	await s.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
	await sleep(seconds * 1000);
	await s.send('Page.stopScreencast');
	s.close();
	// The 30 fps grid: each frame shows the last repaint before its time.
	const frames = [];
	for (let i = 0; i < Math.round(seconds * config.fps); i++) {
		const t = start + i / config.fps;
		let pick = 'r-first.jpg';
		for (const shot of shots) if (shot.t <= t) pick = shot.name;
		frames.push(pick);
	}
	console.log(`[scene] ${id}: ${shots.length} repaints, ${frames.length} frames`);
	return { seconds, frames };
}

const manifestFile = join(assets, 'captures', 'manifest.json');
mkdirSync(join(assets, 'captures'), { recursive: true });
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};

const loop = setInterval(async () => {
	await size();
	await clickOverlay();
}, 1000);

try {
	while (!existsSync(join(signals, 'finished'))) {
		for (const want of readdirSync(signals).filter((f) => f.endsWith('.want'))) {
			const name = want.replace(/\.want$/, '');
			const body = JSON.parse(readFileSync(join(signals, want), 'utf8'));
			rmSync(join(signals, want));
			try {
				if (name === 'song') await recordSong(body);
				else {
					manifest[name] = await recordScene(name, body.seconds);
					writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
				}
			} catch (error) {
				console.log(`[${name}] failed:`, error?.message ?? error);
			}
			writeFileSync(join(signals, `${name}.done`), 'ok');
		}
		await sleep(200);
	}
	if (existsSync(join(signals, 'error.txt'))) console.log('[driver]', readFileSync(join(signals, 'error.txt'), 'utf8'));
} finally {
	clearInterval(loop);
	await sleep(2000);
	child.kill();
	rmSync(profile, { recursive: true, force: true });
}
