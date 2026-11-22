import { Mp3Encoder } from '@breezystack/lamejs';
import * as vscode from 'vscode';
import { audioStem, MP3_BITRATES } from '../shared/render';

/**
 * Writes a song's audio next to it: the WAV as the engine made it, then the MP3, encoded here with lamejs at the
 * bitrate of `strdltn.render.mp3Bitrate`. The MP3 is the last step, so the WAV is on disk even when encoding fails.
 * Returns the two files.
 */
export async function saveAudio(song: vscode.Uri, kind: 'record' | 'render', wav: Uint8Array): Promise<vscode.Uri[]> {
	const folder = vscode.Uri.joinPath(song, '..');
	const stem = audioStem(song.path.split('/').pop() ?? 'song', kind);
	const wavFile = vscode.Uri.joinPath(folder, `${stem}.wav`);
	await vscode.workspace.fs.writeFile(wavFile, wav);
	const bitrate = mp3Bitrate();
	const mp3File = vscode.Uri.joinPath(folder, `${stem}.mp3`);
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `strdltn: encoding ${stem}.mp3 at ${bitrate} kbit/s` },
		async () => vscode.workspace.fs.writeFile(mp3File, await encodeMp3(wav, bitrate)),
	);
	return [wavFile, mp3File];
}

export function mp3Bitrate(): number {
	const value = vscode.workspace.getConfiguration('strdltn.render').get<number>('mp3Bitrate', 320);
	return (MP3_BITRATES as readonly number[]).includes(value) ? value : 320;
}

/** PCM of a 16-bit WAV: the channels, the rate and the samples, read from its `fmt ` and `data` chunks. */
export function readWav(bytes: Uint8Array): { channels: number; rate: number; samples: Int16Array } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
	if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
	let channels = 2;
	let rate = 48000;
	let bits = 16;
	for (let at = 12; at + 8 <= bytes.length; ) {
		const id = tag(at);
		const size = view.getUint32(at + 4, true);
		if (id === 'fmt ') {
			channels = view.getUint16(at + 10, true);
			rate = view.getUint32(at + 12, true);
			bits = view.getUint16(at + 22, true);
		} else if (id === 'data') {
			if (bits !== 16) throw new Error(`a ${bits}-bit WAV, only 16-bit is encoded`);
			const end = Math.min(bytes.length, at + 8 + size);
			const start = bytes.byteOffset + at + 8;
			const copy = new Int16Array((end - at - 8) >> 1);
			copy.set(new Int16Array(bytes.buffer.slice(start, start + copy.length * 2)));
			return { channels, rate, samples: copy };
		}
		at += 8 + size + (size & 1);
	}
	throw new Error('the WAV has no data');
}

/** An MP3 of a 16-bit WAV. lamejs is synchronous, so it encodes in slices and lets the host breathe between them. */
export async function encodeMp3(wav: Uint8Array, bitrate: number): Promise<Uint8Array> {
	const { channels, rate, samples } = readWav(wav);
	const frames = samples.length / channels;
	const left = new Int16Array(frames);
	const right = new Int16Array(frames);
	for (let i = 0; i < frames; i++) {
		left[i] = samples[i * channels];
		right[i] = samples[i * channels + (channels > 1 ? 1 : 0)];
	}
	const encoder = new Mp3Encoder(2, rate, bitrate);
	const parts: Uint8Array[] = [];
	// 1152 frames is one MP3 frame. About a second of audio per slice.
	const SLICE = 1152 * 40;
	for (let i = 0; i < frames; i += SLICE) {
		const part = encoder.encodeBuffer(left.subarray(i, i + SLICE), right.subarray(i, i + SLICE));
		if (part.length) parts.push(new Uint8Array(part));
		await new Promise((resolve) => setImmediate(resolve));
	}
	const last = encoder.flush();
	if (last.length) parts.push(new Uint8Array(last));
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
