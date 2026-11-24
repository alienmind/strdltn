// Cases for the PNG of a firmware's display. Run with `pnpm test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { crc32, rgb565ToPng } from './png.ts';

test('crc32 of a known string', () => {
	assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a 2 x 1 picture: red and blue, the header and the pixels', () => {
	const png = rgb565ToPng(new Uint16Array([0xf800, 0x001f]), 2, 1);
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(png.buffer, png.byteOffset);
	assert.equal(String.fromCharCode(...png.subarray(12, 16)), 'IHDR');
	assert.deepEqual([view.getUint32(16), view.getUint32(20)], [2, 1]);
	const idatLength = view.getUint32(33);
	assert.equal(String.fromCharCode(...png.subarray(37, 41)), 'IDAT');
	const raw = inflateSync(png.subarray(41, 41 + idatLength));
	assert.deepEqual([...raw], [0, 255, 0, 0, 0, 0, 255]);
	assert.equal(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4)), 'IEND');
});
