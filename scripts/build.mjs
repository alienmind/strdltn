// Builds the bundles: the extension host (Node, CommonJS), its MIDI worker thread, the webview of the editor and the stage, the Browser view, the Mixer view, the Devices view, the firmware screen popup, and the firmware worklet (browser).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { context } from 'esbuild';

// A production build writes no source maps. Without this, maps from an earlier
// development build would stay in dist/ and end up in the .vsix.
rmSync('dist', { recursive: true, force: true });

// Baked into the extension so that the Output channel can say which build is running:
// the promoted one in your own editor, or work in progress in a development host.
let stamp = 'unknown';
try {
	stamp = execFileSync('git', ['describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' }).trim();
} catch {
	// Built from a source archive without git.
}

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const shared = {
	bundle: true,
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
};

const builds = [
	{
		...shared,
		entryPoints: ['src/extension/extension.ts'],
		outfile: 'dist/extension.cjs',
		platform: 'node',
		format: 'cjs',
		target: 'node20',
		external: ['vscode'],
		define: { __BUILD__: JSON.stringify(stamp) },
	},
	{
		...shared,
		// The thread that owns the MIDI ports (src/extension/midi.ts). @julusian/midi is bundled; its
		// loader looks for the native binaries in <this file's folder>/prebuilds, copied below.
		entryPoints: ['src/extension/midi-worker.ts'],
		outfile: 'dist/midi-worker.cjs',
		platform: 'node',
		format: 'cjs',
		target: 'node20',
	},
	{
		...shared,
		// The thread that runs a firmware for the picture of its display (src/extension/previews.ts).
		entryPoints: ['src/extension/preview-worker.ts'],
		outfile: 'dist/preview-worker.cjs',
		platform: 'node',
		format: 'cjs',
		target: 'node20',
	},
	{
		...shared,
		entryPoints: ['src/webview/main.ts'],
		outfile: 'dist/webview.js',
		platform: 'browser',
		// ESM so that upstream `import(src)` (Hydra from a CDN) and `import.meta.url` keep working.
		format: 'esm',
		target: 'es2022',
	},
	{
		...shared,
		// The Browser view in the side bar. Its CSS is imported by main.ts and lands in dist/browser.css.
		entryPoints: ['src/browser/main.ts'],
		outfile: 'dist/browser.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
	{
		...shared,
		// The Mixer view in the bottom panel. Its CSS lands in dist/mixer.css.
		entryPoints: ['src/mixer/main.ts'],
		outfile: 'dist/mixer.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
	{
		...shared,
		// The Devices view in the bottom panel: a panel per firmware that plays. Its CSS lands in dist/devices.css.
		entryPoints: ['src/devices/main.ts'],
		outfile: 'dist/devices.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
	{
		...shared,
		// The firmware screen popup, opened from the Firmware category of the Library. Its CSS lands in dist/screen.css.
		entryPoints: ['src/screen/main.ts'],
		outfile: 'dist/screen.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
	{
		...shared,
		// Loaded with audioWorklet.addModule() from beside webview.js. A worklet scope has no modules to import.
		entryPoints: ['src/webview/vibe/worklet.ts'],
		outfile: 'dist/vibe-worklet.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
	{
		...shared,
		// Emulates real FM-1 hardware firmwares (.fwsc) via fm1-emu's WebAssembly runtime.
		entryPoints: ['src/webview/fm1/worklet.ts'],
		outfile: 'dist/fm1-worklet.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
	},
];

if (process.argv.includes('--test')) {
	builds.push({
		...shared,
		entryPoints: ['src/test/m0.ts'],
		outfile: 'dist/test/m0.cjs',
		platform: 'node',
		format: 'cjs',
		target: 'node20',
		external: ['vscode'],
	});
}

await writeFunctions();
// The prebuilt binaries of @julusian/midi for every platform, 2.2 MB, as the .vsix ships only dist/.
cpSync('node_modules/@julusian/midi/prebuilds', 'dist/prebuilds', { recursive: true });

/**
 * dist/functions.json: the functions of `@strudel/reference`, for the Functions category of
 * the Browser. Only what a row and its details pane show, with the HTML of the reference
 * turned into text. The full reference is 540 KB; this keeps the extension host light.
 */
async function writeFunctions() {
	const { reference } = await import('@strudel/reference');
	const text = (html = '') =>
		html
			.replace(/<\/p>\s*<p>/g, '\n\n')
			.replace(/<br\s*\/?>/g, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&')
			.trim();
	const seen = new Set();
	const functions = [];
	for (const doc of reference.docs) {
		// Inner names (`_fast`) and doubles (a function documented in two files) are left out.
		if (!doc.name || doc.name.startsWith('_') || seen.has(doc.name) || doc.kind === 'package') continue;
		seen.add(doc.name);
		functions.push({
			name: doc.name,
			synonyms: doc.synonyms?.length ? doc.synonyms : undefined,
			description: text(doc.description),
			params: doc.params?.map((p) => ({ name: p.name ?? '', type: (p.type?.names ?? []).join(' | '), description: text(p.description) })),
			example: doc.examples?.[0],
			file: doc.meta?.filename,
		});
	}
	mkdirSync('dist', { recursive: true });
	writeFileSync('dist/functions.json', JSON.stringify(functions));
}

const contexts = await Promise.all(builds.map((options) => context(options)));
if (watch) {
	await Promise.all(contexts.map((c) => c.watch()));
} else {
	await Promise.all(contexts.map((c) => c.rebuild()));
	await Promise.all(contexts.map((c) => c.dispose()));
}
