// The Devices view: one panel per firmware copy that plays, side by side as devices sit in a track of Live. Each panel
// shows the firmware's own display, its six soft keys and its parameters as knobs. The firmware runs in the engine's
// AudioWorklet; this page only draws what comes and sends back what the hand does. See "Devices" in
// doc/ARCHITECTURE.md. The same page, with one device, is the tab a panel is taken out into.
//
// One frame in flight per panel (spike F1): the page answers each frame with `painted` once it is on the canvas, and
// only then does the worklet send the next. In a Codespace that keeps the delay at one frame instead of seconds.
import './devices.css';
import type { DeviceParam, DeviceRequest, FromDevices, ToDevices, ViewDevice } from '../shared/devices.ts';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const post = (message: FromDevices) => vscode.postMessage(message);
const request = (engine: string, r: DeviceRequest) => post({ type: 'request', engine, ...r });

/** VIBE_SCREEN_W x VIBE_SCREEN_H of vibe.h. */
const W = 480;
const H = 320;
/** Ids of vibe.h: VIBE_EV_BUTTON with VB_F1..VB_F6 (0..5), VIBE_EV_ENCODER with VE_DATA (6). */
const BUTTON = 3;
const ENCODER = 4;
const VE_DATA = 6;
const SHRUB_URL = 'https://shrub.audio/editor/';

interface Saved {
	/** Panels folded, by `<id>@<orbit>`: the same firmware on the same orbit stays folded in the next song or session. */
	folded: string[];
	shrubFolded?: boolean;
}
const saved = (vscode.getState() as Saved | undefined) ?? { folded: [] };
const folded = new Set(saved.folded);
let shrubFolded = !!saved.shrubFolded;
const keep = () => vscode.setState({ folded: [...folded], shrubFolded } satisfies Saved);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

interface Knob {
	input: HTMLInputElement;
	value: HTMLElement;
	param: DeviceParam;
	/** True while the hand holds it: a frame's value does not pull it back. */
	held: boolean;
}

interface Panel {
	device: ViewDevice;
	root: HTMLElement;
	canvas: HTMLCanvasElement;
	image: ImageData;
	knobs: Map<number, Knob>;
	frames: number;
	drawing: boolean;
}

const app = document.getElementById('app')!;
const empty = app.appendChild(el('div', 'empty', 'No firmware plays. A song with s("vibefm1:<id>") shows its device here while it plays.'));
const row = app.appendChild(el('div', 'panels'));
const panels = new Map<string, Panel>();
const id = (d: { engine: string; key: string }) => `${d.engine}/${d.key}`;
let devices: ViewDevice[] = [];
/** What this page is, from the host: a tab with one device (`only`), the devices in tabs (`out`), SHRUB on. */
let page: { only?: string; out: string[]; shrub: boolean } = { out: [], shrub: false };
/** The panel that fills the view, by `<engine>/<key>`, or 'shrub'. */
let maximized: string | undefined;
let shrub: HTMLElement | undefined;

window.addEventListener('message', (event: MessageEvent<ToDevices>) => {
	const message = event.data;
	if (message.type === 'devices') {
		devices = message.devices;
		show();
	} else if (message.type === 'page') {
		page = message;
		app.classList.toggle('tab', !!page.only);
		show();
	} else if (message.type === 'frame') paint(message);
});

// A hidden view stops the drawing; shown again, the open panels ask for frames again.
document.addEventListener('visibilitychange', refresh);

/** A panel draws while it can be seen: not folded, not in a tab, the page shown, and not behind a maximized one. */
function visible(panel: Panel): boolean {
	const key = id(panel.device);
	if (document.hidden) return false;
	if (page.only) return page.only === key;
	if (page.out.includes(key) || folded.has(panel.device.key)) return false;
	return !maximized || maximized === key;
}

function refresh(): void {
	for (const [key, panel] of panels) {
		panel.root.classList.toggle('folded', !page.only && folded.has(panel.device.key));
		panel.root.classList.toggle('out', !page.only && page.out.includes(key));
		panel.root.classList.toggle('max', maximized === key);
		setDrawing(panel, visible(panel));
	}
	shrub?.classList.toggle('folded', shrubFolded);
	shrub?.classList.toggle('max', maximized === 'shrub');
	app.classList.toggle('maximized', !!maximized);
	report();
}

