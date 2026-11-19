// Messages between the extension host and a webview. Both sides import this file.

/** 'editor': the webview is the editor of the file. 'stage': code hidden, visuals only. */
export type Mode = 'editor' | 'stage';

/** Sound name -> list of absolute URLs, the shape upstream `samples()` accepts. */
export type SampleMap = Record<string, string[]>;

export type ToWebview =
	| { type: 'init'; text: string; mode: Mode; samples: SampleMap }
	| { type: 'update'; text: string }
	| { type: 'play' }
	| { type: 'stop' };

export type FromWebview =
	| { type: 'ready' }
	| { type: 'edit'; text: string }
	| { type: 'started'; started: boolean }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

/**
 * The smallest single replacement that turns `before` into `after`, or undefined when
 * they are equal. Both sides send whole texts and apply only this difference, so a
 * change far from the cursor does not move the cursor or reset the scroll position.
 */
export function diffText(before: string, after: string): TextChange | undefined {
	if (before === after) return undefined;
	const max = Math.min(before.length, after.length);
	let start = 0;
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
		endBefore--;
		endAfter--;
	}
	return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
