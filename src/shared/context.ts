// Names for things in a song, worked out from the code around them.
//
// The stage shows a scope or a slider away from the line that made it, so it needs a
// label that tells the user which one it is. Nothing in the language gives that name,
// so we read the surroundings and pick the best hint there is. This is guessing by
// rule. The rules are below, in the order they are tried, and every answer says which
// rule gave it, so a wrong label can be traced to its rule and the rule tuned.
//
// To change the behavior, edit the rules here and add a case to context.test.ts.

import { parse } from 'acorn';

/** Which rule produced a label. Shown as a tooltip in the stage. */
export type LabelRule = 'pattern label' | 'variable' | 'property' | 'call' | 'comment' | 'code';

export interface ContextLabel {
	text: string;
	rule: LabelRule;
}

/** Longest label we show. Longer text is cut and ends in "...". */
const MAX = 40;

// ---- rules for a visual (a scope, a piano roll...) --------------------------------
//
// `position` is anywhere inside the expression that draws, usually the end of the
// `._scope()` call. We first find the line where that expression starts, then try:
//
//   1. pattern label  `$kick: s("bd*4")._scope()`            -> "kick"
//                     `snare: s("~ sd")._scope()`            -> "snare"
//   2. variable       `const drums = s("bd")._scope()`       -> "drums"
//   3. comment        the line right above the expression,
//                     `// Rolling hihat`                     -> "Rolling hihat"
//   4. code           the start of the expression itself,
//                     `$: s("hh*16")...`                     -> `s("hh*16")...`
//
// An anonymous `$:` is not a name, so it falls through to the comment and the code.

export function visualLabel(code: string, position: number): ContextLabel {
	const lines = code.split('\n');
	const start = statementStart(lines, lineOf(code, position));
	const first = lines[start];
	const named = patternLabel(first);
	if (named) return { text: named, rule: 'pattern label' };
	const variable = declaredName(first);
	if (variable) return { text: humanize(variable), rule: 'variable' };
	const comment = commentAbove(lines, start) ?? trailingComment(lines[lineOf(code, position)]);
	if (comment) return { text: shorten(comment), rule: 'comment' };
	return { text: shorten(first.trim().replace(/^\$\w*:\s*/, '')), rule: 'code' };
}

// ---- rules for a slider -------------------------------------------------------------
//
// `position` is the start of the slider's first argument, the number, which is what
// the transpiler reports. Tried in this order:
//
//   1. variable   `const KICK_VOL = slider(.5, 0, 1)`        -> "kick vol"
//   2. property   `{ cutoff: slider(800, 200, 4000) }`       -> "cutoff"
//   3. call       `.lpf(slider(800, 200, 4000))`             -> "lpf"
//                 with the name of the pattern in front when it has one:
//                 `$bass: note("c2").lpf(slider(...))`       -> "bass lpf"
//   4. comment    at the end of the same line, or right above the expression
//   5. code       the line the slider is on
//
// The call in rule 3 is the one whose brackets hold the slider directly. In
// `.lpf(sine.range(200, slider(...)))` that is `range`, not `lpf`.

export function sliderLabel(code: string, position: number): ContextLabel {
	const lines = code.split('\n');
	const line = lineOf(code, position);
	const callStart = code.lastIndexOf('slider(', position);
	const before = callStart >= 0 ? code.slice(0, callStart) : code.slice(0, position);

	const variable = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
	if (variable) return { text: humanize(variable[1]), rule: 'variable' };
	const property = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before);
	// `$bass: slider(...)` is a pattern label, not a property. It is handled as a call owner below.
	if (property && !/^\s*\$?\w*:\s*$/.test(lineText(before))) return { text: humanize(property[1]), rule: 'property' };

	const call = enclosingCall(before);
	if (call) {
		const owner = visualLabel(code, position);
		const prefix = owner.rule === 'pattern label' || owner.rule === 'variable' ? `${owner.text} ` : '';
		return { text: shorten(prefix + humanize(call)), rule: 'call' };
	}

	const comment = trailingComment(lines[line]) ?? commentAbove(lines, statementStart(lines, line));
	if (comment) return { text: shorten(comment), rule: 'comment' };
	return { text: shorten(lines[line].trim()), rule: 'code' };
}

