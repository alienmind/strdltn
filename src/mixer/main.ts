// The Mixer view: one strip per chain of the song in front, side by side as in the
// Session view of Live, with the sliders as faders and the sidechain as cables. The host
// sends the model it read from the code; this page draws it and keeps which strips are
// unfolded. See "Mixer panel" in doc/DAW-PLAN.md.
//
// A fader changes the sound at once and the number in the code after a moment. Mute,
// solo and cable drags are still to come (phase 3 of the plan).
import './mixer.css';
import type { MixerChain, MixerModel, MixerSlider } from '../shared/chains.ts';
import type { FromMixer, ToMixer } from '../shared/mixer.ts';
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
	bar.replaceChildren();
	bar.appendChild(el('span', 'song', song ?? 'No song'));
	if (error) {
		const stale = bar.appendChild(el('span', 'stale', 'code does not parse, showing the last good state'));
		stale.title = error;
	}
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
	const specs: CableSpec[] = model.ducks
		.filter((duck) => duck.to !== undefined && jacks.out[duck.from] && jacks.in[duck.to])
		.map((duck) => ({ key: `${model!.chains[duck.from].name}>${model!.chains[duck.to!].name}@${duck.orbit}`, from: jacks.out[duck.from], to: jacks.in[duck.to!], kind: 'sidechain', label: `orbit ${duck.orbit}` }));
	cables.set(specs);
	report();
}

function globalStrip(m: MixerModel): HTMLElement {
	const strip = el('section', 'strip global');
	const head = strip.appendChild(el('header'));
	head.appendChild(el('span', 'name', 'global'));
	head.title = 'Sliders that act on no chain: in setcps(), or not used';
	const faders = strip.appendChild(el('div', 'faders'));
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
	const name = head.appendChild(el('button', 'name', chain.name));
	name.title = `${chain.label}:  -  click to show it in the code${chain.nameRule !== 'label' ? `\n(named from: ${chain.nameRule})` : ''}`;
	name.addEventListener('click', () => post({ type: 'reveal', chain: index }));

	const badges = strip.appendChild(el('div', 'badges'));
	const badge = (text: string, on: boolean, title: string) => {
		const b = badges.appendChild(el('span', `badge${on ? ' on' : ''}`, text));
		b.title = title;
	};
	badge('M', chain.muted, chain.muted ? `Muted: the label ${chain.label} starts or ends with _` : 'Not muted. Mute writes _ in front of the label (not built yet)');
	badge('S', chain.solo, chain.solo ? `Solo: the label ${chain.label} starts with S` : 'Not soloed. Solo writes S in front of the label (not built yet)');

	const faders = strip.appendChild(el('div', 'faders'));
	const shown = open ? sliders : chain.gain !== undefined ? [chain.gain] : [];
	for (const i of shown) faders.appendChild(fader(m.sliders[i!]));
	if (!shown.length) faders.appendChild(el('div', 'none', sliders.length ? `${sliders.length} slider${sliders.length > 1 ? 's' : ''}` : 'no slider'));

	const foot = strip.appendChild(el('footer'));
	const route = foot.appendChild(el('div', 'route'));
	route.appendChild(el('span', 'orbit', chain.orbit === undefined ? 'orbit ?' : `orbit ${chain.orbit}`)).title =
		chain.orbit === undefined ? 'The orbit is not a number we can read here' : `Plays on orbit ${chain.orbit}. room and delay are shared per orbit`;
	let out: Element | undefined;
	let input: Element | undefined;
	if (isDucked) {
		input = foot.appendChild(jack(true, 'in: ducked by a sidechain'));
	}
	if (chain.ducks?.length || chain.duckUnknown) {
		const ducks = chain.ducks ?? [];
		out = foot.appendChild(jack(ducks.some((orbit) => m.ducks.some((d) => d.from === index && d.orbit === orbit && d.to !== undefined)), `duck: ${ducks.length ? `orbits ${ducks.join(', ')}` : 'orbits not readable'}`));
		out.classList.add('out');
		const empty = m.ducks.filter((d) => d.from === index && d.to === undefined).map((d) => `orbit ${d.orbit} (empty)`);
		if (chain.duckUnknown) empty.push('orbits not readable');
		if (empty.length) foot.appendChild(el('div', 'note', empty.join(', ')));
	}
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