function show(): void {
	const list = page.only ? devices.filter((d) => id(d) === page.only) : devices;
	const wanted = new Set(list.map(id));
	for (const [key, panel] of panels) {
		if (wanted.has(key)) continue;
		panel.root.remove();
		panels.delete(key);
		if (maximized === key) maximized = undefined;
	}
	for (const device of list) {
		const key = id(device);
		const known = panels.get(key);
		if (known && sameParams(known.device.params, device.params)) {
			known.device = device;
			continue;
		}
		known?.root.remove();
		const panel = build(device);
		panels.set(key, panel);
		row.insertBefore(panel.root, shrub ?? null);
	}
	showShrub(page.shrub && !page.only);
	empty.hidden = list.length > 0 || !!shrub;
	refresh();
}

function sameParams(a: DeviceParam[], b: DeviceParam[]): boolean {
	return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.min === b[i].min && p.max === b[i].max);
}

function setDrawing(panel: Panel, on: boolean): void {
	if (panel.drawing === on) return;
	panel.drawing = on;
	request(panel.device.engine, { action: 'draw', key: panel.device.key, on });
}

/** The header of a panel: fold, name, where, and maximize and take out on the right. */
function header(root: HTMLElement, name: string, where: string, actions: { fold(): void; max(): void; out(): void }): void {
	const head = root.appendChild(el('header'));
	const fold = head.appendChild(el('button', 'fold'));
	fold.title = 'Fold or unfold';
	fold.addEventListener('click', actions.fold);
	head.appendChild(el('span', 'name', name));
	head.appendChild(el('span', 'where', where));
	head.appendChild(el('span', 'gap'));
	head.appendChild(el('span', 'note', 'in a tab, unfold to bring it back'));
	const max = head.appendChild(el('button', 'max-button', '⤢'));
	max.title = 'Fill the view, or back';
	max.addEventListener('click', actions.max);
	const out = head.appendChild(el('button', 'out-button', '↗'));
	out.title = 'Take out into an editor tab';
	out.addEventListener('click', actions.out);
}

function build(device: ViewDevice): Panel {
	const key = id(device);
	const root = el('section', 'panel');
	root.title = `${device.id} on orbit ${device.orbit}, played by ${device.song}`;
	const body = el('div', 'body');
	const screen = body.appendChild(el('div', 'screen'));
	const canvas = screen.appendChild(el('canvas'));
	canvas.width = W;
	canvas.height = H;
	canvas.title = 'The firmware\'s display. The wheel turns its DATA encoder.';
	const image = canvas.getContext('2d')!.createImageData(W, H);
	const keys = screen.appendChild(el('div', 'keys'));
	for (let i = 0; i < 6; i++) {
		const button = keys.appendChild(el('button', 'key', `F${i + 1}`));
		button.addEventListener('pointerdown', (e) => {
			button.setPointerCapture(e.pointerId);
			request(device.engine, { action: 'control', key: device.key, event: BUTTON, id: i, down: 1, value: 0 });
		});
		const up = () => request(device.engine, { action: 'control', key: device.key, event: BUTTON, id: i, down: 0, value: 0 });
		button.addEventListener('pointerup', up);
		button.addEventListener('pointercancel', up);
	}
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			// One notch is one detent. Up is clockwise, as on a knob under the thumb.
			request(device.engine, { action: 'control', key: device.key, event: ENCODER, id: VE_DATA, down: 0, value: e.deltaY < 0 ? 1 : -1 });
		},
		{ passive: false },
	);

	const knobs = new Map<number, Knob>();
	if (device.params.length) {
		const grid = body.appendChild(el('div', 'params'));
		for (const param of device.params) {
			const cell = grid.appendChild(el('label', 'param'));
			cell.appendChild(el('span', 'pname', param.name || param.id)).title = param.id;
			const value = cell.appendChild(el('span', 'pvalue', format(param, param.def)));
			const input = cell.appendChild(el('input'));
			input.type = 'range';
			input.min = String(param.min);
			input.max = String(param.max);
			input.step = param.steps > 1 ? String((param.max - param.min) / (param.steps - 1)) : 'any';
			input.value = String(param.def);
			const knob: Knob = { input, value, param, held: false };
			input.addEventListener('pointerdown', () => (knob.held = true));
			input.addEventListener('pointerup', () => (knob.held = false));
			input.addEventListener('input', () => {
				const v = Number(input.value);
				value.textContent = format(param, v);
				request(device.engine, { action: 'param', key: device.key, index: param.index, value: v });
			});
			knobs.set(param.index, knob);
		}
	}

	header(root, device.id.toUpperCase(), `orbit ${device.orbit} - ${device.song}`, {
		fold: () => {
			// A panel in a tab comes back by unfolding: this page draws it again, and the tab stops getting frames.
			if (page.out.includes(key)) page = { ...page, out: page.out.filter((k) => k !== key) };
			else if (folded.has(device.key)) folded.delete(device.key);
			else folded.add(device.key);
			keep();
			refresh();
		},
		max: () => {
			maximized = maximized === key ? undefined : key;
			refresh();
		},
		out: () => post({ type: 'takeOut', engine: device.engine, key: device.key }),
	});
	root.appendChild(body);
	return { device, root, canvas, image, knobs, frames: 0, drawing: false };
}

