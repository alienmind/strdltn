// The Mixer's model of a song: its chains, its sliders and its sidechain cables, read
// from the code. See "Mixer panel" in doc/DAW-PLAN.md.
//
// A chain is a line `$kick: ...` or `name: ...`. In JavaScript that is a labeled
// statement, and the transpiler turns it into `....p('name')`. A slider belongs to a
// chain when its call is inside the chain, or when a constant it is assigned to is used
// inside the chain. The label of a fader is the call the slider feeds where it is used:
// `.gain(KICK_VOL)` gives "gain".
//
// We parse with acorn, with the options of upstream's transpiler, so the Mixer can be
// drawn from the text before the song plays. Sliders are counted in the order of the
// code, which is the order of the transpiler's widgets and of the stage's rows, so the
// index of a slider here is its index there.
//
// To change the behavior, add a case to chains.test.ts first.
import { parse } from 'acorn';
import { sliderLabel, visualLabel } from './context.ts';

export interface MixerSlider {
	/** Its place among the sliders of the song, in the order of the code. */
	index: number;
	/** Where the first argument, the number, is in the code. The transpiler reports the same. */
	from: number;
	to: number;
	value: number;
	min: number;
	max: number;
	step?: number;
	/** The constant it is assigned to: `KICK_VOL` of `const KICK_VOL = slider(...)`. */
	constant?: string;
	/** The name of the call it feeds where it is first used: "gain", "lpenv". Else the label rules of the stage. */
	label: string;
	/** "kick vol" for `KICK_VOL`. The label of the stage, shown small under the fader. */
	detail: string;
	/** The chains that use it, by index. */
	chains: number[];
}

export interface MixerChain {
	/** The label as it is written: `$kick`, `lowendbass`, `_$snare`, `$`. Empty for a bare chain. */
	label: string;
	/**
	 * A song without labels plays its last expression, as most snippets are written. That
	 * expression is the one chain, with no label to put `_` or `S` on.
	 */
	bare?: boolean;
	/** What the strip says on top: "kick". */
	name: string;
	/** How the name was found: 'label', or a rule of src/shared/context.ts for an anonymous `$:`. */
	nameRule: string;
	/** The whole statement, label included. */
	from: number;
	to: number;
	/** Muted by upstream's rule: the label starts or ends with `_`. */
	muted: boolean;
	/** Soloed by upstream's rule: the label starts with `S` and is longer than one letter. */
	solo: boolean;
	/** `.orbit(n)` of the chain. 1, everyone's default, when it sets none. Undefined when it is not a literal. */
	orbit?: number;
	/** The orbits of `.duck("2:3:4")`. Undefined when the chain does not duck or the value is not a literal. */
	ducks?: number[];
	/** It ducks, but the orbits are not a literal we can read. */
	duckUnknown?: boolean;
	/** True when the chain names its orbit itself (`.orbit(2)`); else it plays on orbit 1, everyone's default. */
	orbitSet?: boolean;
	/** True when the chain has an inline `._scope()` of its own: the Mixer draws its wave. */
	scope?: boolean;
	/** The slider of its `.gain()`, the one fader a folded strip shows. */
	gain?: number;
	/** Every other slider it uses, in the order of the code. */
	controls: number[];
}

export interface DuckCable {
	/** The chain that ducks. */
	from: number;
	/** The chain that is ducked, or undefined for an orbit no chain plays on. */
	to?: number;
	orbit: number;
}

export interface MixerModel {
	chains: MixerChain[];
	sliders: MixerSlider[];
	ducks: DuckCable[];
	/** Sliders that act on no chain: in `setcps()`, or not used. The strip "global". */
	global: number[];
	/** The song's `setcpm()` or `setcps()`, when it has one. */
	tempo?: Tempo;
}

/**
 * The tempo a song sets. Strudel counts cycles, not beats: `setcpm(140/4)` is 140 BPM in
 * 4/4, as upstream's own documentation of `setcpm` says. With no call, the scheduler runs
 * at 0.5 cycles a second (`this.cps = 0.5` in cyclist.mjs of @strudel/core 1.2.6), so 120
 * BPM.
 */
