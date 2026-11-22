// The audio files of a song: a render (the whole song, made offline at full speed) and recordings (what played, in
// real time). They sit next to the song, so a song and its audio travel together. Both sides import this file.

/** How many cycles a render takes when the song does not say: the setting `strdltn.render.cycles`. */
export const DEFAULT_RENDER_CYCLES = 16;

/** MP3 bitrates in kbit/s that `strdltn.render.mp3Bitrate` offers. */
export const MP3_BITRATES = [128, 160, 192, 256, 320] as const;

/**
 * The file name, without extension, of a song's audio. A render overwrites the last one: `demo.wav` and `demo.mp3`
 * beside `demo.strudel`. A recording gets the time it started, so takes are kept: `demo.rec-20261122-013005.wav`.
 */
export function audioStem(songFile: string, kind: 'render' | 'record', at = new Date()): string {
	const stem = songFile.replace(/\.strudel$/, '');
	if (kind === 'render') return stem;
	const pad = (n: number) => String(n).padStart(2, '0');
	const time = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
	return `${stem}.rec-${time}`;
}

/**
 * The song an audio file belongs to, or undefined. `paths` are paths with `/`. An audio file is a song's when it sits in
 * the same folder and is named as `audioStem` names it: `demo.wav`, `demo.mp3`, `demo.rec-<time>.wav`.
 */
export function songOfAudio(audio: string, songs: ReadonlySet<string>): string | undefined {
	const match = /^(.*)\.(wav|mp3)$/i.exec(audio);
	if (!match) return undefined;
	const stem = match[1].replace(/\.rec-\d{8}-\d{6}$/, '');
	const song = `${stem}.strudel`;
	return songs.has(song) ? song : undefined;
}

/**
 * How many cycles a song's render takes: its header `// @length <cycles>`, else the default. A song that plays an
 * arrangement says how long it is; a loop renders the default.
 */
export function renderCycles(code: string, fallback = DEFAULT_RENDER_CYCLES): number {
	const match = /^\s*\/\/\s*@length\s+(\d+(?:\.\d+)?)\s*$/m.exec(code);
	const cycles = match ? Number(match[1]) : fallback;
	return Number.isFinite(cycles) && cycles > 0 ? cycles : fallback;
}