// ---- the pieces -----------------------------------------------------------------------

function lineOf(code: string, position: number): number {
	let line = 0;
	for (let index = code.indexOf('\n'); index >= 0 && index < position; index = code.indexOf('\n', index + 1)) line++;
	return line;
}

/** The text of the last line of `text`. */
function lineText(text: string): string {
	return text.slice(text.lastIndexOf('\n') + 1);
}

/**
 * The line where the expression that covers `line` starts. Strudel code is written as
 * chains, one call per line, so we walk up while a line looks like a continuation: it
 * is indented, it starts with a `.` or a closing bracket, or the line above it ends in
 * a way that cannot end a statement. A blank line stops the walk.
 *
 * A comment line stops it too, unless the line below it is clearly the middle of a
 * chain (it starts with a `.` or a closing bracket). People put a comment between two
 * calls of a chain to explain the next call, and the chain goes on above it.
 */
function statementStart(lines: string[], line: number): number {
	let start = line;
	while (start > 0) {
		const current = lines[start];
		const above = lines[start - 1].trim();
		if (above === '') break;
		const midChain = /^[.)\]}]/.test(current.trim());
		if (above.startsWith('//')) {
			if (!midChain) break;
			start--;
			continue;
		}
		// A comment we stepped over is not code: look at the next real line instead.
		if (current.trim().startsWith('//')) {
			start--;
			continue;
		}
		const continues = /^\s/.test(current) || midChain || /[([{,.=]\s*$/.test(above);
		if (!continues) break;
		start--;
	}
	// Never answer with a comment line: step back down to the code.
	while (start < line && lines[start].trim().startsWith('//')) start++;
	return start;
}

/**
 * The name of the function whose open bracket is still open at the end of `before`,
 * that is, the call the next character is an argument of. Brackets inside strings are
 * not counted. Looks no further back than the start of the statement would be: 400
 * characters.
 */
function enclosingCall(before: string): string | undefined {
	let depth = 0;
	let quote = '';
	for (let index = before.length - 1; index >= Math.max(0, before.length - 400); index--) {
		const char = before[index];
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'" || char === '`') quote = char;
		else if (char === ')') depth++;
		else if (char === '(') {
			if (depth > 0) depth--;
			else return /([A-Za-z_$][\w$]*)$/.exec(before.slice(0, index))?.[1];
		}
	}
	return undefined;
}

/** `$kick: ...` -> "kick", `snare: ...` -> "snare". `$: ...` has no name. Only at the very start of a line. */
function patternLabel(line: string): string | undefined {
	return /^\$?([A-Za-z_][\w]*)\s*:/.exec(line)?.[1];
}

function declaredName(line: string): string | undefined {
	return /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
}

/**
 * The comment on the lines right above `start`, the nearest one that says something.
 * Banners drawn with characters and rulers of dashes are skipped: a comment counts when
 * it has three letters in a row and is mostly letters, digits and spaces.
 */
function commentAbove(lines: string[], start: number): string | undefined {
	for (let line = start - 1; line >= 0; line--) {
		const text = lines[line].trim();
		if (!text.startsWith('//')) return undefined;
		const comment = text.replace(/^\/+\s*/, '').trim();
		if (isWords(comment) && !comment.startsWith('@')) return comment;
	}
	return undefined;
}

function trailingComment(line: string): string | undefined {
	// Not inside a string: we only take a `//` that comes after the last quote of the line.
	const quote = Math.max(line.lastIndexOf('"'), line.lastIndexOf("'"), line.lastIndexOf('`'));
	const index = line.indexOf('//', quote + 1);
	if (index <= 0 || line.slice(0, index).trim() === '') return undefined;
	const comment = line.slice(index + 2).trim();
	return isWords(comment) ? comment : undefined;
}

function isWords(text: string): boolean {
	const plain = text.replace(/[^A-Za-z0-9 ]/g, '').length;
	return /[A-Za-z]{3}/.test(text) && plain / text.length >= 0.7;
}

/** `KICK_VOL` -> "kick vol", `bassEnergy` -> "bass energy". A short all-lowercase name is kept as it is. */
function humanize(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_$]+/g, ' ')
		.trim()
		.toLowerCase();
}

