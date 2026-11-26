// The Devices view: one panel per firmware copy that plays, side by side as devices sit in a track of Live. Each panel
// shows the firmware's own display in a hardware bezel, its six soft keys, and its parameters as an SVG rotary arc
// knob grid with search and prefix auto-grouping (UX-6 UI). The firmware runs in the engine's AudioWorklet; this page
// only draws what comes and sends back what the hand does. See "Devices" in doc/ARCHITECTURE.md.
//
// One frame in flight per panel (spike F1): the page answers each frame with `painted` once it is on the canvas, and
// only then does the worklet send the next. In a Codespace that keeps the delay at one frame instead of seconds.
import './devices.css';
import type { DeviceParam, DeviceRequest, FromDevices, ToDevices, ViewDevice } from '../shared/devices.ts';
import {
	clampParamValue,
	filterDeviceParams,
	formatVpSliderSnippet,
	formatVpSnippet,
	type ParamGroupId,
	paramGroups,
} from '../shared/deviceParams.ts';

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
/** Above this parameter count, show the search bar and OSC/FLT/ENV/FX group pills. */
const GROUP_TOOLBAR_THRESHOLD = 8;

/** Rotary knob SVG arc geometry: 270 deg sweep from 135 deg (7:30) to 405 deg (4:30). */
const KNOB_CX = 22;
const KNOB_CY = 22;
const KNOB_R = 17;
const START_DEG = 135;
const SWEEP_DEG = 270;

interface Saved {
	/** Panels folded, by `<id>@<orbit>`: the same firmware on the same orbit stays folded in the next song or session. */
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

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
};

interface Knob {
	cell: HTMLElement;
	arc: SVGPathElement;
	needle: SVGLineElement;
	valueEl: HTMLElement;
	param: DeviceParam;
	current: number;
	/** True while the hand holds it: a frame's value does not pull it back. */
	held: boolean;
}

interface Panel {
	device: ViewDevice;
	root: HTMLElement;
	canvas: HTMLCanvasElement;
	image: ImageData;
	led: HTMLElement;
	ledTimer?: ReturnType<typeof setTimeout>;
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
/** What this page is, from the host: a tab with one device (`only`), the devices in tabs (`out`). */
let page: { only?: string; out: string[] } = { out: [] };
/** The panel that fills the view, by `<engine>/<key>`. */
let maximized: string | undefined;

// ---- lightweight knob context menu ------------------------------------------------------

let activeMenu: HTMLElement | undefined;
function closeMenu(): void {
	activeMenu?.remove();
	activeMenu = undefined;
}
window.addEventListener('pointerdown', (e) => {
	if (activeMenu && !activeMenu.contains(e.target as Node)) closeMenu();
});
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') closeMenu();
});
window.addEventListener('blur', closeMenu);

function openKnobMenu(event: MouseEvent, knob: Knob, onReset: () => void): void {
	event.preventDefault();
	closeMenu();
	const menu = document.body.appendChild(el('div', 'knob-menu'));
	const vp = formatVpSnippet(knob.param, knob.current);
	const vpSlider = formatVpSliderSnippet(knob.param, knob.current);

	const addItem = (label: string, run: () => void) => {
		const btn = menu.appendChild(el('button', 'knob-menu-item', label));
		btn.addEventListener('click', () => {
			closeMenu();
			run();
		});
	};
	addItem(`Copy ${vp}`, () => post({ type: 'copyText', text: vp }));
	addItem('Insert slider at cursor', () => post({ type: 'insertText', text: vpSlider }));
	menu.appendChild(el('div', 'knob-menu-sep'));
	addItem(`Reset to default (${format(knob.param, knob.param.def)})`, onReset);

	menu.style.left = '0px';
	menu.style.top = '0px';
	const rect = menu.getBoundingClientRect();
	const x = Math.min(event.clientX, Math.max(4, window.innerWidth - rect.width - 6));
	const y = Math.min(event.clientY, Math.max(4, window.innerHeight - rect.height - 6));
	menu.style.left = `${x}px`;
	menu.style.top = `${y}px`;
	activeMenu = menu;
}

