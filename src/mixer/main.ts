// The Mixer: one strip per chain, side by side as in the Session view of
// Live, with the sliders as faders and the sidechain as cables. The host sends the model
// it read from the code; this page draws it and keeps which strips are unfolded. See
// "Mixer panel" in doc/DAW-PLAN.md.
//
// A fader changes the sound at once and the number in the code after a moment. M, S, G,
// the scope boxes and the cables are edits the host carries out. Play, Stop and BPM are
// in Music Controls, at the top of the Library (src/browser/controls.ts).
import './mixer.css';
import type { MixerChain, MixerModel, MixerSlider } from '../shared/chains.ts';
import type { FromMixer, ToMixer } from '../shared/mixer.ts';
import type { ScopeFrame } from '../shared/protocol.ts';
import { type CableSpec, CableLayer } from './cables.ts';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const post = (message: FromMixer) => vscode.postMessage(message);

interface Saved {
	/** Strips unfolded, by name. A name, not an index: a chain added above must not unfold another. */
	unfolded: string[];
}
const saved = (vscode.getState() as Saved | undefined) ?? { unfolded: [] };
const unfolded = new Set(saved.unfolded);
const keep = () => vscode.setState({ unfolded: [...unfolded] } satisfies Saved);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const app = document.getElementById('app')!;
app.insertAdjacentHTML('beforeend', jackSymbols());
const bar = app.appendChild(el('div', 'bar'));
const songName = bar.appendChild(el('span', 'song'));
const staleNote = bar.appendChild(el('span', 'stale', 'code does not parse, showing the last good state'));
// Left of the strips, a column of utility buttons, written upright to stay narrow (the
// maintainer, 2026-11-22). More will come here.
const main = app.appendChild(el('div', 'main'));
const tools = main.appendChild(el('div', 'tools'));
const tool = (text: string, title: string, onClick?: () => void) => {
	const button = tools.appendChild(el('button', 'tool', text));
	button.title = title;
	if (onClick) button.addEventListener('click', onClick);
	else button.disabled = true;
	return button;
};
const resetMappings = tool('Reset MIDI Mappings', 'Take every .knob(...) and the knob snippet out of the song. Ctrl+Z in the editor brings them back', () => post({ type: 'unmapKnobs' }));
tool('Show MIDI Mappings', 'Every knob mapped in this song: its CC and the line it moves', () => showMappings(true));
tool('Show MIDI Routing', 'The cables that route MIDI instruments. Not built yet (doc/TODO.md)');
const strips = main.appendChild(el('div', 'strips'));
const cables = new CableLayer(strips);

let song: string | undefined;
/** The slider waiting for a CC (its knob button is red), by where its number starts. */
let learningFrom: number | undefined;
let model: MixerModel | undefined;
let error: string | undefined;
/**
 * A fader is held. The model that comes back after each write would redraw the strips
 * and pull the fader out from under the pointer, so it waits until the fader is let go.
 */
let dragging = false;
let drawLater = false;
const release = () => {
	dragging = false;
	if (drawLater) {
		drawLater = false;
		draw();
	}
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

/**
 * The number as it goes into the code: rounded to the step, so a drag writes `0.607` and
 * not `0.6070000000000001`. The step is the slider's own, or a thousandth of its range,
 * which is what upstream's slider uses.
 */
function formatValue(value: number, slider: MixerSlider): string {
	const step = slider.step ?? (slider.max - slider.min) / 1000;
	const decimals = step > 0 ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)))) : 3;
	return String(Number(value.toFixed(decimals)));
}

window.addEventListener('message', (event: MessageEvent<ToMixer>) => {
	const message = event.data;
	switch (message.type) {
		case 'model':
			song = message.song;
			model = message.model;
			error = message.error;
			if (dragging) drawLater = true;
			else draw();
			if (mappings) showMappings(true);
			break;
		case 'playing':
			if (!message.on) clearScopes();
			break;
		case 'knobLearning':
			learningFrom = message.from;
			for (const button of strips.querySelectorAll<HTMLElement>('.fader .knob[data-from]')) button.classList.toggle('learning', Number(button.dataset.from) === learningFrom);
			break;
		case 'sliderLive': {
			// Not while a fader is held: that move is the one coming back.
			const slider = !dragging && model?.sliders.find((s) => s.from === message.from);
			if (!slider) break;
			for (const input of strips.querySelectorAll<HTMLInputElement>(`input[data-slider="${slider.index}"]`)) input.value = String(message.value);
			for (const out of strips.querySelectorAll(`output[data-slider="${slider.index}"]`)) out.textContent = formatValue(message.value, slider);
			break;
		}
		case 'scopes':
			drawScopes(message.scopes);
			break;
		case 'show':
			unfolded.clear();
			message.unfold.forEach((name) => unfolded.add(name));
			keep();
			draw();
			break;
	}
});