function shorten(text: string): string {
	const single = text.replace(/\s+/g, ' ').trim();
	return single.length > MAX ? `${single.slice(0, MAX - 3)}...` : single;
}

/**
 * Whether a position is inside a string literal of its line: `s("bd hh <>")`. Insert at
 * the cursor then types only a name, not a whole `s("...")` call inside the string. Strudel
 * code is read line by line here: a mini-notation string over several lines (backticks) is
 * only seen on the line where it starts.
 */
export function insideString(code: string, position: number): boolean {
	const lineStart = code.lastIndexOf('\n', position - 1) + 1;
	let quote = '';
	for (let i = lineStart; i < position; i++) {
		const char = code[i];
		if (quote) {
			if (char === '\\') i++;
			else if (char === quote) quote = '';
		} else if (char === '"' || char === "'" || char === '`') {
			quote = char;
		} else if (char === '/' && code[i + 1] === '/') {
			return false;
		}
	}
	return quote !== '';
}

/**
 * An argument form of an insert: inside the empty parentheses of one of `calls`, `.midi(|)`, the click types `text`
 * (`'M-VAVE FM-1'`) and not the whole call, which gave `.midi(.midi('M-VAVE FM-1'))` (the maintainer, 2026-11-22).
 */
export interface InsertArgument {
	calls: string[];
	text: string;
}

/**
 * What an insert at `position` types: the argument inside the empty parentheses of one of its calls, the bare name
 * inside a string, else the whole text.
 */
