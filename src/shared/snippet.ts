// A snippet is a .strudel file with an optional header of comment lines. The header
// uses the form Strudel itself uses for the metadata of a song (`// @title ...`,
// `// @by ...`), so a snippet stays an ordinary Strudel file. We read two more fields,
// `@category` and `@tags`, and `@credits` for whose idea a snippet builds on.

export const CATEGORIES = ['drums', 'bass', 'melody', 'chords', 'texture', 'effect', 'function', 'song', 'visual'] as const;

export interface SnippetInfo {
	/** Path below the library folder, without the extension: `drums/four-on-the-floor`. */
	name: string;
	/** The folders of that path, `drums` or `drums/latin`. Empty for a file at the top. */
	folder: string;
	title: string;
	/** Header fields in the order they were written, without the title. */
	fields: { name: string; value: string }[];
	category?: string;
	/** The file without its header. This is what gets inserted and previewed. */
	code: string;
}

const FIELD = /^@(\w+)\s+(.*\S)\s*$/;
/** The older upstream form: `// "coastline" @by eddyflux`. */
const QUOTED_TITLE = /^"([^"]+)"\s*(?:@by\s+(.*\S))?\s*$/;

/**
 * Splits a file into header fields and code. The header is the run of comments at the
 * very top that carry `@name value` lines, as `//` lines or inside one block comment.
 * A top comment without any field is not a header and stays in the code.
 */
export function parseSnippet(name: string, text: string): SnippetInfo {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const fields: { name: string; value: string }[] = [];
	let title = '';
	let index = 0;
	let inBlock = false;
	for (; index < lines.length; index++) {
		let line = lines[index].trim();
		if (!inBlock && line.startsWith('/*')) {
			inBlock = true;
			line = line.slice(2).trim();
		}
		let content: string;
		if (inBlock) {
			const end = line.indexOf('*/');
			content = (end >= 0 ? line.slice(0, end) : line).replace(/^\*\s?/, '').trim();
			if (end >= 0) inBlock = false;
		} else if (line.startsWith('//')) {
			content = line.slice(2).trim();
		} else if (line === '') {
			continue;
		} else {
			break;
		}
		const field = FIELD.exec(content);
		const quoted = QUOTED_TITLE.exec(content);
		if (field) {
			if (field[1] === 'title') title = field[2];
			else fields.push({ name: field[1], value: field[2] });
		} else if (quoted && !title) {
			title = quoted[1];
			if (quoted[2]) fields.push({ name: 'by', value: quoted[2] });
		} else if (content !== '' && !inBlock) {
			// An ordinary comment. If no field came before it, the file has no header.
			if (!fields.length && !title) {
				index = 0;
				break;
			}
			break;
		}
	}
	const hasHeader = fields.length > 0 || title !== '';
	const code = (hasHeader ? lines.slice(index) : lines).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
	const cut = name.lastIndexOf('/');
	return {
		name,
		folder: cut >= 0 ? name.slice(0, cut) : '',
		title: title || name.slice(cut + 1),
		fields,
		category: fields.find((field) => field.name === 'category')?.value.toLowerCase(),
		code,
	};
}

/**
 * The text of a snippet file with its `@tags` line set to `tags`. The Browser writes tags
 * of a snippet here, in its own header, so they travel with the file. An existing line is
 * replaced in place; a new one goes after the last header line, or starts a header.
 * An empty list removes the line.
 */
export function setSnippetTags(text: string, tags: string[]): string {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const value = tags.join(', ');
	const tagLine = lines.findIndex((line) => /^\s*\/\/\s*@tags\b/.test(line));
	if (tagLine >= 0) {
		if (value) lines[tagLine] = lines[tagLine].replace(/@tags\b.*$/, `@tags ${value}`);
		else lines.splice(tagLine, 1);
		return lines.join(eol);
	}
	if (!value) return text;
	let last = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (/^\/\/\s*@\w+/.test(line)) last = i;
		else if (line === '' || line.startsWith('//')) continue;
		else break;
	}
	lines.splice(last + 1, 0, `// @tags ${value}`);
	return lines.join(eol);
}
