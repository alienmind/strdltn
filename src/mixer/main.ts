// The Music panel: the control panel of the song in front. A top bar with Play, Stop and
// the BPM, then the mixer: one strip per chain, side by side as in the Session view of
// Live, with the sliders as faders and the sidechain as cables. The host sends the model
// it read from the code; this page draws it and keeps which strips are unfolded. See
// "Mixer panel" in doc/DAW-PLAN.md.
//
// A fader changes the sound at once and the number in the code after a moment. M, S, G,
// the BPM box and the transport buttons are edits or commands the host carries out.
import './mixer.css';
import type { MixerChain, MixerModel, MixerSlider } from '../shared/chains.ts';
import { DEFAULT_BPM, type FromMixer, type ToMixer } from '../shared/mixer.ts';
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
// The top bar is made once and updated in place: a redraw while the BPM is typed must not
// take the field away. Record and record automation come here later.
const transport = bar.appendChild(el('div', 'transport'));
const playButton = transport.appendChild(el('button', 'play'));
playButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
playButton.title = 'Play / update (Ctrl+Enter in the editor)';
playButton.addEventListener('click', () => post({ type: 'transport', action: 'play' }));
const stopButton = transport.appendChild(el('button', 'stop'));
stopButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>';
stopButton.title = 'Stop (Ctrl+.)';
stopButton.addEventListener('click', () => post({ type: 'transport', action: 'stop' }));
// Record (a filled red circle) and Record Automation (an empty one), as Live has them. Not
// built yet: see "Recording and arrangement" in doc/DAW-PLAN.md.
const recordButton = transport.appendChild(el('button', 'record'));
recordButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>';
recordButton.title = 'Record: not built yet';
recordButton.disabled = true;
const automationButton = transport.appendChild(el('button', 'record'));
automationButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
automationButton.title = 'Record automation: not built yet';
automationButton.disabled = true;
const bpmBox = bar.appendChild(el('label', 'bpm'));
bpmBox.appendChild(el('span', '', 'BPM'));
const bpmInput = bpmBox.appendChild(el('input'));
bpmInput.inputMode = 'decimal';
bpmInput.size = 5;
const songName = bar.appendChild(el('span', 'song'));
const staleNote = bar.appendChild(el('span', 'stale', 'code does not parse, showing the last good state'));
/** What the BPM field shows when it is not being typed in. */
function showTempo(): void {
	const tempo = model?.tempo;
	bpmInput.classList.toggle('default', !tempo);
	bpmInput.disabled = !model || (!!tempo && tempo.bpm === undefined);
	bpmInput.title = !tempo
		? `Strudel's default, ${DEFAULT_BPM}: the song has no setcpm(). Type a number to write one`
		: tempo.bpm === undefined
			? 'The song sets its tempo with something that is not a plain number. Change it in the code'
			: 'Type a number and press Enter to write setcpm(<bpm>/4). Double click: back to the default';
	if (document.activeElement !== bpmInput) bpmInput.value = String(tempo ? (tempo.bpm ?? '?') : DEFAULT_BPM);
}
function commitTempo(): void {
	const bpm = Number(bpmInput.value.replace(',', '.'));
	const now = model?.tempo ? model.tempo.bpm : DEFAULT_BPM;
	if (Number.isFinite(bpm) && bpm > 0 && bpm !== now) post({ type: 'tempo', bpm });
	else showTempo();
}
bpmInput.addEventListener('keydown', (event) => {
	if (event.key === 'Enter') bpmInput.blur();
	if (event.key === 'Escape') {
		bpmInput.value = '';
		bpmInput.blur();
	}
});
bpmInput.addEventListener('change', () => commitTempo());
bpmInput.addEventListener('blur', () => showTempo());
bpmInput.addEventListener('dblclick', () => {
	bpmInput.blur();
	if (model?.tempo) post({ type: 'tempo' });
});
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
			playButton.classList.toggle('on', message.on);
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
	showTempo();
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
	outJacks = jacks.out;
	drawnCables = model.ducks
		.filter((duck) => duck.to !== undefined && jacks.out[duck.from] && jacks.in[duck.to])
		.map((duck) => ({ key: cableKey(duck.from, duck.to!, duck.orbit), from: jacks.out[duck.from], to: jacks.in[duck.to!], kind: 'sidechain', label: `orbit ${duck.orbit}` }));
	drawCables();
	report();
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
	if (strip && held.over !== held.from) strip.classList.add(held.ok ? 'drop-ok' : 'drop-refused');
	strips.classList.toggle('refusing', strip !== null && held.over !== held.from && !held.ok);
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
	for (const i of shown) faders.appendChild(fader(m.sliders[i!]));
	// No gain slider: a fader that cannot move, until G puts one in the code.
	if (!shown.length) faders.appendChild(disabledFader(sliders.length));

	const foot = strip.appendChild(el('footer'));
	const route = foot.appendChild(el('div', 'route'));
	route.appendChild(el('span', 'orbit', chain.orbit === undefined ? 'orbit ?' : `orbit ${chain.orbit}`)).title =
		chain.orbit === undefined ? 'The orbit is not a number we can read here' : `Plays on orbit ${chain.orbit}. room and delay are shared per orbit`;
	let out: Element | undefined;
	let input: Element | undefined;
	if (isDucked) {
		input = foot.appendChild(jack(true, 'in: ducked by a sidechain. Drag the plug away to pull the cable off'));
		input.classList.add('in');
		// Pull a cable off by its end. With several cables in, the first one comes.
		input.addEventListener('pointerdown', (event) => {
			const cable = m.ducks.find((d) => d.to === index);
			if (cable) startDrag(event as PointerEvent, cable.from, { orbit: cable.orbit, to: index });
		});
	}
	// Every strip has a duck jack, so any chain can start a sidechain.
	const ducks = chain.ducks ?? [];
	out = foot.appendChild(
		jack(
			ducks.some((orbit) => m.ducks.some((d) => d.from === index && d.orbit === orbit && d.to !== undefined)),
			chain.duckUnknown ? 'duck: orbits not readable, edit them in the code' : `duck${ducks.length ? `: orbits ${ducks.join(', ')}` : ''}. Drag onto another strip to duck it`,
		),
	);
	out.classList.add('out');
	out.addEventListener('pointerdown', (event) => startDrag(event as PointerEvent, index));
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
			strips: [...strips.querySelectorAll<HTMLElement>('.strip')].map((strip) => ({
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
