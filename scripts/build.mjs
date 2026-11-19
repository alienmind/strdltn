// Builds the two bundles: the extension host (Node, CommonJS) and the webview (browser, ESM).
import { rmSync } from 'node:fs';
import { context } from 'esbuild';

// A production build writes no source maps. Without this, maps from an earlier
// development build would stay in dist/ and end up in the .vsix.
rmSync('dist', { recursive: true, force: true });

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

const contexts = await Promise.all(builds.map((options) => context(options)));
if (watch) {
	await Promise.all(contexts.map((c) => c.watch()));
} else {
	await Promise.all(contexts.map((c) => c.rebuild()));
	await Promise.all(contexts.map((c) => c.dispose()));
}