export function chooseInsert(code: string, position: number, text: string, bare?: string, argument?: InsertArgument): string {
	if (argument) {
		const before = code.slice(code.lastIndexOf('\n', position - 1) + 1, position);
		const after = code.slice(position, position + 200);
		const call = /(?<![\w$])([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(before);
		if (call && argument.calls.includes(call[1]) && /^\s*\)/.test(after)) return argument.text;
	}
	if (bare !== undefined && insideString(code, position)) return bare;
	return text;
}

export interface InsertEdit {
	from: number;
	to: number;
	insert: string;
}

/** Finds the opening quote offset and quote char for a position inside a string on its line. */
function stringBoundsOnLine(code: string, position: number): { start: number; end: number; quote: string } | undefined {
	const lineStart = code.lastIndexOf('\n', position - 1) + 1;
	const lineEndIdx = code.indexOf('\n', position);
	const lineEnd = lineEndIdx < 0 ? code.length : lineEndIdx;
	let quote = '';
	let openAt = -1;
	for (let i = lineStart; i < position; i++) {
		const char = code[i];
		if (quote) {
			if (char === '\\') i++;
			else if (char === quote) {
				quote = '';
				openAt = -1;
			}
		} else if (char === '"' || char === "'" || char === '`') {
			quote = char;
			openAt = i;
		} else if (char === '/' && code[i + 1] === '/') {
			return undefined;
		}
	}
	if (!quote || openAt < 0) return undefined;
	let closeAt = lineEnd;
	for (let i = position; i < lineEnd; i++) {
		const char = code[i];
		if (char === '\\') i++;
		else if (char === quote) {
			closeAt = i;
			break;
		}
	}
	return { start: openAt, end: closeAt, quote };
}

/**
 * Finds the edit needed to add or update `.bank("<bank>")` on the call chain whose `s(...)`/`sound(...)` holds
 * `position`, or undefined when the chain already has that exact bank.
 */
function bankCallEdit(code: string, position: number, bank: string): InsertEdit | undefined {
	const quoted = `"${bank}"`;
	// Try AST walk first so multiline chains (`s("bd")\n  .gain(0.8)\n  .bank("RolandTR808")`) are handled accurately.
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const program = parse(code, { ecmaVersion: 2022, allowAwaitOutsideFunction: true, sourceType: 'script' }) as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let foundCall: any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let foundParents: any[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const visit = (node: any, parents: any[]) => {
			if (!node || typeof node !== 'object') return;
			if (node.type === 'CallExpression' && node.start <= position && position <= node.end) {
				const callee = node.callee;
				const name =
					callee?.type === 'Identifier'
						? callee.name
						: callee?.type === 'MemberExpression' && !callee.computed
							? callee.property?.name
							: undefined;
				if (name === 's' || name === 'sound') {
					foundCall = node;
					foundParents = [...parents];
				}
			}
			parents.push(node);
			for (const key in node) {
				if (key === 'type' || key === 'start' || key === 'end') continue;
				const value = node[key];
				if (Array.isArray(value)) {
					for (const child of value) if (child && typeof child.type === 'string') visit(child, parents);
				} else if (value && typeof value.type === 'string') {
					visit(value, parents);
				}
			}
			parents.pop();
		};
		visit(program, []);
		if (foundCall) {
			// Walk up to the outermost call on this chain spine.
			let top = foundCall;
			for (let i = foundParents.length - 1; i >= 1; i--) {
				const member = foundParents[i];
				const call = foundParents[i - 1];
				if (member.type === 'MemberExpression' && member.object === top && call.type === 'CallExpression' && call.callee === member) {
					top = call;
					i--;
				} else {
					break;
				}
			}
			// Walk down the spine looking for `.bank(...)`.
			for (let node = top; node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression'; node = node.callee.object) {
				if (node.callee.property?.name === 'bank') {
					const arg = node.arguments?.[0];
					if (arg?.type === 'Literal' && typeof arg.value === 'string') {
						if (arg.value === bank) return undefined;
						const q = code[arg.start] === "'" ? "'" : '"';
						return { from: arg.start, to: arg.end, insert: `${q}${bank}${q}` };
					}
					return undefined;
				}
			}
			return { from: foundCall.end, to: foundCall.end, insert: `.bank(${quoted})` };
		}
	} catch {
		// Code has a temporary syntax error elsewhere; fall back to local line scan below.
	}
	const bounds = stringBoundsOnLine(code, position);
	if (!bounds) return undefined;
	const closeParen = code.indexOf(')', bounds.end + 1);
	if (closeParen < 0) return undefined;
	const lineEndIdx = code.indexOf('\n', closeParen);
	const tail = code.slice(closeParen + 1, lineEndIdx < 0 ? code.length : lineEndIdx);
	const existing = /\.bank\s*\(\s*(['"])([^'"]*)\1\s*\)/.exec(tail);
	if (existing) {
		if (existing[2] === bank) return undefined;
		const quote = existing[1];
		const matchStart = closeParen + 1 + existing.index;
		const argOffset = existing[0].indexOf(quote);
		const from = matchStart + argOffset;
		const to = from + existing[2].length + 2;
		return { from, to, insert: `${quote}${bank}${quote}` };
	}
	return { from: closeParen + 1, to: closeParen + 1, insert: `.bank(${quoted})` };
}

/**
 * Full edit list for inserting an item at `[from, to]` in `code`.
 * For banked drum/sample sounds inserted inside `s("...")` / `sound("...")`, inserts the short name (`bare`)
 * and adds or updates `.bank("...")` on the chain in the same undo step.
 */
export function chooseInsertEdits(
	code: string,
	from: number,
	to: number,
	text: string,
	bare?: string,
	argument?: InsertArgument,
	bank?: string,
): InsertEdit[] {
	if (bank && insideString(code, from)) {
		const bounds = stringBoundsOnLine(code, from);
		const call = bounds ? enclosingCall(code.slice(0, bounds.start)) : undefined;
		if (call === 'bank') return [{ from, to, insert: bank }];
		const primary: InsertEdit = { from, to, insert: bare ?? text };
		if (call === 's' || call === 'sound') {
			const extra = bankCallEdit(code, from, bank);
			if (extra) return [primary, extra].sort((a, b) => a.from - b.from);
		}
		return [primary];
	}
	return [{ from, to, insert: chooseInsert(code, from, text, bare, argument) }];
}