/**
 * "Show MIDI Mappings": a modal list, as Live's MIDI Mappings: per knob its CC and the line
 * of code it moves, with Remove (the same as a second click on the knob button). It follows
 * the song while open.
 */
let mappings: HTMLElement | undefined;
function showMappings(open: boolean): void {
	mappings?.remove();
	mappings = undefined;
	if (!open) return;
	const back = app.appendChild(el('div', 'modal-back'));
	mappings = back;
	back.addEventListener('click', (event) => event.target === back && showMappings(false));
	const box = back.appendChild(el('div', 'modal'));
	const head = box.appendChild(el('div', 'modal-head'));
	head.appendChild(el('span', 'title', 'MIDI Mappings'));
	const close = head.appendChild(el('button', 'close', '\u00d7'));
	close.title = 'Close (Esc)';
	close.addEventListener('click', () => showMappings(false));
	const mapped = (model?.sliders ?? []).filter((s) => s.knob !== undefined);
	if (!mapped.length) {
		box.appendChild(el('div', 'note', 'No knob is mapped in this song. Click the knob button under a fader, or left of a line with a slider, then turn a knob.'));
		return;
	}
	const table = box.appendChild(el('table', 'mappings'));
	const header = table.appendChild(el('tr'));
	for (const name of ['CC', 'Line', 'Code', '']) header.appendChild(el('th', '', name));
	for (const slider of mapped) {
		const row = table.appendChild(el('tr'));
		row.appendChild(el('td', 'cc', String(slider.knob)));
		row.appendChild(el('td', 'line', slider.line === undefined ? '' : String(slider.line)));
		row.appendChild(el('td', 'code', slider.code ?? '')).title = slider.code ?? '';
		const remove = row.appendChild(el('td')).appendChild(el('button', 'remove', 'Remove'));
		remove.title = `Take .knob(${slider.knob}) off this slider`;
		remove.addEventListener('click', () => post({ type: 'knob', index: slider.index }));
	}
}
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && mappings) showMappings(false);
});

function draw(): void {
	songName.textContent = song ?? 'No song';
	resetMappings.disabled = !model?.sliders.some((s) => s.knob !== undefined);
	staleNote.hidden = !error;
	staleNote.title = error ?? '';
	strips.classList.toggle('old', !!error);
	strips.querySelectorAll('.strip, .empty').forEach((node) => node.remove());
	strips.appendChild(masterStrip(model));
	if (!model) {
		strips.appendChild(el('div', 'empty', song ? '' : 'Open a .strudel file to see its chains here.'));
		cables.set([]);
		return report();
	}
	if (!model.chains.length && !model.global.length) strips.appendChild(el('div', 'empty', 'This song has no chains. A chain is a line that starts with $: or name:'));

	const ducked = new Set(model.ducks.map((duck) => duck.to).filter((to) => to !== undefined));
	const jacks: { out: Element[]; in: Element[] } = { out: [], in: [] };
	model.chains.forEach((chain, index) => {
		const { strip, out, input } = chainStrip(model!, chain, index, ducked.has(index));
		jacks.out[index] = out!;
		jacks.in[index] = input!;
		strips.appendChild(strip);
	});
	outJacks = jacks.out;
	drawnCables = model.ducks
		.filter((duck) => duck.to !== undefined && jacks.out[duck.from] && jacks.in[duck.to])
		.map((duck) => ({ key: cableKey(duck.from, duck.to!, duck.orbit), from: jacks.out[duck.from], to: jacks.in[duck.to!], kind: 'sidechain', label: `orbit ${duck.orbit}` }));
	drawCables();
	report();
}

// ---- scopes -----------------------------------------------------------------------------

let scopesIdle: ReturnType<typeof setTimeout> | undefined;

/** The last levels of each chain, newest last: the pump meter scrolls them from right to left. */
const HISTORY = 48;
const histories = new Map<string, number[]>();

/** The strip of a chain by the label its notes carry: `$kick`, `$#1` for the second `$:`, empty for a bare song. */
function chainOf(label: string): number {
	if (!model) return -1;
	const anonymous = /^\$#(\d+)$/.exec(label);
	if (anonymous) return model.chains.map((chain, index) => (chain.label === '$' ? index : -1)).filter((index) => index >= 0)[Number(anonymous[1])] ?? -1;
	return model.chains.findIndex((chain) => chain.label === label);
}