// ---- SVG rotary arc math ----------------------------------------------------------------

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
	const rad = (deg * Math.PI) / 180;
	return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(startDeg: number, endDeg: number): string {
	const span = endDeg - startDeg;
	if (Math.abs(span) < 0.5) return '';
	const from = span >= 0 ? startDeg : endDeg;
	const to = span >= 0 ? endDeg : startDeg;
	const [x1, y1] = polar(KNOB_CX, KNOB_CY, KNOB_R, from);
	const [x2, y2] = polar(KNOB_CX, KNOB_CY, KNOB_R, to);
	const large = to - from > 180 ? 1 : 0;
	return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${KNOB_R} ${KNOB_R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const TRACK_ARC = arcPath(START_DEG, START_DEG + SWEEP_DEG);

function updateKnobVisual(knob: Knob, value: number): void {
	const { param } = knob;
	const lo = Math.min(param.min, param.max);
	const hi = Math.max(param.min, param.max);
	const span = hi - lo || 1;
	const norm = Math.max(0, Math.min(1, (value - lo) / span));
	const angle = START_DEG + norm * SWEEP_DEG;

	// Bipolar parameters (e.g. -1..1 pan/detune) sweep from 0 instead of min.
	const originDeg = lo < 0 && hi > 0 ? START_DEG + ((0 - lo) / span) * SWEEP_DEG : START_DEG;
	knob.arc.setAttribute('d', arcPath(originDeg, angle));

	const [nx1, ny1] = polar(KNOB_CX, KNOB_CY, 5, angle);
	const [nx2, ny2] = polar(KNOB_CX, KNOB_CY, 12.5, angle);
	knob.needle.setAttribute('x1', nx1.toFixed(2));
	knob.needle.setAttribute('y1', ny1.toFixed(2));
	knob.needle.setAttribute('x2', nx2.toFixed(2));
	knob.needle.setAttribute('y2', ny2.toFixed(2));
	knob.valueEl.textContent = format(param, value);
	knob.current = value;
	knob.cell.setAttribute('aria-valuenow', String(value));
}

function buildKnob(device: ViewDevice, param: DeviceParam): Knob {
	const cell = el('div', 'knob-cell');
	cell.tabIndex = 0;
	cell.setAttribute('role', 'slider');
	cell.setAttribute('aria-label', param.name || param.id);
	cell.setAttribute('aria-valuemin', String(param.min));
	cell.setAttribute('aria-valuemax', String(param.max));
	cell.title = `${param.name || param.id} (${param.id}) - Drag vertically, Shift+drag for fine, double-click to reset, right-click for code`;

	const dial = cell.appendChild(el('div', 'knob-dial'));
	const svg = svgEl('svg', { viewBox: '0 0 44 44', width: 42, height: 42, class: 'knob-svg' });
	svg.appendChild(svgEl('path', { d: TRACK_ARC, class: 'knob-track' }));
	const arc = svg.appendChild(svgEl('path', { d: '', class: 'knob-arc' }));
	svg.appendChild(svgEl('circle', { cx: KNOB_CX, cy: KNOB_CY, r: 12.5, class: 'knob-cap' }));
	const needle = svg.appendChild(svgEl('line', { class: 'knob-needle' }));
	dial.appendChild(svg);

	const nameEl = cell.appendChild(el('span', 'pname', param.name || param.id));
	nameEl.title = param.id;
	const valueEl = cell.appendChild(el('span', 'pvalue', format(param, param.def)));

	const knob: Knob = { cell, arc, needle, valueEl, param, current: param.def, held: false };
	updateKnobVisual(knob, param.def);

	const commit = (next: number) => {
		const clamped = clampParamValue(param, next);
		if (clamped === knob.current) return;
		updateKnobVisual(knob, clamped);
		request(device.engine, { action: 'param', key: device.key, index: param.index, value: clamped });
	};

	// Vertical drag with Shift fine-control (0.1x sensitivity).
	dial.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		dial.setPointerCapture(e.pointerId);
		knob.held = true;
		cell.classList.add('dragging');
		let lastY = e.clientY;
		let accum = knob.current;
		const span = Math.abs(param.max - param.min) || 1;
		const move = (ev: PointerEvent) => {
			const dy = lastY - ev.clientY;
			lastY = ev.clientY;
			const sensitivity = ev.shiftKey ? 0.1 : 1;
			accum = Math.max(Math.min(param.min, param.max), Math.min(Math.max(param.min, param.max), accum + (dy / 140) * span * sensitivity));
			commit(accum);
		};
		const end = () => {
			knob.held = false;
			cell.classList.remove('dragging');
			dial.removeEventListener('pointermove', move);
			dial.removeEventListener('pointerup', end);
			dial.removeEventListener('pointercancel', end);
		};
		dial.addEventListener('pointermove', move);
		dial.addEventListener('pointerup', end);
		dial.addEventListener('pointercancel', end);
	});

	// Double-click resets to firmware default.
	dial.addEventListener('dblclick', (e) => {
		e.preventDefault();
		commit(param.def);
	});

	// Mouse wheel increments smoothly; Shift+wheel is finer.
	cell.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			const span = Math.abs(param.max - param.min) || 1;
			const step = param.steps > 1 ? span / (param.steps - 1) : span * (e.shiftKey ? 0.005 : 0.025);
			commit(knob.current + (e.deltaY < 0 ? step : -step));
		},
		{ passive: false },
	);

	// Keyboard accessibility.
	cell.addEventListener('keydown', (e) => {
		const span = Math.abs(param.max - param.min) || 1;
		const step = param.steps > 1 ? span / (param.steps - 1) : span * (e.shiftKey ? 0.01 : 0.05);
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
			e.preventDefault();
			commit(knob.current + step);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
			e.preventDefault();
			commit(knob.current - step);
		} else if (e.key === 'Home') {
			e.preventDefault();
			commit(param.min);
		} else if (e.key === 'End') {
			e.preventDefault();
			commit(param.max);
		}
	});

	cell.addEventListener('contextmenu', (e) => openKnobMenu(e, knob, () => commit(param.def)));

	return knob;
}

