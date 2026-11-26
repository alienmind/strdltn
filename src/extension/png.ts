// A PNG from a firmware's display, for the pictures of the Library's FM-1 Synths. Only what that needs: 8-bit RGB, no
// filter, one IDAT. Node's zlib does the compression; the CRC is ours, so the file does not need a recent Node.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** RGB565, row by row, as `vibe_wasm_draw` gives it, to a PNG file. */
export function rgb565ToPng(px: Uint16Array, width: number, height: number): Uint8Array {
	const raw = new Uint8Array(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		let o = y * (1 + width * 3) + 1; // the filter byte of the row stays 0: none
		for (let x = 0; x < width; x++) {
			const v = px[y * width + x];
			raw[o++] = Math.round((((v >> 11) & 31) * 255) / 31);
			raw[o++] = Math.round((((v >> 5) & 63) * 255) / 63);
			raw[o++] = Math.round(((v & 31) * 255) / 31);
		}
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter method, no interlace
	const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