/** Each chain's level joins its history, and the boxes of chains with `._scope()` draw it. */
function drawScopes(frames: ScopeFrame[]): void {
	if (!model) return;
	feedMeters(frames);
	for (const frame of frames) {
		if (frame.chain === '@master') continue;
		const history = histories.get(frame.chain) ?? [];
		history.push(frame.level);
		if (history.length > HISTORY) history.shift();
		histories.set(frame.chain, history);
		const chain = chainOf(frame.chain);
		if (chain < 0 || !model.chains[chain].scope) continue;
		const canvas = strips.querySelector<HTMLCanvasElement>(`canvas.scope[data-chain="${chain}"]`);
		if (canvas) drawWave(canvas, history);
	}
	// No frames for a while (stopped): the lines go flat.
	clearTimeout(scopesIdle);
	scopesIdle = setTimeout(clearScopes, 500);
}

/** A pump line: the level over the last seconds, from the bottom up. A flat line when there is none. */
function drawWave(canvas: HTMLCanvasElement, history: number[]): void {
	if (!canvas.isConnected) return;
	const style = getComputedStyle(canvas);
	const width = (canvas.width = Math.max(1, canvas.clientWidth * devicePixelRatio));
	const height = (canvas.height = Math.max(1, canvas.clientHeight * devicePixelRatio));
	const g = canvas.getContext('2d')!;
	g.clearRect(0, 0, width, height);
	g.strokeStyle = style.color;
	g.lineWidth = 1.5 * devicePixelRatio;
	g.beginPath();
	const points = history.length > 1 ? history : [0, 0];
	const bottom = height - 2 * devicePixelRatio;
	points.forEach((value, i) => {
		const x = width - ((points.length - 1 - i) / (HISTORY - 1)) * width;
		const y = bottom - Math.min(1, value) * (bottom - 2 * devicePixelRatio);
		if (i) g.lineTo(x, y);
		else g.moveTo(x, y);
	});
	g.stroke();
}

function clearScopes(): void {
	histories.clear();
	for (const state of meterStates.values()) state.left = state.right = -Infinity;
	drawMeters();
	strips.querySelectorAll<HTMLCanvasElement>('canvas.scope').forEach((canvas) => drawWave(canvas, []));
}

// ---- cable drags ------------------------------------------------------------------------

const cableKey = (from: number, to: number, orbit: number) => `${model!.chains[from]?.name}>${model!.chains[to]?.name}@${orbit}`;
let outJacks: Element[] = [];
let drawnCables: CableSpec[] = [];
/**
 * The cable in the hand. `pulled`: a cable taken off its strip, which is hidden while it
 * is held and leaves its orbit when dropped on nothing. The loose end is `ghost`, a
 * marker under the pointer, so the cable layer draws it like any cable.
 */
let held: { from: number; pulled?: { orbit: number; to: number }; ghost: HTMLElement; over?: number; ok: boolean } | undefined;

/** The cables of the model, without the one in the hand, and the one in the hand. */
function drawCables(): void {
	const hidden = held?.pulled && cableKey(held.from, held.pulled.to, held.pulled.orbit);
	const specs = drawnCables.filter((spec) => spec.key !== hidden);
	if (held && outJacks[held.from]) specs.push({ key: 'drag', from: outJacks[held.from], to: held.ghost, kind: 'drag' });
	cables.set(specs);
}

/** Whether the strip of `to` takes a cable from `from`, by the same rules the host edits by. */
function accepts(from: number, to: number): boolean {
	const ducker = model?.chains[from];
	const target = model?.chains[to];
	return !!ducker && !!target && from !== to && !ducker.duckUnknown && target.orbit !== undefined;
}

function startDrag(event: PointerEvent, from: number, pulled?: { orbit: number; to: number }): void {
	if (event.button !== 0 || !model || error) return;
	event.preventDefault();
	event.stopPropagation();
	held = { from, pulled, ghost: strips.appendChild(el('div', 'ghost')), ok: false };
	// Redraws of the model wait until the cable is dropped, as they do for a fader.
	dragging = true;
	moveDrag(event);
	window.addEventListener('pointermove', moveDrag);
	window.addEventListener('pointerup', endDrag, { once: true });
}

function moveDrag(event: PointerEvent): void {
	if (!held) return;
	const box = strips.getBoundingClientRect();
	held.ghost.style.left = `${event.clientX - box.left + strips.scrollLeft}px`;
	held.ghost.style.top = `${event.clientY - box.top + strips.scrollTop}px`;
	const strip = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.strip[data-chain]');
	held.over = strip ? Number(strip.dataset.chain) : undefined;
	held.ok = held.over !== undefined && accepts(held.from, held.over);
	strips.querySelectorAll('.drop-ok, .drop-refused').forEach((node) => node.classList.remove('drop-ok', 'drop-refused'));
	// Red on any strip that refuses, the strip of the jack itself too. Neutral only where a
	// pulled cable came from: dropping it there puts it back as it was.
	const back = held.pulled !== undefined && held.over === held.pulled.to;
	if (strip && !back) strip.classList.add(held.ok ? 'drop-ok' : 'drop-refused');
	strips.classList.toggle('refusing', !!strip && !back && !held.ok);
	drawCables();
}