// ---- messages & panel lifecycle ---------------------------------------------------------

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
	app.classList.toggle('maximized', !!maximized);
	report();
}

function show(): void {
	const list = page.only ? devices.filter((d) => id(d) === page.only) : devices;
	const wanted = new Set(list.map(id));
	for (const [key, panel] of panels) {
		if (wanted.has(key)) continue;
		clearTimeout(panel.ledTimer);
		panel.root.remove();
		panels.delete(key);
		if (maximized === key) maximized = undefined;
	}
	for (const device of list) {
		const key = id(device);
		const known = panels.get(key);
		if (known && sameParams(known.device.params, device.params)) {
			known.device = device;
			if (device.color) known.root.style.setProperty('--track-color', device.color);
			continue;
		}
		known?.root.remove();
		const panel = build(device);
		panels.set(key, panel);
		row.appendChild(panel.root);
	}
	empty.hidden = list.length > 0;
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

function pulseLed(panel: Panel): void {
	panel.led.classList.add('active');
	clearTimeout(panel.ledTimer);
	panel.ledTimer = setTimeout(() => panel.led.classList.remove('active'), 220);
}

/** The header of a panel: fold, owning chain swatch, name, where, and maximize and take out on the right. */
function header(root: HTMLElement, name: string, where: string, color: string | undefined, actions: { fold(): void; max(): void; out(): void }): HTMLElement {
	const head = root.appendChild(el('header'));
	const fold = head.appendChild(el('button', 'fold'));
	fold.title = 'Fold or unfold';
	fold.addEventListener('click', actions.fold);
	if (color) {
		root.style.setProperty('--track-color', color);
		head.appendChild(el('span', 'swatch'));
	}
	head.appendChild(el('span', 'name', name));
	head.appendChild(el('span', 'where', where));
	head.appendChild(el('span', 'gap'));
	const led = head.appendChild(el('span', 'activity-led'));
	led.title = 'Device active';
	head.appendChild(el('span', 'note', 'in a tab, unfold to bring it back'));
	const max = head.appendChild(el('button', 'max-button', '\u2922'));
	max.title = 'Fill the view, or back';
	max.addEventListener('click', actions.max);
	const out = head.appendChild(el('button', 'out-button', '\u2197'));
	out.title = 'Take out into an editor tab';
	out.addEventListener('click', actions.out);
	return led;
}

function build(device: ViewDevice): Panel {
	const key = id(device);
	const root = el('section', 'panel');
	root.title = `${device.id} on orbit ${device.orbit}, played by ${device.song}`;

	const where = [device.chainName, `orbit ${device.orbit}`, device.song].filter(Boolean).join(' - ');
	const led = header(root, device.id.toUpperCase(), where, device.color, {
		fold: () => {
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

	const body = root.appendChild(el('div', 'body'));

	// Hardware display bezel + aligned tactile F1-F6 soft keys
	const screen = body.appendChild(el('div', 'screen'));
	const bezel = screen.appendChild(el('div', 'bezel'));
	const canvas = bezel.appendChild(el('canvas'));
	canvas.width = W;
	canvas.height = H;
	canvas.title = "The firmware's display. Scroll wheel turns its DATA encoder.";
	const image = canvas.getContext('2d')!.createImageData(W, H);

	const keys = screen.appendChild(el('div', 'keys'));
	for (let i = 0; i < 6; i++) {
		const button = keys.appendChild(el('button', 'key', `F${i + 1}`));
		button.addEventListener('pointerdown', (e) => {
			button.setPointerCapture(e.pointerId);
			button.classList.add('pressed');
			led.classList.add('active');
			request(device.engine, { action: 'control', key: device.key, event: BUTTON, id: i, down: 1, value: 0 });
		});
		const up = () => {
			button.classList.remove('pressed');
			request(device.engine, { action: 'control', key: device.key, event: BUTTON, id: i, down: 0, value: 0 });
		};
		button.addEventListener('pointerup', up);
		button.addEventListener('pointercancel', up);
	}
	canvas.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			request(device.engine, { action: 'control', key: device.key, event: ENCODER, id: VE_DATA, down: 0, value: e.deltaY < 0 ? 1 : -1 });
		},
		{ passive: false },
	);

	// SVG rotary arc knob grid + parameter search & auto-grouping for large synths
	const knobs = new Map<number, Knob>();
	if (device.params.length) {
		const paramsPane = body.appendChild(el('div', 'params-pane'));
		let activeGroup: ParamGroupId | 'ALL' = 'ALL';
		let query = '';

		const knobCells = new Map<number, HTMLElement>();
		for (const param of device.params) {
			const knob = buildKnob(device, param);
			knobs.set(param.index, knob);
			knobCells.set(param.index, knob.cell);
		}

		const grid = el('div', 'params');
		const emptyFilter = el('div', 'params-empty', 'No parameters match.');
		emptyFilter.hidden = true;

		const applyFilter = () => {
			const visibleParams = filterDeviceParams(device.params, activeGroup, query);
			const visibleSet = new Set(visibleParams.map((p) => p.index));
			for (const [idx, cell] of knobCells) {
				cell.hidden = !visibleSet.has(idx);
			}
			emptyFilter.hidden = visibleParams.length > 0;
		};

		if (device.params.length > GROUP_TOOLBAR_THRESHOLD) {
			const toolbar = paramsPane.appendChild(el('div', 'params-toolbar'));
			const searchRow = toolbar.appendChild(el('div', 'params-search'));
			const searchInput = searchRow.appendChild(el('input'));
			searchInput.placeholder = `Search ${device.params.length} params...`;
			searchInput.spellcheck = false;
			const clearBtn = searchRow.appendChild(el('button', 'params-clear', '\u00d7'));
			clearBtn.title = 'Clear filter';
			clearBtn.hidden = true;
			clearBtn.addEventListener('click', () => {
				query = '';
				searchInput.value = '';
				clearBtn.hidden = true;
				applyFilter();
			});
			searchInput.addEventListener('input', () => {
				query = searchInput.value;
				clearBtn.hidden = !query;
				applyFilter();
			});

			const groups = paramGroups(device.params);
			if (groups.length > 1) {
				const tabs = toolbar.appendChild(el('div', 'param-groups'));
				const buttons: { id: ParamGroupId | 'ALL'; node: HTMLButtonElement }[] = [];
				const addTab = (gid: ParamGroupId | 'ALL', label: string) => {
					const btn = tabs.appendChild(el('button', `pg-pill${gid === 'ALL' ? ' on' : ''}`, label));
					btn.addEventListener('click', () => {
						activeGroup = gid;
						for (const item of buttons) item.node.classList.toggle('on', item.id === activeGroup);
						applyFilter();
					});
					buttons.push({ id: gid, node: btn });
				};
				addTab('ALL', `All (${device.params.length})`);
				for (const g of groups) addTab(g.id, `${g.id} ${g.count}`);
			}
		}

		paramsPane.appendChild(grid);
		for (const param of device.params) {
			grid.appendChild(knobCells.get(param.index)!);
		}
		grid.appendChild(emptyFilter);
	}

	return { device, root, canvas, image, led, knobs, frames: 0, drawing: false };
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
		const r = (((v >> 11) & 31) * 255) / 31;
		const gr = (((v >> 5) & 63) * 255) / 63;
		const b = ((v & 31) * 255) / 31;
		rgba[i] = 0xff000000 | (b << 16) | (gr << 8) | r;
	}
	panel.canvas.getContext('2d')!.putImageData(panel.image, 0, 0);
	for (const [index, knob] of panel.knobs) {
		const v = message.values[index];
		if (knob.held || v === undefined || Number.isNaN(v)) continue;
		if (Math.abs(v - knob.current) > 1e-6) updateKnobVisual(knob, v);
	}
	panel.frames++;
	pulseLed(panel);
	if (panel.drawing) request(message.engine, { action: 'painted', key: message.key });
	if (panel.frames === 1 || panel.frames % 60 === 0) report();
}

function report(): void {
	post({ type: 'state', panels: [...panels.values()].map((p) => ({ key: p.device.key, open: visible(p), frames: p.frames })) });
}

post({ type: 'ready' });
