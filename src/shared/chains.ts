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
	/** The label as it is written: `$kick`, `lowendbass`, `_$snare`, `$`. */
	label: string;
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
	/** The orbits of `.duck("2,3,4")`. Undefined when the chain does not duck or the value is not a literal. */
	ducks?: number[];
	/** It ducks, but the orbits are not a literal we can read. */
	duckUnknown?: boolean;
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
	for (const statement of statements) {
		if (statement.type !== 'LabeledStatement' || statement.body?.type !== 'ExpressionStatement') continue;
		const label = statement.label.name as string;
		const named = chainName(label);
		const fallback = named ? undefined : visualLabel(code, statement.start);
		chains.push({
			label,
			name: named ?? fallback!.text,
			nameRule: named ? 'label' : fallback!.rule,
			from: statement.start,
			to: statement.end,
			muted: label.startsWith('_') || label.endsWith('_'),
			solo: label.length > 1 && label.startsWith('S'),
			controls: [],
			...routing(statement.body.expression),
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
	return { chains, sliders, ducks, global };
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
function routing(expression: Node): Pick<MixerChain, 'orbit' | 'ducks' | 'duckUnknown'> {
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
	return { orbit: orbitUnknown ? undefined : (orbit ?? 1), ...(ducks ? { ducks } : {}), ...(duckUnknown ? { duckUnknown } : {}) };
}

/** `2` or `"2"`. */
function integerOf(node: Node | undefined): number | undefined {
	const value = node?.type === 'Literal' ? node.value : undefined;
	const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
	return typeof number === 'number' && Number.isInteger(number) ? number : undefined;
}

/** `"2,3,4"`, `"2:3"`, `"2 3"` or `2`. A pattern that changes (`"<2 3>"`) is not a list we can draw. */
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
 * slider(...)))` gives "range", as the stage's rule does.
 */
function feedingCall(node: Node, parents: Node[]): string | undefined {
	let child = node;
	for (let i = parents.length - 1; i >= 0; i--) {
		const parent = parents[i];
		if (parent.type === 'CallExpression' && (parent.arguments as Node[]).includes(child)) {
			const callee = parent.callee;
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