function endDrag(): void {
	window.removeEventListener('pointermove', moveDrag);
	const done = held;
	held = undefined;
	done?.ghost.remove();
	strips.querySelectorAll('.drop-ok, .drop-refused').forEach((node) => node.classList.remove('drop-ok', 'drop-refused'));
	strips.classList.remove('refusing');
	if (done) {
		const back = done.pulled && done.over === done.pulled.to;
		if (done.over !== undefined && done.ok && !back) post({ type: 'duck', from: done.from, to: done.over, move: done.pulled?.orbit });
		else if (done.over === undefined && done.pulled) post({ type: 'unduck', from: done.from, orbit: done.pulled.orbit });
	}
	drawCables();
}


function chainStrip(m: MixerModel, chain: MixerChain, index: number, isDucked: boolean): { strip: HTMLElement; out?: Element; input?: Element } {
	const open = unfolded.has(chain.name);
	const sliders = [chain.gain, ...chain.controls].filter((i) => i !== undefined);
	const strip = el('section', `strip${open ? ' open' : ''}${chain.muted ? ' muted' : ''}${chain.solo ? ' solo' : ''}`);
	strip.dataset.chain = String(index);

	const head = strip.appendChild(el('header'));
	const fold = head.appendChild(el('button', 'fold', open ? '▾' : '▸'));
	fold.title = open ? 'Fold: only the gain fader' : 'Unfold: every slider of the chain';
	fold.disabled = sliders.length <= (chain.gain === undefined ? 0 : 1);
	fold.addEventListener('click', () => {
		if (open) unfolded.delete(chain.name);
		else unfolded.add(chain.name);
		keep();
		draw();
	});
	// A bare chain (a song without labels, as most snippets) is the whole song: it takes the file's name.
	const name = head.appendChild(el('button', 'name', chain.bare && song ? song.replace(/\.strudel$/, '') : chain.name));
	name.title = chain.bare
		? 'The whole song: it has no labels, so its last expression is what plays. Click to show it in the code'
		: `${chain.label}:  -  click to show it in the code${chain.nameRule !== 'label' ? `\n(named from: ${chain.nameRule})` : ''}`;
	name.addEventListener('click', () => post({ type: 'reveal', chain: index }));

	// M, S and G stacked beside the faders, as the track buttons of Live's mixer.
	const body = strip.appendChild(el('div', 'body'));
	const faders = body.appendChild(el('div', 'faders'));
	const shown = open ? sliders : chain.gain !== undefined ? [chain.gain] : [];
	const toggleGain = () => post({ type: 'toggle', chain: index, button: 'gain' });
	for (const i of shown) {
		const box = faders.appendChild(fader(m.sliders[i!]));
		// The gain fader sits on the chain's level meter, as in Live's mixer, with no text: its value is over the scope.
		if (i === chain.gain) {
			box.querySelectorAll('.label, .detail, .value').forEach((node) => node.classList.add('blank'));
			addMeter(box, String(index));
			clickToToggle(box.querySelector('input')!, toggleGain, 'Drag to set the gain. Click the triangle to take the gain fader out of the code');
		}
	}
	// No gain fader: the meter still shows the chain, and a dim triangle at the bottom puts one in the code.
	if (chain.gain === undefined) {
		const box = faders.insertBefore(el('div', 'fader off'), faders.firstChild);
		addMeter(box, String(index));
		const off = box.querySelector('.meter-well')!.appendChild(el('button', 'off-thumb'));
		off.title = 'No gain fader. Click to put one in the code';
		off.addEventListener('click', toggleGain);
		blankRows(box);
	}

	// M and S side by side above the scope, as the track buttons under Live's meters.
	const ms = strip.appendChild(el('div', 'ms'));
	const button = (text: string, on: boolean, title: string, which: 'mute' | 'solo') => {
		const b = ms.appendChild(el('button', `badge${on ? ' on' : ''}`, text));
		b.title = title;
		b.addEventListener('click', () => post({ type: 'toggle', chain: index, button: which }));
		// Mute and solo write on the label, and a bare chain has none.
		if (chain.bare) {
			b.disabled = true;
			b.title = 'No label to mute or solo: put $: in front of the line to make it a chain';
		}
	};
	button('M', chain.muted, chain.muted ? `Muted: the label ${chain.label} starts or ends with _. Click to unmute` : 'Mute: writes _ in front of the label', 'mute');
	button('S', chain.solo, chain.solo ? `Solo: the label ${chain.label} starts with S. Click to end the solo` : 'Solo: writes S in front of the label', 'solo');

	// The chain's scope under its faders. With `._scope()` in the chain it is green and moves
	// while the song plays; without, a gray flat line, and a click adds the `._scope()`, as
	// G does for the gain. A click on a green one takes it out again.
	const scopeBox = strip.appendChild(el('div', 'scope-box'));
	const scope = scopeBox.appendChild(el('canvas', `scope${chain.scope ? '' : ' off'}`));
	// The gain's value, over the scope. A fader move updates it, as it updates every output of its slider.
	if (chain.gain !== undefined) {
		const gain = m.sliders[chain.gain];
		const value = scopeBox.appendChild(el('output', 'scope-value', String(gain.value)));
		value.dataset.slider = String(gain.index);
		value.title = `Gain${gain.constant ? ` (${gain.constant})` : ''}`;
	}
	scope.dataset.chain = String(index);
	scope.title = chain.scope ? 'Scope of the chain (._scope()). Click to take it out of the code' : 'No scope. Click to add ._scope() to the chain';
	scope.addEventListener('click', () => post({ type: 'toggle', chain: index, button: 'scope' }));
	requestAnimationFrame(() => drawWave(scope, []));
	const foot = strip.appendChild(el('footer'));
	// The orbit is said in the jack's tooltip, with what the jack does.
	const orbitText = chain.orbit === undefined ? 'Orbit: not a number we can read here' : `Orbit ${chain.orbit}: room and delay are shared per orbit`;
	// One jack per strip, as the maintainer asked: the cables this chain sends (its duck)
	// start here, and the cables that duck it end here. A drag from a jack where a cable
	// ends pulls that cable off; from a jack with none, or with Alt held, it starts a new one.
	const ducks = chain.ducks ?? [];
	const sends = m.ducks.some((d) => d.from === index && d.to !== undefined);
	const incoming = m.ducks.find((d) => d.to === index);
	const said = [
		orbitText,
		chain.duckUnknown ? 'Ducks: orbits not readable, edit them in the code' : ducks.length ? `Ducks orbits ${ducks.join(', ')}` : '',
		incoming ? `Ducked by ${m.chains[incoming.from]?.name} on orbit ${incoming.orbit}. Drag to pull that cable off; Alt+drag for a new cable` : 'Drag onto another strip to duck it',
	].filter(Boolean);
	const socket = foot.appendChild(jack(sends || isDucked, said.join('.\n')));
	socket.addEventListener('pointerdown', (event) => {
		const pointer = event as PointerEvent;
		if (incoming && !pointer.altKey) startDrag(pointer, incoming.from, { orbit: incoming.orbit, to: index });
		else startDrag(pointer, index);
	});
	const out: Element = socket;
	const input: Element = socket;
	const empty = m.ducks.filter((d) => d.from === index && d.to === undefined).map((d) => `orbit ${d.orbit} (empty)`);
	if (chain.duckUnknown) empty.push('orbits not readable');
	if (empty.length) foot.appendChild(el('div', 'note', empty.join(', ')));
	return { strip, out, input };
}

