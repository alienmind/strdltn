// Firmwares from an address: `firmware('https://...')` in a song. The extension host uses this to find and cache
// them, the same way it caches `samples('github:...')` packs.

/** Address in the song -> webview URL of its cached copy. Only firmwares that are in the cache. */
export type FirmwareCacheMap = Record<string, string>;

const CALL = /\bfirmware\s*\(/g;
const URL_STRING = /(['"`])(https?:\/\/[^'"`\s]+)\1/g;

/**
 * The addresses a song's `firmware(...)` calls name, in order, without repeats. Both forms count:
 * `firmware('https://...')` and `firmware({ name: 'https://...' })`, also over several lines. A `//` comment does not.
 */
export function findFirmwareUrls(text: string): string[] {
	const code = text
		.split('\n')
		.map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
		.join('\n');
	const urls: string[] = [];
	for (const call of code.matchAll(CALL)) {
		// The call's own parentheses. An address has none, so the first unmatched `)` ends it.
		let depth = 1;
		let end = call.index + call[0].length;
		while (end < code.length && depth > 0) {
			if (code[end] === '(') depth++;
			else if (code[end] === ')') depth--;
			end++;
		}
		const args = code.slice(call.index + call[0].length, end - 1);
		for (const match of args.matchAll(URL_STRING)) urls.push(match[2]);
	}
	return [...new Set(urls)];
}

/** The file name to keep a download under: the last part of the address, or `firmware`. */
export function firmwareFileName(url: string): string {
	const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '');
	return /^[\w.-]+$/.test(name) ? name : 'firmware';
}
