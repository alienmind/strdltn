import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildResponse,
	FINISH_CHECK,
	FINISH_WRITE,
	pack7,
	pairOutputPort,
	parseIdentity,
	parseRequest,
	sameHardwareModel,
	unpack7,
	unwrapFwsc,
} from './fm1Flash.ts';

function wrapSyntheticFwsc(product: string, logical: Uint8Array): Uint8Array {
	const raw = new Uint8Array(logical.length + 20);
	let src = 0;
	for (let i = 0; i < 20; i++) {
		raw.set(logical.subarray(src, src + 0x2f), i * 0x30);
		src += 0x2f;
		raw[i * 0x30 + 0x2f] = i < product.length ? (product.charCodeAt(i) + i + 1) & 0xff : 0x7d;
	}
	raw.set(logical.subarray(src), 20 * 0x30);
	return raw;
}

test('pack7 and unpack7 round-trip arbitrary byte lengths', () => {
	for (const len of [0, 1, 7, 8, 15, 34, 512]) {
		const data = new Uint8Array(len);
		for (let i = 0; i < len; i++) data[i] = (i * 37 + 13) & 0xff;
		const packed = pack7(data);
		for (const b of packed) assert.equal(b & 0x80, 0, 'all packed bytes must be 7-bit MIDI safe');
		assert.deepEqual(unpack7(packed), data);
	}
});

test('unwrapFwsc extracts product identity and strips the 20 marker bytes', () => {
	const logical = new Uint8Array(1200);
	for (let i = 0; i < logical.length; i++) logical[i] = i & 0xff;
	const raw = wrapSyntheticFwsc('FM-1_906', logical);
	const unwrapped = unwrapFwsc(raw);
	assert.equal(unwrapped.product, 'FM-1_906');
	assert.deepEqual(unwrapped.image, logical);
	assert.throws(() => unwrapFwsc(new Uint8Array(100)), /too short/);
});

test('parseIdentity decodes running firmware and OTA loader identities', () => {
	const makeId = (text: string) => {
		const body = new Uint8Array(34);
		body[0] = 0x00;
		body[1] = 0x59;
		body[2] = 0x11;
		for (let i = 0; i < text.length; i++) body[6 + i] = text.charCodeAt(i);
		return [0xf0, ...pack7(body), 0xf7];
	};
	assert.deepEqual(parseIdentity(makeId('FM-1_15')), { text: 'FM-1_15', model: 'FM-1', version: 15, loader: false });
	assert.deepEqual(parseIdentity(makeId('ota-FM-1_906')), { text: 'ota-FM-1_906', model: 'ota-FM-1', version: 906, loader: true });
	assert.equal(parseIdentity([0xf0, 1, 2, 0xf7]), undefined);
});

test('parseRequest and buildResponse validate checksum and little-endian address/length', () => {
	const makeReq = (flags: number, addr: number, len: number) => {
		const u = new Uint8Array(15);
		u[0] = 0x00;
		u[1] = 0x59;
		u[2] = 0x30;
		u[6] = flags;
		u[7] = addr & 0xff;
		u[8] = (addr >>> 8) & 0xff;
		u[9] = (addr >>> 16) & 0xff;
		u[10] = (addr >>> 24) & 0xff;
		u[11] = len & 0xff;
		u[12] = (len >>> 8) & 0xff;
		u[13] = (len >>> 16) & 0xff;
		let sum = 0;
		for (let i = 6; i < 14; i++) sum += u[i];
		u[14] = ~sum & 0xff;
		return [0xf0, ...pack7(u), 0xf7];
	};
	assert.deepEqual(parseRequest(makeReq(1, 0x00012000, 512)), { flags: 1, addr: 0x00012000, len: 512 });
	assert.deepEqual(parseRequest(makeReq(0, FINISH_CHECK, 0)), { flags: 0, addr: FINISH_CHECK, len: 0 });
	assert.deepEqual(parseRequest(makeReq(0, FINISH_WRITE, 0)), { flags: 0, addr: FINISH_WRITE, len: 0 });

	const reply = buildResponse(0x100, new Uint8Array([0xaa, 0xbb, 0xcc]), 2);
	assert.equal(reply[0], 0xf0);
	assert.equal(reply[reply.length - 1], 0xf7);
	const decoded = unpack7(reply.slice(1, -1));
	assert.deepEqual([...decoded.slice(0, 3)], [0x00, 0x59, 0x30]);
	assert.equal(decoded[6], 2);
	assert.equal(decoded[7], 0x00);
	assert.equal(decoded[8], 0x01);
	assert.deepEqual([...decoded.slice(14, 17)], [0xaa, 0xbb, 0xcc]);
});

test('sameHardwareModel allows FM-1 <-> ota-FM-1 and refuses FM-1 <-> SMK-37', () => {
	assert.equal(sameHardwareModel('FM-1_15', 'FM-1_906'), true);
	assert.equal(sameHardwareModel('ota-FM-1_906', 'FM-1_906'), true);
	assert.equal(sameHardwareModel('SMK-37 Pro_12', 'SMK-37 Elite_14'), true);
	assert.equal(sameHardwareModel('FM-1_15', 'SMK-37 Pro_12'), false);
	assert.equal(sameHardwareModel('SMK-37 Pro_12', 'FM-1_906'), false);
});

test('pairOutputPort matches exact names and Windows numbered suffixes', () => {
	assert.equal(pairOutputPort('M-VAVE FM-1', ['Microsoft GS', 'M-VAVE FM-1']), 'M-VAVE FM-1');
	assert.equal(pairOutputPort('M-VAVE FM-1 0', ['Microsoft GS 0', 'M-VAVE FM-1 1']), 'M-VAVE FM-1 1');
	assert.equal(pairOutputPort('Other', ['A', 'B']), undefined);
});