/**
 * Every fader has the same rows, so faders, names and knob buttons line up across the
 * strips (the maintainer, 2026-11-22): a top row (the peak of a metered fader, else empty),
 * the track (one height for plain and metered faders, --track in mixer.css), the label, the
 * detail and the value (blank but there on a gain fader, whose value is over the scope), and
 * the knob button.
 */
function fader(slider: MixerSlider): HTMLElement {
	const box = el('div', 'fader');
	box.appendChild(el('span', 'top'));
	const input = box.appendChild(el('input'));
	input.type = 'range';
	input.min = String(slider.min);
	input.max = String(slider.max);
	input.step = String(slider.step ?? (slider.max - slider.min) / 1000);
	input.value = String(slider.value);
	input.dataset.slider = String(slider.index);
	box.title = `${slider.label}${slider.constant ? ` (${slider.constant})` : ''}: from ${slider.min} to ${slider.max}. Changes the sound at once and the number in the code after a moment.`;
	box.appendChild(el('span', 'label', slider.label));
	box.appendChild(el('span', 'detail', slider.constant || slider.detail !== slider.label ? slider.detail : ''));
	const output = box.appendChild(el('output', 'value', String(slider.value)));
	output.dataset.slider = String(slider.index);
	// MIDI learn for this slider, as the knob button left of its line in the code. The host
	// puts `.knob(cc)` on the slider call wherever it is written, a constant included.
	const knob = box.appendChild(el('button', `knob${slider.from === learningFrom ? ' learning' : slider.knob === undefined ? '' : ' on'}`));
	knob.dataset.from = String(slider.from);
	knob.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8.5" r="5.5" fill="var(--knob-fill)" stroke="currentColor" stroke-width="1.5"/><path d="M8 8.5 5 5" stroke="var(--knob-mark)" stroke-width="1.5" stroke-linecap="round"/></svg>';
	if (slider.knob !== undefined) knob.appendChild(el('span', 'cc', String(slider.knob)));
	knob.title = slider.knob === undefined ? 'Click, then turn a knob on your MIDI controller: it moves this fader' : `Knob on CC ${slider.knob}. Click to take it off`;
	knob.addEventListener('click', () => post({ type: 'knob', index: slider.index }));
	input.addEventListener('pointerdown', () => (dragging = true));
	input.addEventListener('input', () => {
		const value = formatValue(Number(input.value), slider);
		// A slider used by two chains has a fader in each strip. They are one slider.
		for (const other of strips.querySelectorAll<HTMLInputElement>(`input[data-slider="${slider.index}"]`)) if (other !== input) other.value = input.value;
		for (const out of strips.querySelectorAll(`output[data-slider="${slider.index}"]`)) out.textContent = value;
		post({ type: 'slider', index: slider.index, value });
	});
	return box;
}