export interface Tempo {
	/** Beats a minute at 4 beats a cycle, or undefined when the value is not a plain number (a slider, a pattern). */
	bpm?: number;
	/** The whole statement. */
	from: number;
	to: number;
}

export { DEFAULT_BPM } from './controls.ts';
const TEMPO_CALLS: Record<string, number> = { setcpm: 4, setCpm: 4, setcps: 240, setCps: 240 };

/** The last top-level `setcpm(...)` or `setcps(...)`; the last one is what the song plays at. */
function findTempo(statements: Node[]): { statement: Node; bpm?: number } | undefined {
	for (let i = statements.length - 1; i >= 0; i--) {
		const statement = statements[i];
		const call = statement.type === 'ExpressionStatement' ? (statement.expression as Node) : undefined;
		if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || !(call.callee.name in TEMPO_CALLS)) continue;
		const value = arithmetic(call.arguments[0] as Node | undefined);
		const bpm = value === undefined ? undefined : Math.round(value * TEMPO_CALLS[call.callee.name] * 100) / 100;
		return { statement, bpm };
	}
	return undefined;
}

/** A number, or plain arithmetic of numbers (`140/4`). Anything else is not read. */
function arithmetic(node: Node | undefined): number | undefined {
	if (!node) return undefined;
	if (node.type === 'BinaryExpression' && ['+', '-', '*', '/'].includes(node.operator)) {
		const a = arithmetic(node.left);
		const b = arithmetic(node.right);
		if (a === undefined || b === undefined) return undefined;
		return node.operator === '+' ? a + b : node.operator === '-' ? a - b : node.operator === '*' ? a * b : b === 0 ? undefined : a / b;
	}
	if (node.type === 'ParenthesizedExpression') return arithmetic(node.expression);
	return numberOf(node);
}

/**
 * The edit of the BPM box. A number writes `setcpm(<bpm>/4)`, in place of the song's tempo
 * call or as the first statement of the song (after its header comments). No number (a
 * double click) takes the call out, line and all, so the song plays at Strudel's default.
 */
export function tempoEdit(code: string, bpm: number | undefined): { from: number; to: number; insert: string } | undefined {
	let program: Node;
	try {
		program = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' }) as unknown as Node;
	} catch {
		return undefined;
	}
	const statements = (program.body as Node[]) ?? [];
	const found = findTempo(statements);
	if (bpm === undefined) {
		if (!found) return undefined;
		let { start, end } = found.statement;
		// The whole line when the call is alone on it.
		const lineStart = code.lastIndexOf('\n', start - 1) + 1;
		const lineEnd = code.indexOf('\n', end);
		if (!code.slice(lineStart, start).trim() && !code.slice(end, lineEnd < 0 ? code.length : lineEnd).trim()) {
			start = lineStart;
			end = lineEnd < 0 ? code.length : lineEnd + 1;
		}
		return { from: start, to: end, insert: '' };
	}
	if (!Number.isFinite(bpm) || bpm <= 0) return undefined;
	const call = `setcpm(${Math.round(bpm * 100) / 100}/4)`;
	if (found) {
		const expression = found.statement.expression as Node;
		return { from: expression.start, to: expression.end, insert: call };
	}
	const first = statements[0];
	const at = first ? first.start : code.length;
	return { from: at, to: at, insert: `${call}\n` };
}

/**
 * The label a chain gets when its M or S button is clicked, in upstream's own syntax
 * (decision 5 of doc/DAW-PLAN.md): muted `_kick`, soloed `Skick`, both `Skick_`. Upstream
 * silences a label that starts or ends with `_` before it looks at the solo, so the last
 * form is muted, as a muted and soloed track of Live is. The button flips one of the two
 * and keeps the other.
 *
 * The catch of upstream's rule: any label that starts with `S` is a solo, so `Snare` shows
 * as soloed and S off turns it into `nare`. The Mixer shows what upstream does.
 */
