// Where in the code an evaluation error belongs. Strudel reports an error as a message.
// Only a syntax error carries a position. For the others we read the message, by the
// rules below, in this order. A rule that finds nothing leaves the error without a
// place, and the host then puts it on the first line.
//
// 1. `pos`: the parser (acorn) gives the offset of a syntax error.
// 2. "[mini] parse error at line N": mini-notation gives the line of the string.
// 3. "x is not defined": the first use of the name `x`.
// 4. "....x is not a function": the first call of `.x(`.
//
// Rules 3 and 4 take the first place the name is written. When the name is written
// more than once, that may be the wrong one.

export interface ErrorPlace {
	from: number;
	to: number;
	/** The rule that found the place, as in the list above. */
	rule: 'position' | 'mini line' | 'name' | 'call';
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
	const name = /^([A-Za-z_$][\w$]*) is not defined$/.exec(message);
	if (name) {
		const found = new RegExp(`(?<![\\w$.])${escape(name[1])}(?![\\w$])`).exec(code);
		if (found) return { from: found.index, to: found.index + name[1].length, rule: 'name' };
	}
	const call = /\.([A-Za-z_$][\w$]*) is not a function$/.exec(message);
	if (call) {
		const found = new RegExp(`\\.\\s*${escape(call[1])}\\s*\\(`).exec(code);
		if (found) {
			const from = code.indexOf(call[1], found.index);
			return { from, to: from + call[1].length, rule: 'call' };
		}
	}
	return undefined;
}