/**
 * The SHRUB editor (Xfer's site) as a panel, behind the setting strdltn.experimental.shrubEditor. It is its own synth:
 * its sound is not in our mix. Folded, it is hidden with CSS and not removed, so its unsaved patches stay.
 */
function showShrub(on: boolean): void {
	if (!on) {
		shrub?.remove();
		shrub = undefined;
		if (maximized === 'shrub') maximized = undefined;
		return;
	}
	if (shrub) return;
	shrub = row.appendChild(el('section', 'panel shrub'));
	header(shrub, 'SHRUB', 'Xfer, its own sound, not in the mix', {
		fold: () => {
			shrubFolded = !shrubFolded;
			keep();
			refresh();
		},
		max: () => {
			maximized = maximized === 'shrub' ? undefined : 'shrub';
			refresh();
		},
		out: () => post({ type: 'takeOutShrub' }),
	});
	const body = shrub.appendChild(el('div', 'body'));
	const frame = body.appendChild(el('iframe'));
	frame.src = SHRUB_URL;
	frame.allow = 'autoplay';
	frame.title = 'SHRUB editor';
}

function format(param: DeviceParam, v: number): string {
	const n = param.steps > 1 || Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2);
	return param.unit ? `${n} ${param.unit}` : n;
}

/** RGB565 to the canvas, then `painted` so the next frame may come. */
function paint(message: Extract<ToDevices, { type: 'frame' }>): void {
	const panel = panels.get(id(message));
	if (!panel) return;
	const px = new Uint16Array(message.px.buffer, message.px.byteOffset, message.px.byteLength >> 1);
	const rgba = new Uint32Array(panel.image.data.buffer);
	for (let i = 0; i < px.length && i < rgba.length; i++) {
		const v = px[i];
		const r = ((v >> 11) & 31) * 255 / 31, gr = ((v >> 5) & 63) * 255 / 63, b = (v & 31) * 255 / 31;
		rgba[i] = 0xff000000 | (b << 16) | (gr << 8) | r;
	}
	panel.canvas.getContext('2d')!.putImageData(panel.image, 0, 0);
	for (const [index, knob] of panel.knobs) {
		const v = message.values[index];
		if (knob.held || v === undefined || Number.isNaN(v)) continue;
		knob.input.value = String(v);
		knob.value.textContent = format(knob.param, v);
	}
	panel.frames++;
	if (panel.drawing) request(message.engine, { action: 'painted', key: message.key });
	if (panel.frames === 1 || panel.frames % 60 === 0) report();
}

function report(): void {
	post({ type: 'state', panels: [...panels.values()].map((p) => ({ key: p.device.key, open: visible(p), frames: p.frames })) });
}

post({ type: 'ready' });
