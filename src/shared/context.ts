// Names for things in a song, worked out from the code around them.
//
// The stage shows a scope or a slider away from the line that made it, so it needs a
// label that tells the user which one it is. Nothing in the language gives that name,
// so we read the surroundings and pick the best hint there is. This is guessing by
// rule. The rules are below, in the order they are tried, and every answer says which
// rule gave it, so a wrong label can be traced to its rule and the rule tuned.
//
// To change the behavior, edit the rules here and add a case to context.test.ts.

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
