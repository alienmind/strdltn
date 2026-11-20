// The page of the Snippets view: folders, one row per snippet, and a card that opens
// in place with the header fields, the code in color and an insert button.
import type { SnippetInfo } from '../shared/snippet';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

type Snippet = SnippetInfo & { path: string };

const vscode = acquireVsCodeApi();
const list = document.getElementById('list')!;
const filter = document.getElementById('filter') as HTMLInputElement;

let snippets: Snippet[] = [];
let libFolder = 'lib';
/** Names of the snippets whose card is open, and of the folders that are closed. Kept across refreshes. */
const open = new Set<string>();
const closedFolders = new Set<string>();

/** One color per category, from the palette VS Code gives to charts, so it fits every theme. */
const CATEGORY_COLORS: Record<string, string> = {
	drums: 'var(--vscode-charts-red)',
	bass: 'var(--vscode-charts-orange)',
	melody: 'var(--vscode-charts-yellow)',
	chords: 'var(--vscode-charts-green)',
	texture: 'var(--vscode-charts-blue)',
	effect: 'var(--vscode-charts-purple)',
	function: 'var(--vscode-terminal-ansiCyan)',
	song: 'var(--vscode-terminal-ansiMagenta)',
	visual: 'var(--vscode-terminal-ansiBrightGreen)',
};

window.addEventListener('message', (event) => {
	const message = event.data;
	if (message.type === 'snippets') {
		snippets = message.snippets;
		libFolder = message.folder;
		render();
	} else if (message.type === 'expand') {
		open.add(message.name);
		render();
		document.querySelector(`[data-name="${CSS.escape(message.name)}"]`)?.scrollIntoView({ block: 'start' });
	}
});
filter.addEventListener('input', render);
vscode.postMessage({ type: 'ready' });

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function matches(snippet: Snippet, words: string[]): boolean {
	const haystack = [snippet.name, snippet.title, ...snippet.fields.map((field) => field.value)].join(' ').toLowerCase();
	return words.every((word) => haystack.includes(word));
}

function render(): void {
	const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
	const shown = snippets.filter((snippet) => matches(snippet, words));
	list.replaceChildren();
	if (!snippets.length) {
		list.append(element('div', 'empty', `No snippets yet. Put .strudel files in a ${libFolder}/ folder.`));
		return;
	}
	if (!shown.length) {
		list.append(element('div', 'empty', 'No snippet matches the filter.'));
		return;
	}
	const folders = new Map<string, Snippet[]>();
	for (const snippet of shown) folders.set(snippet.folder, [...(folders.get(snippet.folder) ?? []), snippet]);
	for (const [folder, items] of folders) {
		// Files at the top of the library have no folder and are listed without a group.
		const parent = folder === '' ? list : list.appendChild(folderGroup(folder, items.length, words.length > 0));
		for (const snippet of items) parent.append(...row(snippet));
	}
}

function folderGroup(folder: string, count: number, filtering: boolean): HTMLDetailsElement {
	const group = element('details');
	// While filtering, every folder with a match is open, or the match would be hidden.
	group.open = filtering || !closedFolders.has(folder);
	const summary = element('summary', undefined, folder);
	summary.append(element('span', 'count', String(count)));
	group.append(summary);
	group.addEventListener('toggle', () => {
		if (filtering) return;
		if (group.open) closedFolders.delete(folder);
		else closedFolders.add(folder);
	});
	return group;
}

function row(snippet: Snippet): HTMLElement[] {
	const color = CATEGORY_COLORS[snippet.category ?? ''];
	const line = element('div', 'row');
	line.dataset.name = snippet.name;
	line.title = `${snippet.path}\nClick to preview, double click to open the file.`;
	if (color) line.style.setProperty('--category', color);
	line.append(element('span', 'dot'), element('span', 'title', snippet.title));
	// A double click also fires two clicks. Waiting a moment keeps the card from flickering open and shut.
	let pending: ReturnType<typeof setTimeout> | undefined;
	line.addEventListener('click', () => {
		clearTimeout(pending);
		pending = setTimeout(() => {
			if (open.has(snippet.name)) open.delete(snippet.name);
			else open.add(snippet.name);
			render();
		}, 220);
	});
	line.addEventListener('dblclick', () => {
		clearTimeout(pending);
		vscode.postMessage({ type: 'open', name: snippet.name });
	});
	if (!open.has(snippet.name)) return [line];
	line.classList.add('open');
	return [line, card(snippet, color)];
}

function card(snippet: Snippet, color: string | undefined): HTMLElement {
	const box = element('div', 'card');
	if (color) box.style.setProperty('--category', color);

	const table = element('table');
	for (const field of snippet.fields) {
		const tr = element('tr');
		const value = element('td');
		if (field.name === 'category') value.append(element('span', 'badge', field.value));
		else if (field.name === 'tags') value.append(...field.value.split(',').map((tag) => element('span', 'tag', tag.trim())));
		else value.textContent = field.value;
		tr.append(element('th', undefined, field.name), value);
		table.append(tr);
	}
	const file = element('tr');
	file.append(element('th', undefined, 'file'), element('td', undefined, snippet.path));
	table.append(file);

	const code = element('pre');
	code.append(...highlight(snippet.code));

	const actions = element('div', 'actions');
	const insert = element('button', undefined, 'Insert at cursor');
	insert.addEventListener('click', () => vscode.postMessage({ type: 'insert', name: snippet.name }));
	const edit = element('button', 'secondary', 'Open file');
	edit.addEventListener('click', () => vscode.postMessage({ type: 'open', name: snippet.name }));
	actions.append(insert, edit);

	box.append(table, code, actions);
	return box;
}

const KEYWORDS = new Set(['const', 'let', 'var', 'function', 'return', 'await', 'async', 'if', 'else', 'for', 'of', 'in', 'new', 'true', 'false', 'null', 'undefined']);
// Comments, strings, numbers, `$name:` pattern labels, and words. Anything else is copied as it is.
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b|\B\.\d+\b)|(\$\w*:)|([A-Za-z_]\w*)/g;

/**
 * Colors for a few kinds of token. This is not a parser and does not need to be: the
 * card is a preview, and a regular expression keeps the view free of a highlighting
 * library. VS Code does not let a webview use the editor's own highlighter.
 */
function highlight(code: string): (Node | string)[] {
	const parts: (Node | string)[] = [];
	let last = 0;
	for (const match of code.matchAll(TOKEN)) {
		const [text, comment, string, number, label, word] = match;
		const start = match.index;
		let kind: string | undefined;
		if (comment) kind = 'comment';
		else if (string) kind = 'string';
		else if (number) kind = 'number';
		else if (label) kind = 'label';
		else if (word && KEYWORDS.has(word)) kind = 'keyword';
		else if (word && code[start + text.length] === '(') kind = 'call';
		if (!kind) continue;
		parts.push(code.slice(last, start), element('span', `tok-${kind}`, text));
		last = start + text.length;
	}
	parts.push(code.slice(last));
	return parts;
}