export function toggledLabel(label: string, button: 'mute' | 'solo'): string {
	const muted = label.startsWith('_') || label.endsWith('_');
	let base = label.replace(/^_+|_+$/g, '');
	const solo = base.length > 1 && base.startsWith('S');
	if (solo) base = base.slice(1);
	const mute = button === 'mute' ? !muted : muted;
	const soloed = button === 'solo' ? !solo : solo;
	if (soloed) return `S${base}${mute ? '_' : ''}`;
	return mute ? `_${base}` : base;
}

/** The edit of the code that a click on M or S of a chain makes: the label, replaced. */
export function labelEdit(code: string, chain: number, button: 'mute' | 'solo'): { from: number; to: number; insert: string } | undefined {
	const model = readChains(code);
	if ('error' in model) return undefined;
	const target = model.chains[chain];
	if (!target || target.bare || code.slice(target.from, target.from + target.label.length) !== target.label) return undefined;
	return { from: target.from, to: target.from + target.label.length, insert: toggledLabel(target.label, button) };
}

/**
 * The edit a click on G of a chain makes. G on gives the chain a gain fader: a
 * `.gain(0.8)` of its own spine becomes `.gain(slider(0.8, 0, 1))`, so the level stays,
 * else `.gain(slider(1, 0, 1))` goes at the end. G off takes the `.gain(...)` call with the
 * fader out of the spine; a `const` it names stays where it is. A gain inside a function
 * (`.sometimes(x => x.gain(...))`) is not the chain's own, so G off does nothing then.
 */
export function gainEdit(code: string, chain: number): { from: number; to: number; insert: string } | undefined {
	const model = readChains(code);
	if ('error' in model) return undefined;
	const target = model.chains[chain];
	const statement = target && chainStatements(code)[chain];
	if (!statement) return undefined;
	const expression = expressionOf(statement);
	let gainCall: Node | undefined;
	for (let node = expression; node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'; node = node.callee.object) {
		if (node.callee.property?.name === 'gain') gainCall = node;
	}
	if (target.gain === undefined) {
		const argument = gainCall?.arguments?.length === 1 ? (gainCall.arguments[0] as Node) : undefined;
		if (argument?.type === 'Literal' && typeof argument.value === 'number') {
			const level = argument.value as number;
			return { from: argument.start, to: argument.end, insert: `slider(${code.slice(argument.start, argument.end)}, 0, ${Math.max(1, level)})` };
		}
		return { from: expression.end, to: expression.end, insert: '.gain(slider(1, 0, 1))' };
	}
	const slider = model.sliders[target.gain];
	if (!gainCall || !slider) return undefined;
	// Only the spine's own gain, the one that holds the fader: its slider, or the constant it names.
	const inside = code.slice(gainCall.callee.property.end, gainCall.end);
	const holds = (slider.from >= gainCall.start && slider.from < gainCall.end) || (slider.constant !== undefined && new RegExp(`\\b${slider.constant}\\b`).test(inside));
	if (!holds) return undefined;
	return { from: gainCall.callee.object.end, to: gainCall.end, insert: '' };
}

export type Edits = { edits: { from: number; to: number; insert: string }[] } | { refused: string };

/** The last call of a method on the chain's own spine, `a.b().c()`: the one that counts. */
function spineCall(expression: Node, names: string[]): Node | undefined {
	for (let node = expression; node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'; node = node.callee.object) {
		if (names.includes(node.callee.property?.name)) return node;
	}
	return undefined;
}

/**
 * A cable dropped from the duck jack of chain `from` onto chain `to` (see "Editing a
 * sidechain by cable" in doc/DAW-PLAN.md). The orbit of `to` joins the duck list of
 * `from`. A target on no orbit of its own plays on orbit 1 with most of the song, so it
 * gets the next free orbit first. `move` is the orbit of a cable that was pulled off
 * another strip and dropped here: it leaves the list in the same edit.
 */
