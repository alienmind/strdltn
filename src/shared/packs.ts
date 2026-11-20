// Remote sample packs: `samples('github:user/repo')` in a song. Both sides use this
// file, the extension host to find and download the packs, the webview to serve them.

/** What the host tells the webview about one pack that a song loads. */
export interface PackInfo {
	/** The text in the song, for example `github:eddyflux/crate`. */
	source: string;
	/** Set when the pack is in the cache: its sample map, and the URL of the cache folder. */
	cached?: { map: Record<string, unknown>; base: string };
}

/**
 * The folder URL a `github:` name stands for, with a trailing slash. Same rules as
 * upstream (`githubPath` in superdough's sampler.mjs, 1.3.0): the repository defaults
 * to `samples`, the branch to `main`, and anything after the branch is a path.
 */
export function githubBase(source: string): string {
	const parts = source.slice('github:'.length).replace(/\/$/, '').split('/');
	const [user, repo = 'samples', branch = 'main', ...rest] = parts;
	return `https://raw.githubusercontent.com/${[user, repo, branch, ...rest].join('/')}/`;
}

const SAMPLES_CALL = /\bsamples\(\s*(['"`])(github:[^'"`\s]+)\1/g;

/** The `github:` packs a song loads, in order, without repeats. A call in a `//` comment does not count. */
export function findPackSources(text: string): string[] {
	const code = text
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n');
	return [...new Set([...code.matchAll(SAMPLES_CALL)].map((match) => match[2]))];
}

/** Every file path a sample map names. A value is a path, a list of paths, or note names with paths. */
export function packFiles(map: Record<string, unknown>): string[] {
	const files: string[] = [];
	const add = (value: unknown): void => {
		if (typeof value === 'string') files.push(value);
		else if (Array.isArray(value)) value.forEach(add);
		else if (value && typeof value === 'object') Object.values(value).forEach(add);
	};
	for (const [key, value] of Object.entries(map)) if (key !== '_base') add(value);
	return [...new Set(files)];
}
