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
const strips = app.appendChild(el('div', 'strips'));
const cables = new CableLayer(strips);

let song: string | undefined;
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
			break;
		case 'playing':
			if (!message.on) clearScopes();
			break;
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
post({ type: 'ready' });
draw();

function draw(): void {
	songName.textContent = song ?? 'No song';
	staleNote.hidden = !error;
	staleNote.title = error ?? '';
	strips.classList.toggle('old', !!error);
	strips.querySelectorAll('.strip, .empty').forEach((node) => node.remove());
	if (!model) {
		strips.appendChild(el('div', 'empty', song ? '' : 'Open a .strudel file to see its chains here.'));
		cables.set([]);
		return report();
	}
	if (!model.chains.length && !model.global.length) strips.appendChild(el('div', 'empty', 'This song has no chains. A chain is a line that starts with $: or name:'));

	const ducked = new Set(model.ducks.map((duck) => duck.to).filter((to) => to !== undefined));
	if (model.global.length) strips.appendChild(globalStrip(model));
	const jacks: { out: Element[]; in: Element[] } = { out: [], in: [] };
	model.chains.forEach((chain, index) => {
		const { strip, out, input } = chainStrip(model!, chain, index, ducked.has(index));
		jacks.out[index] = out!;
		jacks.in[index] = input!;
		strips.appendChild(strip);
	});
	if (model.chains.length) strips.appendChild(masterStrip());
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

function globalStrip(m: MixerModel): HTMLElement {
	const strip = el('section', 'strip global');
	const head = strip.appendChild(el('header'));
	head.appendChild(el('span', 'name', 'global'));
	head.title = 'Sliders that act on no chain: in setcps(), or not used';
	const faders = strip.appendChild(el('div', 'body')).appendChild(el('div', 'faders'));
	for (const index of m.global) faders.appendChild(fader(m.sliders[index]));
	strip.appendChild(el('footer'));
	return strip;
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
	const badges = body.appendChild(el('div', 'badges'));
	const badge = (text: string, on: boolean, title: string, button: 'mute' | 'solo' | 'gain') => {
		const b = badges.appendChild(el('button', `badge${on ? ' on' : ''}`, text));
		b.title = title;
		b.addEventListener('click', () => post({ type: 'toggle', chain: index, button }));
		// Mute and solo write on the label, and a bare chain has none.
		if (chain.bare && button !== 'gain') {
			b.disabled = true;
			b.title = 'No label to mute or solo: put $: in front of the line to make it a chain';
		}
	};
	badge('M', chain.muted, chain.muted ? `Muted: the label ${chain.label} starts or ends with _. Click to unmute` : 'Mute: writes _ in front of the label', 'mute');
	badge('S', chain.solo, chain.solo ? `Solo: the label ${chain.label} starts with S. Click to end the solo` : 'Solo: writes S in front of the label', 'solo');
	badge('G', chain.gain !== undefined, chain.gain !== undefined ? 'Gain fader on. Click to take it out of the code' : 'No gain fader. Click to add one to the code', 'gain');

	const faders = body.appendChild(el('div', 'faders'));
	const shown = open ? sliders : chain.gain !== undefined ? [chain.gain] : [];
	for (const i of shown) {
		const box = faders.appendChild(fader(m.sliders[i!]));
		// The gain fader sits on the chain's level meter, as in Live's mixer.
		if (i === chain.gain) addMeter(box, String(index));
	}
	// No gain slider: a fader that cannot move, until G puts one in the code. The meter still shows the chain.
	if (chain.gain === undefined) addMeter(faders.insertBefore(disabledFader(sliders.length), faders.firstChild), String(index));

	// The chain's scope under its faders. With `._scope()` in the chain it is green and moves
	// while the song plays; without, a gray flat line, and a click adds the `._scope()`, as
	// G does for the gain. A click on a green one takes it out again.
	const scope = strip.appendChild(el('canvas', `scope${chain.scope ? '' : ' off'}`));
	scope.dataset.chain = String(index);
	scope.title = chain.scope ? 'Scope of the chain (._scope()). Click to take it out of the code' : 'No scope. Click to add ._scope() to the chain';
	scope.addEventListener('click', () => post({ type: 'toggle', chain: index, button: 'scope' }));
	requestAnimationFrame(() => drawWave(scope, []));
	const foot = strip.appendChild(el('footer'));
	const route = foot.appendChild(el('div', 'route'));
	route.appendChild(el('span', 'orbit', chain.orbit === undefined ? 'orbit ?' : `orbit ${chain.orbit}`)).title =
		chain.orbit === undefined ? 'The orbit is not a number we can read here' : `Plays on orbit ${chain.orbit}. room and delay are shared per orbit`;
	// One jack per strip, as the maintainer asked: the cables this chain sends (its duck)
	// start here, and the cables that duck it end here. A drag from a jack where a cable
	// ends pulls that cable off; from a jack with none, or with Alt held, it starts a new one.
	const ducks = chain.ducks ?? [];
	const sends = m.ducks.some((d) => d.from === index && d.to !== undefined);
	const incoming = m.ducks.find((d) => d.to === index);
	const said = [
		chain.duckUnknown ? 'Ducks: orbits not readable, edit them in the code' : ducks.length ? `Ducks orbits ${ducks.join(', ')}` : '',
		incoming ? `Ducked by ${m.chains[incoming.from]?.name} on orbit ${incoming.orbit}. Drag to pull that cable off; Alt+drag for a new cable` : 'Drag onto another strip to duck it',
	].filter(Boolean);
	const socket = foot.appendChild(jack(sends || isDucked, said.join('. ')));
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

function fader(slider: MixerSlider): HTMLElement {
	const box = el('div', 'fader');
	const input = box.appendChild(el('input'));
	input.type = 'range';
	input.min = String(slider.min);
	input.max = String(slider.max);
	input.step = String(slider.step ?? (slider.max - slider.min) / 1000);
	input.value = String(slider.value);
	input.dataset.slider = String(slider.index);
	box.title = `${slider.label}${slider.constant ? ` (${slider.constant})` : ''}: from ${slider.min} to ${slider.max}. Changes the sound at once and the number in the code after a moment.`;
	box.appendChild(el('span', 'label', slider.label));
	if (slider.constant || slider.detail !== slider.label) box.appendChild(el('span', 'detail', slider.detail));
	const output = box.appendChild(el('output', 'value', String(slider.value)));
	output.dataset.slider = String(slider.index);
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

function disabledFader(others: number): HTMLElement {
	const box = el('div', 'fader off');
	const input = box.appendChild(el('input'));
	input.type = 'range';
	input.min = '0';
	input.max = '1';
	input.value = '1';
	input.disabled = true;
	box.title = `No gain slider in this chain${others ? ` (${others} other slider${others > 1 ? 's' : ''}: unfold to see them)` : ''}. G adds one.`;
	box.appendChild(el('span', 'label', 'gain'));
	box.appendChild(el('output', 'value', 'off'));
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
/** How fast a bar falls when the sound stops, in dB a second, about as Live's. */
const METER_FALL = 24;
const meterStates = new Map<string, { left: number; right: number; hold: number; at: number }>();

function meterState(key: string) {
	let state = meterStates.get(key);
	if (!state) meterStates.set(key, (state = { left: -Infinity, right: -Infinity, hold: -Infinity, at: 0 }));
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
		state.hold = Math.max(state.hold, l, r);
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
	if (input) {
		input.replaceWith(well);
		well.appendChild(input);
	} else box.appendChild(well);
	box.insertBefore(peakHold(key), well);
	requestAnimationFrame(drawMeters);
}

function peakHold(key: string): HTMLElement {
	const hold = el('button', 'peakhold', '-Inf');
	hold.dataset.meter = key;
	hold.title = 'Peak: the highest level so far, in dB below full scale. Above 0 it clips. Click to start again';
	hold.addEventListener('click', () => {
		meterState(key).hold = -Infinity;
		drawMeters();
	});
	return hold;
}

/** The whole mix, as Live's Master track: its meter and peak, no fader. */
function masterStrip(): HTMLElement {
	const strip = el('section', 'strip master');
	const head = strip.appendChild(el('header'));
	head.appendChild(el('span', 'name', 'Master')).title = 'The whole mix, as it goes to the speakers';
	const box = strip.appendChild(el('div', 'body')).appendChild(el('div', 'faders')).appendChild(el('div', 'fader'));
	addMeter(box, 'master');
	box.appendChild(el('span', 'label', 'out'));
	return strip;
}

function drawMeters(): void {
	for (const canvas of strips.querySelectorAll<HTMLCanvasElement>('canvas.meter')) drawMeter(canvas, meterState(canvas.dataset.meter!));
	for (const hold of strips.querySelectorAll<HTMLElement>('.peakhold')) {
		const value = meterState(hold.dataset.meter!).hold;
		hold.textContent = Number.isFinite(value) ? value.toFixed(2) : '-Inf';
		hold.classList.toggle('over', value > 0);
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
	const pad = 5 * dpr;
	const top = pad;
	const bottom = height - pad;
	const y = (db: number) => top + (Math.min(0, Math.max(METER_FLOOR, db)) / METER_FLOOR) * (bottom - top);
	// Two bars and the scale to their right, as in Live.
	const bar = Math.max(2 * dpr, Math.round(width * 0.11));
	const x0 = Math.round(width * 0.34);
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
	g.fillStyle = style.color;
	g.font = `${8 * dpr}px ${style.fontFamily}`;
	g.textBaseline = 'middle';
	const xs = x0 + 2 * bar + 4 * dpr;
	for (let db = 0; db >= METER_FLOOR; db -= 12) {
		g.fillRect(xs - 2 * dpr, y(db), 2 * dpr, dpr);
		g.fillText(String(-db), xs + 3 * dpr, y(db));
	}
}