export function duckEdits(code: string, from: number, to: number, move?: number): Edits {
	const model = readChains(code);
	if ('error' in model) return { refused: 'The code does not parse right now' };
	const ducker = model.chains[from];
	const target = model.chains[to];
	const statements = chainStatements(code);
	if (!ducker || !target || !statements[from] || !statements[to]) return { refused: 'No such chain' };
	if (from === to) return { refused: 'A chain cannot duck itself' };
	if (ducker.duckUnknown) return { refused: `The .duck() of ${ducker.name} is not a plain list of orbits` };
	if (target.orbit === undefined) return { refused: `The .orbit() of ${target.name} is not a plain number` };
	const edits: { from: number; to: number; insert: string }[] = [];
	let orbit = target.orbit;
	if (!target.orbitSet) {
		const used = [1, ...model.chains.flatMap((chain) => [chain.orbit ?? 1, ...(chain.ducks ?? [])])];
		orbit = Math.max(...used) + 1;
		const end = expressionOf(statements[to]).end;
		edits.push({ from: end, to: end, insert: `.orbit(${orbit})` });
	}
	const list = (ducker.ducks ?? []).filter((n) => n !== move);
	if (list.includes(orbit) && move === undefined) return { edits: [] };
	const next = [...new Set([...list, orbit])].sort((a, b) => a - b);
	const call = spineCall(expressionOf(statements[from]), ['duck', 'duckorbit']);
	if (call) {
		const argument = call.arguments[0] as Node;
		edits.push({ from: argument.start, to: argument.end, insert: `"${next.join(':')}"` });
	} else {
		const end = expressionOf(statements[from]).end;
		edits.push({ from: end, to: end, insert: `.duck("${next.join(':')}")` });
	}
	return { edits: edits.sort((a, b) => b.from - a.from) };
}

/**
 * The edit of the scope box under a strip, as G is for gain: a chain without `._scope()`
 * gets one at its end, so the engine gives it an analyser and the Mixer its wave; a chain
 * with one on its own spine loses it. A `._scope()` inside a function is not the chain's
 * own, so nothing then.
 */
export function scopeEdit(code: string, chain: number): { from: number; to: number; insert: string } | undefined {
	const model = readChains(code);
	if ('error' in model) return undefined;
	const statement = chainStatements(code)[chain];
	if (!model.chains[chain] || !statement) return undefined;
	const expression = expressionOf(statement);
	const call = spineCall(expression, ['_scope']);
	if (call) return { from: call.callee.object.end, to: call.end, insert: '' };
	if (model.chains[chain].scope) return undefined;
	return { from: expression.end, to: expression.end, insert: '._scope()' };
}

/** A cable pulled off and dropped on nothing: its orbit leaves the duck list, and `.duck()` goes with the last one. */
export function unduckEdits(code: string, from: number, orbit: number): Edits {
	const model = readChains(code);
	if ('error' in model) return { refused: 'The code does not parse right now' };
	const ducker = model.chains[from];
	const statement = chainStatements(code)[from];
	if (!ducker || !statement || ducker.duckUnknown) return { refused: 'Not a plain list of orbits' };
	const call = spineCall(expressionOf(statement), ['duck', 'duckorbit']);
	if (!call || !ducker.ducks?.includes(orbit)) return { edits: [] };
	const next = ducker.ducks.filter((n) => n !== orbit);
	if (next.length) {
		const argument = call.arguments[0] as Node;
		return { edits: [{ from: argument.start, to: argument.end, insert: `"${next.join(':')}"` }] };
	}
	return { edits: [{ from: call.callee.object.end, to: call.end, insert: '' }] };
}

/** The labeled statements that are chains, in the order of the code, as `readChains` finds them. */
function chainStatements(code: string): Node[] {
	const program = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' }) as unknown as Node;
	return findChains((program.body as Node[]) ?? []);
}

