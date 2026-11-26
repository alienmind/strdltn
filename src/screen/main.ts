// The firmware screen popup: one installed firmware, run here without sound, so its display can be seen before it goes
// into a song. The firmware runs on this page's own thread, not in an AudioWorklet: nothing is heard, so nothing needs
// to be on time. It renders as many frames as the clock says have passed (the firmware's menus and meters move as they
// would), then draws, about 30 times a second, and only while the tab is in sight. See "Firmware screen" in
// doc/ARCHITECTURE.md.
import './screen.css';
import { unzipSync } from 'fflate';
import type { FromScreen, ScreenFirmware, ToScreen } from '../shared/screen.ts';
import { VIBE_EV, VIBE_SCREEN, VibeCore } from '../webview/vibe/core.ts';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const post = (message: FromScreen) => vscode.postMessage(message);

const RATE = 48000;
const BLOCK = 128;
/** At most this much time is caught up after the tab was hidden, so coming back does not stall the page. */
const MAX_CATCH_UP = RATE / 10;
/** Ids of vibe.h: VB_F1..VB_F6 are 0..5, VE_DATA is 6. */
const VE_DATA = 6;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const app = document.getElementById('app')!;
const header = app.appendChild(el('header'));
const title = header.appendChild(el('h1'));
const meta = header.appendChild(el('div', 'meta'));
const actions = header.appendChild(el('div', 'actions'));
const insertButton = actions.appendChild(el('button', 'primary', 'Insert at the cursor'));
insertButton.title = 'Type a line that plays this firmware into the song';
const runButton = actions.appendChild(el('button', 'secondary', 'Pause'));
const description = app.appendChild(el('p', 'description'));
const stage = app.appendChild(el('div', 'stage'));
const canvas = stage.appendChild(el('canvas'));
canvas.width = VIBE_SCREEN.w;
canvas.height = VIBE_SCREEN.h;
canvas.title = 'Scroll to turn the data knob';
const keys = stage.appendChild(el('div', 'keys'));
const status = app.appendChild(el('div', 'status'));
const context2d = canvas.getContext('2d')!;
const image = context2d.createImageData(VIBE_SCREEN.w, VIBE_SCREEN.h);

let firmware: ScreenFirmware | undefined;
let core: VibeCore | undefined;
let frames = 0;
let running = true;
let last = 0;
let lastDraw = 0;
let error: string | undefined;
/** A newer firmware arrived while one was loading: the older load is dropped. */
let loading = 0;
const left = new Float32Array(BLOCK);
const right = new Float32Array(BLOCK);

for (let i = 0; i < 6; i++) {
	const key = keys.appendChild(el('button', 'key', `F${i + 1}`));
	key.title = `Soft key F${i + 1}, under the display`;
	// Down and up, as the device sends them: some firmwares act on release, or on a hold.
	key.addEventListener('pointerdown', () => control(VIBE_EV.BUTTON, i, 1));
	key.addEventListener('pointerup', () => control(VIBE_EV.BUTTON, i, 0));
	key.addEventListener('pointerleave', (event) => event.buttons && control(VIBE_EV.BUTTON, i, 0));
}
canvas.addEventListener(
	'wheel',
	(event) => {
		event.preventDefault();
		// One detent a notch, clockwise when scrolling up, as the Devices view does.
		control(VIBE_EV.ENCODER, VE_DATA, 0, event.deltaY < 0 ? 1 : -1);
	},
	{ passive: false },
);
insertButton.addEventListener('click', () => firmware && post({ type: firmware.available ? 'install' : 'insert', id: firmware.id }));
runButton.addEventListener('click', () => {
	running = !running;
	runButton.textContent = running ? 'Pause' : 'Run';
	last = performance.now();
	if (running) requestAnimationFrame(tick);
	showStatus();
});

function control(event: number, id: number, down: number, value = 0): void {
	core?.schedule({ frame: core.frame, kind: 'control', type: event, id, down, value });
}

window.addEventListener('message', (event: MessageEvent<ToScreen>) => {
	if (event.data?.type === 'firmware') void load(event.data.firmware);
});

