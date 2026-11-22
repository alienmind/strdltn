// Where in the code an evaluation error belongs. Strudel reports an error as a message.
// Only a syntax error carries a position. For the others we read the message, by the
// rules below, in this order. A rule that finds nothing leaves the error without a
// place, and the host then puts it on the first line.
//
// 1. `pos`: the parser (acorn) gives the offset of a syntax error.
// 2. "[mini] parse error at line N": mini-notation gives the line of the string.
// 3. "x is not defined", or "Cannot access 'x' before initialization": the first use of `x`.
// 4. "....x is not a function": the first call of `.x(`.
// 5. A message that shows a call, `name('...')`: the first call of `name(`.
//
// Rules 3 and 4 take the first place the name is written outside a comment. When the
// name is written more than once, that may be the wrong one.

export interface ErrorPlace {
	from: number;
	to: number;
	/** The rule that found the place, as in the list above. */
	rule: 'position' | 'mini line' | 'name' | 'call' | 'shown call';
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function locateError(code: string, error: { message?: string; pos?: unknown }): ErrorPlace | undefined {
	const message = String(error.message ?? '');
	if (typeof error.pos === 'number' && error.pos >= 0 && error.pos <= code.length) {
		return { from: error.pos, to: Math.min(code.length, error.pos + 1), rule: 'position' };
	}
	const mini = /^\[mini\] parse error at line (\d+)/.exec(message);
	if (mini) {
		const lines = code.split('\n');
		const index = Number(mini[1]) - 1;
		if (index >= 0 && index < lines.length) {
			const from = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
			const indent = lines[index].length - lines[index].trimStart().length;
			return { from: from + indent, to: from + lines[index].length, rule: 'mini line' };
		}
	}
	// A comment may name the function too: a header that explains `.midi()` came first and
	// took the mark (seen in examples/09-midi-out.strudel).
	const bare = withoutComments(code);
	// "Cannot access 'X' before initialization": a const used above its line. Its first use is the place.
	const name = /^([A-Za-z_$][\w$]*) is not defined$/.exec(message) ?? /^Cannot access '([A-Za-z_$][\w$]*)' before initialization$/.exec(message);
	if (name) {
		const found = new RegExp(`(?<![\\w$.])${escape(name[1])}(?![\\w$])`).exec(bare);
		if (found) return { from: found.index, to: found.index + name[1].length, rule: 'name' };
	}
	const call = /\.([A-Za-z_$][\w$]*) is not a function$/.exec(message);
	if (call) {
		const found = new RegExp(`\\.\\s*${escape(call[1])}\\s*\\(`).exec(bare);
		if (found) {
			const from = bare.indexOf(call[1], found.index);
			return { from, to: from + call[1].length, rule: 'call' };
		}
	}
	// 5. A message that shows the call it is about, as our MIDI messages do ("for example midin('...')").
	for (const quoted of message.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\(['"]/g)) {
		const found = new RegExp(`(?<![\\w$])${escape(quoted[1])}\\s*\\(`).exec(bare);
		if (found) return { from: found.index, to: found.index + quoted[1].length, rule: 'shown call' };
	}
	return undefined;
}

/**
 * The code with every comment turned into spaces, so the offsets stay. Strings are
 * skipped over, so the `//` of an address inside one is not taken for a comment.
 */
export function withoutComments(code: string): string {
	let out = '';
	let i = 0;
	while (i < code.length) {
		const c = code[i];
		if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			// A quote ends at its pair; a plain string also at the end of the line.
			while (j < code.length && code[j] !== c && (c === '`' || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1;
			out += code.slice(i, j + 1);
			i = j + 1;
		} else if (c === '/' && code[i + 1] === '/') {
			const end = code.indexOf('\n', i);
			const j = end < 0 ? code.length : end;
			out += ' '.repeat(j - i);
			i = j;
		} else if (c === '/' && code[i + 1] === '*') {
			const end = code.indexOf('*/', i + 2);
			const j = end < 0 ? code.length : end + 2;
			out += code.slice(i, j).replace(/[^\n]/g, ' ');
			i = j;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}