/** A jack: the socket of doc/jack.svg, with a plug in it when a cable ends there. */
function jack(plugged: boolean, title: string): Element {
	const wrap = el('span', `jack${plugged ? ' plugged' : ''}`);
	wrap.title = title;
	wrap.innerHTML = `<svg viewBox="-12 -12 24 24" width="24" height="24"><use href="#jack-socket"/>${plugged ? '<use href="#jack-plug"/>' : ''}</svg>`;
	return wrap;
}

function report(): void {
	requestAnimationFrame(() =>
		post({
			type: 'state',
			// The chains' strips: the master strip is not one of them.
			strips: [...strips.querySelectorAll<HTMLElement>('.strip:not(.master)')].map((strip) => ({
				name: strip.querySelector('.name')?.textContent ?? '',
				unfolded: strip.classList.contains('open'),
				faders: strip.querySelectorAll('.fader').length,
			})),
			cables: cables.count(),
		}),
	);
}

/** The drawing of doc/jack.svg as symbols, once per page. Gradients are gray tones that work on dark and light themes. */
function jackSymbols(): string {
	return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<linearGradient id="jack-bezel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa0a8"/><stop offset="0.5" stop-color="#5c6168"/><stop offset="1" stop-color="#2a2d31"/></linearGradient>
<linearGradient id="jack-bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25282c"/><stop offset="1" stop-color="#7d838b"/></linearGradient>
<radialGradient id="jack-hole" cx="0.62" cy="0.62" r="0.7"><stop offset="0" stop-color="#000"/><stop offset="0.55" stop-color="#050506"/><stop offset="0.85" stop-color="#1b1d20"/><stop offset="1" stop-color="#3a3e44"/></radialGradient>
<radialGradient id="jack-shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="jack-shine" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>
<g id="jack-socket"><circle r="11.5" fill="url(#jack-shadow)" transform="translate(1 1.2)"/><circle r="10" fill="url(#jack-bezel)"/><circle r="7.6" fill="url(#jack-bevel)"/><circle r="5.6" fill="url(#jack-hole)"/><circle r="5.6" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="0.6"/><path d="M -6.6 -3.2 A 7.4 7.4 0 0 1 -1.8 -7.2" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="0.8" stroke-linecap="round"/></g>
<g id="jack-plug"><circle r="7.2" fill="currentColor"/><circle r="7.2" fill="url(#jack-shine)"/><circle r="4.6" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.7"/><circle r="2.4" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.7"/></g>
</defs></svg>`;
}

// ---- level meters -----------------------------------------------------------------------
//
// As Live's: two bars, left and right, on a scale from 0 down to 60 dB, behind the gain fader, and above them the
// highest peak so far ("-Inf" before any sound, orange above 0 dB, where it clips at the speakers). A click on it
// starts the peak again. The engine sends each chain's peak of the last 50 ms in dBFS with the levels
// (`ScopeFrame.peak`, see "Level meters" in doc/ARCHITECTURE.md); `@master` is the whole mix.

const METER_FLOOR = -60;
/** Space above 0 dB and below -60 dB in the well, in CSS pixels: where the fader's thumb can still reach. */
const METER_PAD = 7;
/** The width of the fader's lane at the left of the meter, in CSS pixels. Matches `.meter-well input` in mixer.css. */
const METER_LANE = 13;
/** How fast a bar falls when the sound stops, in dB a second, about as Live's. */
const METER_FALL = 24;
/**
 * How long the peak number holds its highest value before it follows the level down. Live's holds until a click; the
 * maintainer pulled a gain fader down and read the held number as a meter that did not follow (2026-11-22). A clip
 * (above 0 dB) still stays orange until a click, so it is not missed.
 */
const PEAK_HOLD_MS = 3000;
const meterStates = new Map<string, { left: number; right: number; hold: number; holdAt: number; clipped: boolean; at: number }>();

function meterState(key: string) {
	let state = meterStates.get(key);
	if (!state) meterStates.set(key, (state = { left: -Infinity, right: -Infinity, hold: -Infinity, holdAt: 0, clipped: false, at: 0 }));
	return state;
}

function feedMeters(frames: ScopeFrame[]): void {
	const now = performance.now();
	for (const frame of frames) {
		if (!frame.peak) continue;
		const key = frame.chain === '@master' ? 'master' : String(chainOf(frame.chain));
		if (key === '-1') continue;
		const state = meterState(key);
		const fall = state.at ? (METER_FALL * (now - state.at)) / 1000 : Infinity;
		const [l, r] = frame.peak.map((v) => (v === null ? -Infinity : v));
		state.left = Math.max(l, state.left - fall);
		state.right = Math.max(r, state.right - fall);
		const peak = Math.max(l, r);
		if (peak >= state.hold || now - state.holdAt > PEAK_HOLD_MS) {
			state.hold = peak;
			state.holdAt = now;
		}
		if (peak > 0) state.clipped = true;
		state.at = now;
	}
	drawMeters();
}

/** Turns a fader box into a metered one: the meter in a well behind the fader, the peak above. */
function addMeter(box: HTMLElement, key: string): void {
	box.classList.add('metered');
	const input = box.querySelector('input');
	const well = el('div', 'meter-well');
	const canvas = well.appendChild(el('canvas', 'meter'));
	canvas.dataset.meter = key;
	well.appendChild(meterScale());
	meterResize.observe(well);
	if (input) {
		input.replaceWith(well);
		well.appendChild(input);
	} else box.appendChild(well);
	const top = box.querySelector(':scope > .top');
	if (top) top.replaceWith(peakHold(key));
	else box.insertBefore(peakHold(key), well);
	requestAnimationFrame(drawMeters);
}

/** The rows under the track of a fader that has no slider (a meter alone), so it lines up with the others. */
function blankRows(box: HTMLElement): void {
	for (const name of ['label', 'detail', 'value']) box.appendChild(el('span', `${name} blank`));
	box.appendChild(el('span', 'knob blank'));
}

function peakHold(key: string): HTMLElement {
	const hold = el('button', 'peakhold', '-Inf');
	hold.dataset.meter = key;
	hold.title = 'Peak: the highest level of the last 3 seconds, in dB below full scale. Orange: it went above 0 and clipped. Click to clear';
	hold.addEventListener('click', () => {
		const state = meterState(key);
		state.hold = -Infinity;
		state.clipped = false;
		drawMeters();
	});
	return hold;
}

/** The whole mix, as Live's Master track: its meter and peak, no fader. */
/**
 * The Master strip, first and always there (the maintainer, 2026-11-22): the whole mix as
 * Live's Master track, its meter and peak. The global sliders (in setcps(), or used by no
 * chain) are its inner sliders, folded and unfolded as a chain's own. Dim when no song is
 * shown.
 */
const MASTER = '@master';
function masterStrip(m: MixerModel | undefined): HTMLElement {
	const globals = m?.global ?? [];
	const open = unfolded.has(MASTER) && globals.length > 0;
	const strip = el('section', `strip master${open ? ' open' : ''}${m ? '' : ' disabled'}`);
	const head = strip.appendChild(el('header'));
	const fold = head.appendChild(el('button', 'fold', open ? '\u25be' : '\u25b8'));
	fold.disabled = !globals.length;
	fold.title = !globals.length ? 'No global sliders: none in setcps() and none unused' : open ? 'Fold: only the meter' : `Unfold: the ${globals.length} global sliders (in setcps(), or used by no chain)`;
	fold.addEventListener('click', () => {
		if (open) unfolded.delete(MASTER);
		else unfolded.add(MASTER);
		keep();
		draw();
	});
	head.appendChild(el('span', 'name', 'Master')).title = 'The whole mix, as it goes to the speakers';
	const faders = strip.appendChild(el('div', 'body')).appendChild(el('div', 'faders'));
	const box = faders.appendChild(el('div', 'fader'));
	addMeter(box, 'master');
	box.appendChild(el('span', 'label', 'out'));
	for (const name of ['detail', 'value']) box.appendChild(el('span', `${name} blank`));
	box.appendChild(el('span', 'knob blank'));
	if (open) for (const index of globals) faders.appendChild(fader(m!.sliders[index]));
	strip.appendChild(el('footer'));
	return strip;
}

function drawMeters(): void {
	for (const canvas of strips.querySelectorAll<HTMLCanvasElement>('canvas.meter')) drawMeter(canvas, meterState(canvas.dataset.meter!));
	for (const hold of strips.querySelectorAll<HTMLElement>('.peakhold')) {
		const state = meterState(hold.dataset.meter!);
		hold.textContent = Number.isFinite(state.hold) ? state.hold.toFixed(2) : '-Inf';
		hold.classList.toggle('over', state.clipped);
	}
}

function drawMeter(canvas: HTMLCanvasElement, state: { left: number; right: number }): void {
	if (!canvas.isConnected) return;
	const dpr = devicePixelRatio;
	const width = (canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)));
	const height = (canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)));
	const g = canvas.getContext('2d')!;
	g.clearRect(0, 0, width, height);
	const style = getComputedStyle(canvas);
	// The top and the bottom of the scale sit where the fader's thumb can reach (its half height, 6 pixels), with
	// room for the half height of the "0" and "60" labels.
	const pad = METER_PAD * dpr;
	const top = pad;
	const bottom = height - pad;
	const y = (db: number) => top + (Math.min(0, Math.max(METER_FLOOR, db)) / METER_FLOOR) * (bottom - top);
	// As in Live, left to right: the lane of the fader's triangle (METER_LANE), two bars, the scale.
	const bar = 5 * dpr;
	const x0 = METER_LANE * dpr;
	const gradient = g.createLinearGradient(0, bottom, 0, top);
	gradient.addColorStop(0, '#3fb950');
	gradient.addColorStop(0.75, '#3fb950');
	gradient.addColorStop(0.9, '#d4b84a');
	gradient.addColorStop(1, '#f14c4c');
	[state.left, state.right].forEach((db, i) => {
		const x = x0 + i * (bar + dpr);
		g.fillStyle = 'rgba(0, 0, 0, .45)';
		g.fillRect(x, top, bar, bottom - top);
		if (db <= METER_FLOOR) return;
		g.fillStyle = db > 0 ? '#f14c4c' : gradient;
		g.fillRect(x, y(db), bar, bottom - y(db));
	});
	// The ticks only. Their numbers are text in the page (`meterScale`): numbers drawn here were stretched as a
	// picture when the panel grew, until the next draw (seen by the maintainer on 2026-11-22).
	g.fillStyle = style.color;
	const xs = x0 + 2 * bar + dpr + 2 * dpr;
	for (let db = 0; db >= METER_FLOOR; db -= 12) g.fillRect(xs, Math.round(y(db)), 3 * dpr, dpr);
}

/** The numbers of the meter's scale as text, at the heights of the ticks drawMeter draws. */
function meterScale(): HTMLElement {
	const scale = el('div', 'meter-scale');
	for (let db = 0; db >= METER_FLOOR; db -= 12) {
		const label = scale.appendChild(el('span', '', String(-db)));
		label.style.top = `calc(${METER_PAD}px + (100% - ${2 * METER_PAD}px) * ${db / METER_FLOOR})`;
	}
	return scale;
}

/** A meter whose well changes size (the panel grows, a strip unfolds) is drawn again at once. */
const meterResize = new ResizeObserver(() => drawMeters());

/**
 * A click on the fader's triangle, without moving it, calls `toggle`; a drag still moves the fader. A click elsewhere in
 * the lane moves the value there, as a range input does, so it is not a toggle either.
 */
function clickToToggle(input: HTMLInputElement, toggle: () => void, title: string): void {
	input.title = title;
	let start: { y: number; value: string } | undefined;
	input.addEventListener('pointerdown', (event) => (start = { y: event.clientY, value: input.value }));
	input.addEventListener('pointerup', (event) => {
		if (start && Math.abs(event.clientY - start.y) < 3 && input.value === start.value) toggle();
		start = undefined;
	});
}

// Last, after every constant of this file exists: the first draw reaches them (MASTER,
// meterResize). Called from the top, it threw and the page drew no strip at all (seen by
// the maintainer on 2026-11-22, once the Master strip was drawn before any song).
post({ type: 'ready' });
draw();
