// The rule behind typing `//` over a selection in the Strudel editor: the selected lines
// get `// ` in front, or lose it again. Kept apart from CodeMirror so the cases can be
// tested in `comment.test.ts`.

export const MARK = '// ';

export interface LineEdit {
	/** Offset in the whole text where `insert` goes, or where `MARK` is removed. */
	at: number;
	insert: string;
	remove: number;
}

/**
 * The edits that comment or uncomment the lines from `from` to `to` (offsets in `text`).
 * A selection that ends at the very start of a line does not take that line, as in every
 * editor. Empty lines are left alone.
 *
 * When every line with text starts with `// ` after its indentation, that `// ` is
 * removed, and only that: a line commented by hand as `//x` stays as it is. Otherwise
 * each line with text gets `// ` at the indentation the lines share, so an indented block
 * keeps its shape.
 */
export function toggleComment(text: string, from: number, to: number): LineEdit[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
	const lineOf = (offset: number) => {
		let line = 0;
		while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
		return line;
	};
	const first = lineOf(from);
	let last = lineOf(to);
	if (to > from && last > first && starts[last] === to) last--;

	const lines: { start: number; text: string; indent: number }[] = [];
	for (let line = first; line <= last; line++) {
		const start = starts[line];
		const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
		const content = text.slice(start, end).replace(/\r$/, '');
		if (!content.trim()) continue;
		lines.push({ start, text: content, indent: content.length - content.trimStart().length });
	}
	if (!lines.length) return [];

	if (lines.every((line) => line.text.startsWith(MARK, line.indent))) {
		return lines.map((line) => ({ at: line.start + line.indent, insert: '', remove: MARK.length }));
	}
	const indent = Math.min(...lines.map((line) => line.indent));
	return lines.map((line) => ({ at: line.start + indent, insert: MARK, remove: 0 }));
}

/** Applies the edits to a text. For the tests; the editor applies them as one change. */
export function applyEdits(text: string, edits: LineEdit[]): string {
	let result = text;
	for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
		result = result.slice(0, edit.at) + edit.insert + result.slice(edit.at + edit.remove);
	}
	return result;
}
