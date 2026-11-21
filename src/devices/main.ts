// The Devices view: one panel per firmware copy that plays, side by side as devices sit in a track of Live. Each panel
// shows the firmware's own display, its six soft keys and its parameters as knobs. The firmware runs in the engine's
// AudioWorklet; this page only draws what comes and sends back what the hand does. See "Devices" in
// doc/ARCHITECTURE.md.
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

interface Saved {
	/** Panels folded, by `<engine>/<key>`. Open is the default: a device that plays is what one wants to see. */
	folded: string[];
}
const saved = (vscode.getState() as Saved | undefined) ?? { folded: [] };
const folded = new Set(saved.folded);
const keep = () => vscode.setState({ folded: [...folded] } satisfies Saved);

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

window.addEventListener('message', (event: MessageEvent<ToDevices>) => {
	const message = event.data;
	if (message.type === 'devices') show(message.devices);
	else if (message.type === 'frame') paint(message);
});

// A hidden view stops the drawing; shown again, the open panels ask for frames again.
document.addEventListener('visibilitychange', () => {
	for (const panel of panels.values()) setDrawing(panel, !document.hidden && !folded.has(id(panel.device)));
});

function show(devices: ViewDevice[]): void {
	const wanted = new Set(devices.map(id));
	for (const [key, panel] of panels) {
		if (wanted.has(key)) continue;
		panel.root.remove();
		panels.delete(key);
	}
	for (const device of devices) {
		const key = id(device);
		const known = panels.get(key);
		if (known && sameParams(known.device.params, device.params)) {
			known.device = device;
			continue;
		}
		known?.root.remove();
		const panel = build(device);
		panels.set(key, panel);
		row.appendChild(panel.root);
		setDrawing(panel, !document.hidden && !folded.has(key));
	}
	empty.hidden = devices.length > 0;
	report();
}

function sameParams(a: DeviceParam[], b: DeviceParam[]): boolean {
	return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.min === b[i].min && p.max === b[i].max);
}

function setDrawing(panel: Panel, on: boolean): void {
	if (panel.drawing === on) return;
	panel.drawing = on;
	request(panel.device.engine, { action: 'draw', key: panel.device.key, on });
}

function build(device: ViewDevice): Panel {
	const key = id(device);
	const root = el('section', 'panel');
	root.classList.toggle('folded', folded.has(key));
	const head = root.appendChild(el('header'));
	const fold = head.appendChild(el('button', 'fold'));
	fold.title = 'Fold or unfold';
	head.appendChild(el('span', 'name', device.id.toUpperCase()));
	head.appendChild(el('span', 'where', `orbit ${device.orbit} · ${device.song}`));
	head.title = `${device.id} on orbit ${device.orbit}, played by ${device.song}`;

	const body = root.appendChild(el('div', 'body'));
	const screen = body.appendChild(el('div', 'screen'));
	const canvas = screen.appendChild(el('canvas'));
	canvas.width = W;
	canvas.height = H;
	canvas.title = 'The firmware\'s display. The wheel turns its DATA encoder.';
	const g = canvas.getContext('2d')!;
	const image = g.createImageData(W, H);
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

	const panel: Panel = { device, root, canvas, image, knobs, frames: 0, drawing: false };
	fold.addEventListener('click', () => {
		const now = !folded.has(key);
		if (now) folded.add(key);
		else folded.delete(key);
		keep();
		root.classList.toggle('folded', now);
		setDrawing(panel, !now && !document.hidden);
		report();
	});
	return panel;
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
	post({ type: 'state', panels: [...panels.values()].map((p) => ({ key: p.device.key, open: !folded.has(id(p.device)), frames: p.frames })) });
}

post({ type: 'ready' });
