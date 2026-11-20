// Writes template/reference/strudel-functions.md from the function reference upstream
// publishes as @strudel/reference (the data behind https://strudel.cc/learn). The file
// is for an AI assistant that edits a song: it can search it for a function before it
// uses one, instead of guessing a name. Run it again after the package is updated:
//   pnpm reference
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reference } from '@strudel/reference';

const root = resolve(import.meta.dirname, '..');
const { version, license } = JSON.parse(readFileSync(join(root, 'node_modules/@strudel/reference/package.json'), 'utf8'));

/** Our docs are plain ASCII. Upstream uses typographic quotes and dashes here and there. */
const ascii = (value = '') =>
	value
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201c\u201d]/g, '"')
		.replace(/\u2026/g, '...')
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/[^\x00-\x7f]/g, '')
		.trim();

/**
 * The descriptions are HTML made from JSDoc. Markdown wants text. An example is code
 * and goes through `ascii` only: `"<a b>"` in mini-notation is not a tag.
 */
const text = (html = '') =>
	ascii(
		html
			.replace(/<\/p>\s*<p>/g, '\n\n')
			.replace(/<li>/g, '- ')
			.replace(/<code>(.*?)<\/code>/gs, '`$1`')
			.replace(/<[^>]+>/g, '')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&'),
	);

// One entry per name. Upstream documents a few names twice. The one with examples wins.
const byName = new Map();
for (const doc of reference.docs) {
	if (!doc.name || doc.undocumented || !/^[\w$]+$/.test(doc.name)) continue;
	const known = byName.get(doc.name);
	if (!known || (doc.examples?.length ?? 0) > (known.examples?.length ?? 0)) byName.set(doc.name, doc);
}
const docs = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

const lines = [
	'# Strudel functions',
	'',
	`Made by \`pnpm reference\` from \`@strudel/reference\` ${version}, the function reference of`,
	`Strudel (https://strudel.cc/learn), by the Strudel contributors, ${license}. Do not`,
	'edit this file by hand.',
	'',
	'Search this file for a function before you use it in a song. A name that is not here',
	'may still exist, for example the inline visuals `._scope()` and `._pianoroll()` or the',
	'control `delaytime`, but then look for it in `lib/` and `examples/` first.',
	'',
	`${docs.length} functions. A synonym is another name for the same function.`,
	'',
	'## All names',
	'',
	docs.map((doc) => doc.name).join(', '),
	'',
];
for (const doc of docs) {
	lines.push(`## ${doc.name}`, '');
	if (doc.synonyms?.length) lines.push(`Synonyms: ${doc.synonyms.join(', ')}`, '');
	const description = text(doc.description);
	if (description) lines.push(description, '');
	for (const parameter of doc.params ?? []) {
		const type = parameter.type?.names?.join(' | ');
		const about = text(parameter.description);
		lines.push(`- \`${parameter.name}\`${type ? ` (${type})` : ''}${about ? `: ${about}` : ''}`);
	}
	if (doc.params?.length) lines.push('');
	for (const example of doc.examples ?? []) lines.push('```', ascii(example), '```', '');
}

const folder = join(root, 'template', 'reference');
mkdirSync(folder, { recursive: true });
const out = join(folder, 'strudel-functions.md');
writeFileSync(out, `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`);
console.log(`${out}: ${docs.length} functions`);