/** Calls that set the song up and play nothing: a last line `setcps(.5)` is not the pattern. */
const SETUP = new Set(['samples', 'setcps', 'setCps', 'setcpm', 'setCpm', 'initHydra', 'hush', 'aliasBank', 'soundAlias', 'register']);

/**
 * The statements that are chains: every labeled one, as the transpiler plays them. A song
 * with none plays the value of its last expression, so that one is the chain (bare).
 */
function findChains(statements: Node[]): Node[] {
	const labeled = statements.filter((statement) => statement.type === 'LabeledStatement' && statement.body?.type === 'ExpressionStatement');
	if (labeled.length) return labeled;
	for (let i = statements.length - 1; i >= 0; i--) {
		const statement = statements[i];
		if (statement.type !== 'ExpressionStatement') continue;
		const expression = statement.expression as Node;
		if (expression.type === 'AwaitExpression' || expression.type === 'AssignmentExpression') continue;
		if (expression.type === 'CallExpression' && expression.callee.type === 'Identifier' && SETUP.has(expression.callee.name)) continue;
		return [statement];
	}
	return [];
}

function expressionOf(statement: Node): Node {
	return (statement.type === 'LabeledStatement' ? statement.body.expression : statement.expression) as Node;
}

/** The model of a song, or the error of the parser when the code does not parse (half typed). */
export function readChains(code: string): MixerModel | { error: string } {
	let program: Node;
	try {
		program = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' }) as unknown as Node;
	} catch (error) {
		return { error: (error as Error).message };
	}
	const statements = (program.body as Node[]) ?? [];

	// Chains, in the order of the code.
	const chains: MixerChain[] = [];
	const chainNodes: Node[] = [];
	for (const statement of findChains(statements)) {
		const bare = statement.type !== 'LabeledStatement';
		const label = bare ? '' : (statement.label.name as string);
		const named = bare ? undefined : chainName(label);
		const fallback = named ? undefined : visualLabel(code, statement.start);
		chains.push({
			label,
			...(bare ? { bare } : {}),
			name: named ?? fallback!.text,
			nameRule: named ? 'label' : fallback!.rule,
			from: statement.start,
			to: statement.end,
			muted: label.startsWith('_') || label.endsWith('_'),
			solo: label.length > 1 && label.startsWith('S'),
			controls: [],
			...routing(expressionOf(statement)),
			...(spineCall(expressionOf(statement), ['_scope']) ? { scope: true } : {}),
		});
		chainNodes.push(statement);
	}

	// Sliders, in the order of the code.
	const sliders: MixerSlider[] = [];
	const sliderAt = new Map<Node, number>();
	walk(program, [], (node) => {
		if (!isSliderCall(node)) return;
		const [value, min, max, step] = node.arguments as Node[];
		sliderAt.set(node, sliders.length);
		sliders.push({
			index: sliders.length,
			from: value.start,
			to: value.end,
			value: numberOf(value) ?? 0,
			min: numberOf(min) ?? 0,
			max: numberOf(max) ?? 1,
			step: numberOf(step),
			label: '',
			detail: sliderLabel(code, value.start).text,
			chains: [],
		});
	});

	// Constants that hold sliders: `const KICK_VOL = slider(...)`, and constants made of
	// those, `const LOUD = KICK_VOL.mul(2)`. Only top level `const`: a `let` can change.
	const constants = new Map<string, Set<number>>();
	/** The declarations of those constants. What is inside them is a definition, not a use. */
	const definitions: Node[] = [];
	for (const statement of statements) {
		if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
		for (const declarator of statement.declarations as Node[]) {
			if (declarator.id?.type !== 'Identifier' || !declarator.init) continue;
			const held = new Set<number>();
			const own: number[] = [];
			walk(declarator.init, [], (node) => {
				const index = sliderAt.get(node);
				if (index !== undefined) held.add(index), own.push(index);
				if (node.type === 'Identifier') constants.get(node.name)?.forEach((i) => held.add(i));
			});
			if (!held.size) continue;
			constants.set(declarator.id.name, held);
			definitions.push(declarator);
			if (own.length === 1) sliders[own[0]].constant = declarator.id.name;
		}
	}

	// Where each slider is used: in which chain, as the argument of which call.
	const chainOf = (position: number) => chains.findIndex((chain) => chain.from <= position && position < chain.to);
	walk(program, [], (node, parents) => {
		const parent = parents[parents.length - 1];
		let held: number[] = [];
		const direct = sliderAt.get(node);
		if (direct !== undefined) held = [direct];
		else if (node.type === 'Identifier' && constants.has(node.name) && isReference(node, parent)) held = [...constants.get(node.name)!];
		if (!held.length || definitions.some((d) => parents.includes(d))) return;
		const chain = chainOf(node.start);
		const call = feedingCall(node, parents);
		for (const index of held) {
			const slider = sliders[index];
			if (!slider.label && call) slider.label = call;
			if (chain >= 0 && !slider.chains.includes(chain)) {
				slider.chains.push(chain);
				const target = chains[chain];
				if (call === 'gain' && target.gain === undefined) target.gain = index;
				else if (target.gain !== index && !target.controls.includes(index)) target.controls.push(index);
			}
		}
	});
	for (const slider of sliders) if (!slider.label) slider.label = slider.detail;
	for (const chain of chains) chain.controls.sort((a, b) => a - b);

	// Duck cables: from the chain that ducks to every chain on a ducked orbit.
	const ducks: DuckCable[] = [];
	chains.forEach((chain, from) => {
		for (const orbit of chain.ducks ?? []) {
			const targets = chains.map((other, index) => (other.orbit === orbit && index !== from ? index : -1)).filter((i) => i >= 0);
			if (!targets.length) ducks.push({ from, orbit });
			for (const to of targets) ducks.push({ from, to, orbit });
		}
	});

	const global = sliders.filter((slider) => !slider.chains.length).map((slider) => slider.index);
	const tempo = findTempo(statements);
	return { chains, sliders, ducks, global, ...(tempo ? { tempo: { bpm: tempo.bpm, from: tempo.statement.start, to: tempo.statement.end } } : {}) };
}