async function load(next: ScreenFirmware): Promise<void> {
	const mine = ++loading;
	firmware = next;
	core = undefined;
	frames = 0;
	error = undefined;
	document.title = next.name;
	insertButton.textContent = next.available ? 'Install' : 'Insert at the cursor';
	insertButton.title = next.available ? 'Install it into the firmware folder of the project' : 'Type a line that plays this firmware into the song';
	title.textContent = next.name;
	meta.replaceChildren(
		...[next.version && `v${next.version.replace(/^v/i, '')}`, next.author, next.license, `vibefm1:${next.id}`]
			.filter((part): part is string => !!part)
			.map((part) => el('span', '', part)),
	);
	description.textContent = next.description ?? '';
	description.hidden = !next.description;
	context2d.clearRect(0, 0, canvas.width, canvas.height);
	showStatus('Loading...');
	try {
		const response = await fetch(next.url);
		if (!response.ok) throw new Error(`${response.status} for the firmware file`);
		const module = await WebAssembly.compile(wasmOf(new Uint8Array(await response.arrayBuffer())));
		if (mine !== loading) return;
		core = new VibeCore(module, RATE, { log: (text) => post({ type: 'log', message: `${next.id}: ${text.trim()}` }) });
		if (!hasDisplay(core)) throw new Error('this firmware draws no display');
		last = performance.now();
		showStatus();
		if (running) requestAnimationFrame(tick);
	} catch (cause) {
		if (mine !== loading) return;
		error = (cause as Error).message;
		showStatus();
		report();
	}
}

/** The firmware's .wasm: the file itself, or the first one in a package .zip, as the engine reads them (vibe/index.ts). */
function wasmOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const magic = String.fromCharCode(...bytes.subarray(0, 4));
	if (magic === '\0asm') return bytes as Uint8Array<ArrayBuffer>;
	if (magic.startsWith('PK')) {
		const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.wasm') && !f.name.endsWith('.aot.wasm') });
		const name = Object.keys(files).sort()[0];
		if (name) return files[name] as Uint8Array<ArrayBuffer>;
	}
	throw new Error('not a VIBE FM firmware: no .wasm in the file');
}

function hasDisplay(c: VibeCore): boolean {
	return c.draw() !== undefined;
}

function tick(now: number): void {
	const c = core;
	if (!c || !running) return;
	try {
		// The frames the clock says have passed, in blocks, as an audio thread would have asked for them.
		let owed = Math.min(MAX_CATCH_UP, Math.round(((now - last) / 1000) * RATE));
		last = now;
		while (owed >= BLOCK) {
			c.render(left, right);
			owed -= BLOCK;
		}
		if (now - lastDraw >= 33) {
			lastDraw = now;
			const px = c.draw();
			if (px) paint(px);
		}
	} catch (cause) {
		// A firmware that traps stays stopped, as it does in the engine.
		error = `the firmware stopped: ${(cause as Error).message}`;
		core = undefined;
		showStatus();
		report();
		return;
	}
	requestAnimationFrame(tick);
}

/** RGB565 to the canvas, as the Devices view paints it. */
function paint(px: Uint16Array): void {
	const rgba = new Uint32Array(image.data.buffer);
	for (let i = 0; i < px.length && i < rgba.length; i++) {
		const v = px[i];
		const r = (((v >> 11) & 31) * 255) / 31;
		const g = (((v >> 5) & 63) * 255) / 63;
		const b = ((v & 31) * 255) / 31;
		rgba[i] = 0xff000000 | (b << 16) | (g << 8) | r;
	}
	context2d.putImageData(image, 0, 0);
	frames++;
	if (frames === 1 || frames % 30 === 0) report();
}

function report(): void {
	if (firmware) post({ type: 'state', id: firmware.id, frames, params: core?.params.length ?? 0, ...(error ? { error } : {}) });
}

function showStatus(text?: string): void {
	status.classList.toggle('error', !!error);
	status.textContent =
		text ?? (error ? `Could not run: ${error}` : running ? 'Running here without sound. The soft keys and the scroll wheel work.' : 'Paused.');
}

post({ type: 'ready' });
