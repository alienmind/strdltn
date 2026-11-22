// Sliders on knobs: `slider(800, 200, 4000).knob(74)` lets CC 74 of any MIDI input move
// that slider, as a drag does (doc/TODO.md, "Sliders on knobs"). The song stays standard
// Strudel: it defines `knob` itself with the snippet below, which does nothing to the
// sound, so it plays on strudel.cc too, without knobs. Here the page reads the bindings
// from the code and moves the slider. Both sides of the rules are in this file, with
// tests in knob.test.ts.
import { parse } from 'acorn';
import { numberOf, walk } from './chains.ts';

/** A slider with a knob on it, as written in the code. */
export interface KnobBinding {
	/** Where the slider's first argument, the number, starts. The transpiler's id is `slider_<from>`. */
	from: number;
	cc: number;
	min: number;
	max: number;
	step?: number;
}

/**
 * The snippet that goes in once, at the top, the first time a knob is mapped. `knob` returns
 * the pattern as it is: on strudel.cc the song plays with the slider's value, and here the
 * page moves the slider. No `midin()`: upstream's takes the first input and throws when
 * there is none, so a song with it fails on a machine without a controller.
 */
export const KNOB_SNIPPET =
	"// .knob(cc) after a slider: in [str]dltn a MIDI knob on that CC moves the slider. Elsewhere it does nothing.\nregister('knob', (cc, pat) => pat)\n";

export const hasKnobSnippet = (code: string): boolean => /register\(\s*['"]knob['"]/.test(code);

type Node = any;

function program(code: string): Node | undefined {
	try {
		return parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' });
	} catch {
		return undefined;
	}
}

const isSlider = (node: Node): boolean =>
	node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'slider' && node.arguments.length > 0;

/** The call `<slider>.knob(<n>)` around a slider call, if there is one. */
function knobCallOf(slider: Node, parents: Node[]): Node | undefined {
	const member = parents[parents.length - 1];
	const call = parents[parents.length - 2];
	if (member?.type !== 'MemberExpression' || member.object !== slider || member.computed || member.property.name !== 'knob') return undefined;
	return call?.type === 'CallExpression' && call.callee === member ? call : undefined;
}

/** Every `slider(...).knob(n)` of the code. Empty when the code does not parse (half typed). */
export function findKnobs(code: string): KnobBinding[] {
	const root = program(code);
	if (!root) return [];
	const found: KnobBinding[] = [];
	walk(root, [], (node, parents) => {
		if (!isSlider(node)) return;
		const call = knobCallOf(node, parents);
		const cc = call && numberOf(call.arguments[0]);
		if (cc === undefined || !Number.isInteger(cc) || cc < 0 || cc > 127) return;
		const [value, min, max, step] = node.arguments;
		found.push({ from: value.start, cc, min: numberOf(min) ?? 0, max: numberOf(max) ?? 1, step: numberOf(step) });
	});
	return found;
}

/**
 * The edits that map CC `cc` to the slider whose number starts at `from`: `.knob(cc)` after
 * the slider's call, or the number in a `.knob(...)` that is there already, and the snippet
 * at the top when the song has none. Positions are of the code as given. Undefined when
 * no slider starts there.
 */
export function knobEdits(code: string, from: number, cc: number): { from: number; to: number; insert: string }[] | undefined {
	const root = program(code);
	if (!root) return undefined;
	let edit: { from: number; to: number; insert: string } | undefined;
	walk(root, [], (node, parents) => {
		if (edit || !isSlider(node) || node.arguments[0].start !== from) return;
		const call = knobCallOf(node, parents);
		const old = call?.arguments[0];
		edit = old ? { from: old.start, to: old.end, insert: String(cc) } : { from: node.end, to: node.end, insert: `.knob(${cc})` };
	});
	if (!edit) return undefined;
	return hasKnobSnippet(code) ? [edit] : [{ from: snippetPlace(code), to: snippetPlace(code), insert: KNOB_SNIPPET }, edit];
}

/** After the comments that open the file (the header), so `// @title` and the like stay first. */
function snippetPlace(code: string): number {
	let at = 0;
	for (const line of code.split('\n')) {
		if (!/^\s*\/\//.test(line)) break;
		at += line.length + 1;
	}
	return Math.min(at, code.length);
}

/** What a knob remembers between two of its messages. */
export interface Pickup {
	/** The knob's last position, in the slider's units. */
	knob?: number;
	/** True once the knob has caught the slider. Then it moves it. */
	engaged: boolean;
	/** The value the knob wrote last. A slider that has another value was moved by something else. */
	written?: number;
	/**
	 * The last values the knob wrote. The slider's value reaches the page through the same
	 * queue as the next CCs, so during a fast turn the page reads a value the knob wrote a
	 * few steps ago. Measured on 2026-11-22: without this the knob took the slider and let
	 * go of it four steps later, as if a drag had moved it.
	 */
	recent?: number[];
}

/**
 * One message of a knob. `slider` is the slider's value now, `position` the knob's, 0 to 1.
 * Pickup, as the maintainer chose (2026-11-22): the knob takes over only once it reaches or
 * passes the slider's value, so touching a knob that sits elsewhere does not make the sound
 * jump. A slider moved by a drag, a fader or an edit drops the knob again until it catches
 * up once more. Returns the new state and the value to write, if any.
 */
export function pickup(state: Pickup, binding: KnobBinding, slider: number, position: number): { state: Pickup; write?: number } {
	const value = binding.min + position * (binding.max - binding.min);
	const near = Math.abs(binding.max - binding.min) / 127;
	const ours = [state.written, ...(state.recent ?? [])].some((v) => v !== undefined && Math.abs(slider - v) <= near / 2);
	let engaged = state.engaged && ours;
	if (!engaged) {
		const crossed = state.knob !== undefined && (state.knob - slider) * (value - slider) <= 0;
		engaged = crossed || Math.abs(value - slider) <= near / 2;
	}
	if (!engaged) return { state: { knob: value, engaged: false } };
	const write = snap(value, binding);
	return { state: { knob: value, engaged: true, written: write, recent: [write, ...(state.recent ?? [])].slice(0, 32) }, write };
}

/** Rounded to the slider's step, or to a thousandth of its range as the Mixer's fader does. */
export function snap(value: number, binding: Pick<KnobBinding, 'min' | 'max' | 'step'>): number {
	const step = binding.step ?? (binding.max - binding.min) / 1000;
	const decimals = step > 0 ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)))) : 3;
	const stepped = binding.step ? binding.min + Math.round((value - binding.min) / binding.step) * binding.step : value;
	return Number(stepped.toFixed(decimals));
}

/** The slider whose call holds `position` (the cursor), by where its number starts. */
export function sliderAt(code: string, position: number): number | undefined {
	const root = program(code);
	if (!root) return undefined;
	let found: number | undefined;
	walk(root, [], (node) => {
		if (isSlider(node) && node.start <= position && position <= node.end) found = node.arguments[0].start;
	});
	return found;
}
