// Canonical workspace storage layout under `.strdltn/`:
// - `.strdltn/cache/`: remote sample packs and cached firmware URLs.
// - `.strdltn/tmp/`: workspace temporary artifacts (scratch files, local model weights, temp test/export outputs).
// `.strdltn/.gitignore` ignores `*` so user workspaces never pollute git or collide with a project's own `tmp/`.

export const STRDLTN_DIR = '.strdltn';
export const STRDLTN_CACHE_SEGMENTS = [STRDLTN_DIR, 'cache'] as const;
export const STRDLTN_TMP_SEGMENTS = [STRDLTN_DIR, 'tmp'] as const;
export const STRDLTN_GITIGNORE = '# Managed by strdltn (cache and temporary files). Safe to delete.\n*\n';
export const STRDLTN_EXCLUDE_GLOB = '**/{node_modules,.strdltn,.git}/**';

/** Path segments below a workspace folder for `.strdltn/<kind>/<...sub>`, rejecting unsafe traversal segments. */
export function strdltnSegments(kind: 'cache' | 'tmp', ...sub: string[]): string[] {
	const base = kind === 'cache' ? STRDLTN_CACHE_SEGMENTS : STRDLTN_TMP_SEGMENTS;
	const clean = sub
		.flatMap((part) => part.split(/[\\/]+/))
		.filter((part) => part.length > 0 && part !== '.');
	if (clean.some((part) => part === '..')) throw new Error('unsafe path segment in .strdltn path');
	return [...base, ...clean];
}
