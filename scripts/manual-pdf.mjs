// Renders doc/USERMANUAL.md to strdltn-manual.pdf, for the release (ci.yml) and by hand
// (`pnpm manual`). The Markdown becomes one HTML page with its images inlined, and a headless
// Chrome or Edge prints it. No LaTeX and no pandoc: the CI runner and the maintainer's PC
// both have a Chromium. Set CHROME to the browser's path when it is not found.
//
//   node scripts/manual-pdf.mjs [out.pdf]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'doc', 'USERMANUAL.md');
const out = resolve(process.argv[2] ?? join(root, 'strdltn-manual.pdf'));

// The front matter (title, subtitle) is for Markdown viewers; the page has its own title.
const markdown = readFileSync(source, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
let missing = 0;
// Images are inlined as data addresses, so the page needs no files beside it. A missing
// image (a screenshot not taken yet) becomes a note in the PDF, not a broken frame.
const body = marked.parse(markdown).replace(/<img src="([^"]+)" alt="([^"]*)"[^>]*>/g, (whole, src, alt) => {
	const file = join(dirname(source), src);
	if (/^https?:/.test(src)) return whole;
	if (!existsSync(file)) {
		missing++;
		return `<p class="missing">[Screenshot to come: ${alt}]</p>`;
	}
	const type = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
	return `<img src="data:${type};base64,${readFileSync(file).toString('base64')}" alt="${alt}">`;
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>[str]dltn Live[code] - User manual</title>
<style>
	@page { size: A4; margin: 18mm 16mm; }
	body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1f2328; }
	h1 { font-size: 22pt; margin: 0 0 8pt; }
	h2 { font-size: 15pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d0d7de; break-after: avoid; }
	h3 { font-size: 12pt; margin: 12pt 0 4pt; break-after: avoid; }
	h2:not(:first-of-type) { break-before: page; }
	img { max-width: 100%; display: block; margin: 8pt auto; border: 1px solid #d0d7de; break-inside: avoid; }
	table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9.5pt; break-inside: auto; }
	th, td { border: 1px solid #d0d7de; padding: 3pt 6pt; text-align: left; vertical-align: top; }
	th { background: #f6f8fa; }
	tr { break-inside: avoid; }
	code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #f6f8fa; padding: 0 2pt; border-radius: 2pt; }
	pre { background: #f6f8fa; padding: 6pt 8pt; border-radius: 3pt; break-inside: avoid; }
	pre code { background: none; padding: 0; }
	a { color: #0969da; text-decoration: none; }
	.missing { color: #9a6700; font-style: italic; }
</style></head><body>${body}</body></html>`;

const tmp = join(root, '.strdltn', 'tmp');
mkdirSync(tmp, { recursive: true });
const strdltnIgnore = join(root, '.strdltn', '.gitignore');
if (!existsSync(strdltnIgnore)) writeFileSync(strdltnIgnore, '# Managed by strdltn (cache and temporary files). Safe to delete.\n*\n');
const page = join(tmp, 'manual.html');
writeFileSync(page, html);

const candidates = [
	process.env.CHROME,
	'google-chrome',
	'chromium',
	'chromium-browser',
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
let printed = false;
for (const browser of candidates) {
	try {
		execFileSync(
			browser,
			['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(page).href],
			{ stdio: 'ignore', timeout: 120_000 },
		);
		if (existsSync(out)) {
			printed = true;
			break;
		}
	} catch {
		// Not this one: try the next.
	}
}
if (!printed) {
	console.error('No Chrome or Edge found to print the PDF. Set CHROME to its path.');
	process.exit(1);
}
console.log(`wrote ${out}${missing ? ` (${missing} screenshots still to come)` : ''}`);