/**
 * The name a strip shows for a label. `$kick` and `_$kick` and `kick_` give "kick". `S$kick`
 * gives "kick", but `Skick` stays "Skick": upstream solos both, and we cannot tell `Snare`
 * from a soloed `nare`. An anonymous `$` has no name.
 */
function chainName(label: string): string | undefined {
	let name = label.replace(/^_+|_+$/g, '');
	if (name.startsWith('S$')) name = name.slice(1);
	name = name.replace(/^\$/, '');
	return name || undefined;
}

/**
 * `.orbit(n)` and `.duck("...")` of a chain. Only the calls of the chain itself count, the
 * spine `a.b().c().d()`. One inside a function (`.sometimes(x => x.orbit(3))`) makes the
 * value unknown, because it changes from event to event.
 */
function routing(expression: Node): Pick<MixerChain, 'orbit' | 'orbitSet' | 'ducks' | 'duckUnknown'> {
	const spine = new Set<Node>();
	for (let node = expression; node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'; node = node.callee.object) spine.add(node);
	let orbit: number | undefined;
	let orbitUnknown = false;
	let ducks: number[] | undefined;
	let duckUnknown = false;
	walk(expression, [], (node) => {
		const method = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' ? (node.callee.property.name as string) : undefined;
		if (method === 'orbit' || method === 'o') {
			// The walk meets the last call of the spine first, and the last call is the one that counts.
			const value = spine.has(node) ? integerOf(node.arguments[0]) : undefined;
			if (value === undefined) orbitUnknown = true;
			else orbit ??= value;
		} else if (method === 'duck' || method === 'duckorbit') {
			const list = spine.has(node) ? orbitList(node.arguments[0]) : undefined;
			if (list) ducks = [...new Set([...(ducks ?? []), ...list])];
			else duckUnknown = true;
		}
	});
	return { orbit: orbitUnknown ? undefined : (orbit ?? 1), ...(orbit !== undefined && !orbitUnknown ? { orbitSet: true } : {}), ...(ducks ? { ducks } : {}), ...(duckUnknown ? { duckUnknown } : {}) };
}

/** `2` or `"2"`. */
function integerOf(node: Node | undefined): number | undefined {
	const value = node?.type === 'Literal' ? node.value : undefined;
	const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
	return typeof number === 'number' && Number.isInteger(number) ? number : undefined;
}

/**
 * `"2:3"`, `"2,3,4"`, `"2 3"` or `2`. A pattern that changes (`"<2 3>"`) is not a list we can draw.
 * We write `"2:3"`, as upstream documents it. `"2,3,4"` is read too, but it is a stack: the
 * chain plays once per orbit, so the demo's kick sounded four times over (measured 2026-11-21).
 */
function orbitList(node: Node | undefined): number[] | undefined {
	const value = node?.type === 'Literal' ? node.value : undefined;
	if (typeof value === 'number') return Number.isInteger(value) ? [value] : undefined;
	if (typeof value !== 'string' || !/^[\d\s,:]+$/.test(value)) return undefined;
	const list = value.split(/[\s,:]+/).filter(Boolean).map(Number);
	return list.length ? list : undefined;
}

function numberOf(node: Node | undefined): number | undefined {
	if (node?.type === 'Literal' && typeof node.value === 'number') return node.value;
	if (node?.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return -node.argument.value;
	return undefined;
}

function isSliderCall(node: Node): boolean {
	return node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'slider' && node.arguments.length > 0;
}

/** An identifier that reads a variable, not the name of a property or a declaration. */
function isReference(node: Node, parent: Node | undefined): boolean {
	if (!parent) return true;
	if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
	if (parent.type === 'Property' && parent.key === node && !parent.computed && parent.value !== node) return false;
	if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
	return true;
}

/**
 * The call whose arguments hold `node`, going up through anything that is not a call:
 * `.gain(KICK_VOL)` and `.gain(KICK_VOL.mul(2))` give "gain", `.lpf(sine.range(200,
 * slider(...)))` gives "range", as the stage's rule does. Arithmetic is not the call a
 * slider feeds: `.lpf(curve.mul(OPEN))` gives "lpf", where a song scales a curve of its
 * arrangement with a slider (template/demo.strudel).
 */
const ARITHMETIC = new Set(['mul', 'add', 'sub', 'div', 'mod']);

function feedingCall(node: Node, parents: Node[]): string | undefined {
	let child = node;
	for (let i = parents.length - 1; i >= 0; i--) {
		const parent = parents[i];
		if (parent.type === 'CallExpression' && (parent.arguments as Node[]).includes(child)) {
			const callee = parent.callee;
			if (callee.type === 'MemberExpression' && !callee.computed && ARITHMETIC.has(callee.property.name)) {
				child = parent;
				continue;
			}
			if (callee.type === 'MemberExpression' && !callee.computed) return callee.property.name;
			if (callee.type === 'Identifier') return callee.name;
			return undefined;
		}
		if (/Statement|Declaration|Function/.test(parent.type)) return undefined;
		child = parent;
	}
	return undefined;
}

// ---- a walker for acorn's tree --------------------------------------------------------

// The tree is read loosely: acorn's own types would need a type guard at every step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** Calls `visit` for every node in the order of the code, with the nodes above it. */
function walk(node: Node, parents: Node[], visit: (node: Node, parents: Node[]) => void): void {
	visit(node, parents);
	parents.push(node);
	for (const key in node) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const value = node[key];
		if (Array.isArray(value)) {
			for (const child of value) if (child && typeof child.type === 'string') walk(child, parents, visit);
		} else if (value && typeof value.type === 'string') {
			walk(value, parents, visit);
		}
	}
	parents.pop();
}
