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

/** True for the two kinds of address we cache: a `github:` name and an `https://` address. */
export function isRemote(address: unknown): address is string {
	return typeof address === 'string' && /^(github:|https:\/\/)/.test(address);
}

/** A remote folder as an `https://` address. A `github:` name is resolved, anything else is returned as it is. */
export function remoteFolder(base: string): string {
	return base.startsWith('github:') ? githubBase(base) : base;
}

/**
 * Where the sample map of a pack is, and the folder it sits in (with a trailing slash).
 * A pack is a `github:` name, or the `https://` address of a `.json` file. An address
 * with a query is not a pack for us: its answer is made on request and may change.
 */
export function packAddress(source: string): { map: string; folder: string; name: string } | undefined {
	if (source.startsWith('github:')) {
		const folder = githubBase(source);
		return { map: `${folder}strudel.json`, folder, name: 'strudel.json' };
	}
	if (!/^https:\/\/[^?#]+\.json$/.test(source)) return undefined;
	const cut = source.lastIndexOf('/') + 1;
	return { map: source, folder: source.slice(0, cut), name: source.slice(cut) };
}

/**
 * The path of a remote folder below the cache, as segments. Files from GitHub keep the
 * place they always had (`github/<user>/<repo>/<branch>`), whichever way the song names
 * them. Undefined for an address we do not cache.
 */
export function cacheSegments(folder: string): string[] | undefined {
	let url: URL;
	try {
		url = new URL(folder);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' || url.search || url.hash || url.username || !folder.endsWith('/')) return undefined;
	// Characters a Windows file name may not have.
	const safe = (segment: string) => segment.replace(/[<>:"|?*\\\x00-\x1f]/g, '_');
	const path = url.pathname.split('/').filter(Boolean).map(safe);
	if (path.some((segment) => /^\.+$/.test(segment))) return undefined;
	return url.host === 'raw.githubusercontent.com' ? ['github', ...path] : ['https', safe(url.host), ...path];
}

/**
 * True when a path from a sample map must not be written below a cache folder. The map
 * comes from the network, and `../../x` in it would put a file outside the cache.
 */
export function unsafeFile(file: string): boolean {
	return !file || /^[a-z]+:/i.test(file) || /^[\\/]/.test(file) || file.split(/[\\/]/).some((segment) => segment === '..' || segment === '.');
}

/** True when a sound of the map names its own `_base`. Then the files do not sit below one folder. */
export function hasOwnBases(map: Record<string, unknown>): boolean {
	return Object.values(map).some((value) => !!value && typeof value === 'object' && !Array.isArray(value) && '_base' in value);
}

const SAMPLES_CALL = /\bsamples\(\s*(['"`])(github:[^'"`\s]+|https:\/\/[^'"`\s?#]+\.json)\1/g;

/** The packs a song loads by name, in order, without repeats. A call in a `//` comment does not count. */
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
