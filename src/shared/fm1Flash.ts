// M-VAVE FM-1 / SMK-37 USB-MIDI SysEx OTA flashing wire protocol and .fwsc package unwrapper.
// Pure functions (no native MIDI imports) so unit tests verify every byte, checksum, and safety guard.
// @credits Leo Kuroshita (@kurogedelic) & Joakim Eriksson (fm1_install.py / M-VAVE FM-1 OTA protocol)

/** Handshake query sent to probe candidate FM-1 MIDI ports for their running identity. */
export const HS_QUERY = [0xf0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0xf7] as const;

/** Trigger packet that starts step 1 (package check) or step 2 (flash write) on the device. */
export const UPGRADE_TRIGGER = [0xf0, 0x22, 0x24, 0x35, 0x7f, 0xf7] as const;

export const FINISH_CHECK = 0xe0000000;
export const FINISH_WRITE = 0xf0000000;
export const REFUSED_AT = 0xf2000000;
export const MAX_CHUNK = 512;

const HEADER_BLOCKS = 20;
const BLOCK_SIZE = 0x30;
const KEEP_SIZE = 0x2f;

/** Only probe ports that look like M-VAVE FM-1 / SMK-37 / OTA devices; never probe unrelated MIDI gear. */
export const FM1_PORT_RE = /fm-1|smk|elite|mke-p37|starry|felucca|ota|composite|sinco|usb-midi/i;
const SMK_FAMILY_RE = /^(?:SMK-37[ +].*|MKE-P37|STARRYKEY-37.*)$/i;

export interface Fm1Identity {
	/** Raw identity string, e.g. `"FM-1_15"` or `"ota-FM-1_906"`. */
	text: string;
	/** Model portion before `_version`, e.g. `"FM-1"` or `"ota-FM-1"`. */
	model: string;
	version: number;
	/** True when the device is currently running its OTA update loader (`ota-*`). */
	loader: boolean;
}

export interface Fm1ReadRequest {
	flags: number;
	addr: number;
	len: number;
}

/** Packs 8-bit bytes into 7-bit MIDI-safe SysEx bytes (LSB first). */
export function pack7(data: Uint8Array): Uint8Array {
	const out: number[] = [];
	let acc = 0;
	let nb = 0;
	for (let i = 0; i < data.length; i++) {
		acc |= data[i] << nb;
		nb += 8;
		while (nb >= 7) {
			out.push(acc & 0x7f);
			acc >>= 7;
			nb -= 7;
		}
	}
	if (nb > 0) out.push(acc & 0x7f);
	return new Uint8Array(out);
}

/** Unpacks 7-bit MIDI SysEx payload bytes back into 8-bit bytes (LSB first). */
export function unpack7(data: ArrayLike<number>): Uint8Array {
	const out: number[] = [];
	let acc = 0;
	let nb = 0;
	for (let i = 0; i < data.length; i++) {
		acc |= (data[i] & 0x7f) << nb;
		nb += 7;
		while (nb >= 8) {
			out.push(acc & 0xff);
			acc >>= 8;
			nb -= 8;
		}
	}
	return new Uint8Array(out);
}

/** Builds a complete SysEx (`0xF0 ... 0xF7`) reply packet answering a device read request. */
export function buildResponse(addr: number, data: Uint8Array, flags = 0): number[] {
	const n = data.length;
	const body = new Uint8Array(14 + n + 1);
	body[0] = 0x00;
	body[1] = 0x59;
	body[2] = 0x30;
	body[3] = (n + 8) & 0xff;
	body[4] = ((n + 8) >> 8) & 0xff;
	body[5] = 0x00;
	body[6] = flags & 0xff;
	body[7] = addr & 0xff;
	body[8] = (addr >>> 8) & 0xff;
	body[9] = (addr >>> 16) & 0xff;
	body[10] = (addr >>> 24) & 0xff;
	body[11] = n & 0xff;
	body[12] = (n >> 8) & 0xff;
	body[13] = 0x00;
	body.set(data, 14);
	let sum = 0;
	for (let i = 6; i < body.length - 1; i++) sum += body[i];
	body[body.length - 1] = ~sum & 0xff;
	const packed = pack7(body);
	const pkt = new Array<number>(packed.length + 2);
	pkt[0] = 0xf0;
	for (let i = 0; i < packed.length; i++) pkt[i + 1] = packed[i];
	pkt[packed.length + 1] = 0xf7;
	return pkt;
}

/** Parses an incoming device SysEx read request (`00 59 30 ...`). Returns undefined if not a valid request. */
export function parseRequest(pkt: ArrayLike<number>): Fm1ReadRequest | undefined {
	if (pkt.length < 4 || pkt[0] !== 0xf0 || pkt[pkt.length - 1] !== 0xf7) return undefined;
	const inner = new Uint8Array(pkt.length - 2);
	for (let i = 0; i < inner.length; i++) inner[i] = pkt[i + 1];
	const u = unpack7(inner);
	if (u.length !== 15 || u[0] !== 0x00 || u[1] !== 0x59 || u[2] !== 0x30) return undefined;
	let sum = 0;
	for (let i = 6; i < 14; i++) sum += u[i];
	if ((~sum & 0xff) !== u[14]) return undefined;
	const addr = (u[7] | (u[8] << 8) | (u[9] << 16) | (u[10] << 24)) >>> 0;
	const len = u[11] | (u[12] << 8) | (u[13] << 16);
	return { flags: u[6], addr, len };
}

/** Parses an incoming device handshake identity reply (`00 59 11 ...`). */
export function parseIdentity(pkt: ArrayLike<number>): Fm1Identity | undefined {
	if (pkt.length < 4 || pkt[0] !== 0xf0 || pkt[pkt.length - 1] !== 0xf7) return undefined;
	const inner = new Uint8Array(pkt.length - 2);
	for (let i = 0; i < inner.length; i++) inner[i] = pkt[i + 1];
	const d = unpack7(inner);
	if (d.length !== 34 || d[0] !== 0x00 || d[1] !== 0x59 || d[2] !== 0x11) return undefined;
	let end = 33;
	while (end > 6 && d[end - 1] === 0) end--;
	let text = '';
	for (let i = 6; i < end; i++) text += String.fromCharCode(d[i]);
	const match = /^([^_]+)_(\d+)$/.exec(text);
	if (!match) return undefined;
	const model = match[1];
	return {
		text,
		model,
		version: Number(match[2]),
		loader: model.toLowerCase().startsWith('ota-'),
	};
}

/**
 * Unwraps an `.fwsc` package: decodes its product identity (`"FM-1_906"`) from the 20 marker bytes
 * at offset `i * 0x30 + 0x2F` and strips those 20 bytes to build the logical image read during OTA.
 */
export function unwrapFwsc(raw: Uint8Array): { product: string; image: Uint8Array } {
	const headerLen = HEADER_BLOCKS * BLOCK_SIZE;
	if (raw.length < headerLen) throw new Error('Not a valid .fwsc firmware package (file too short)');
	let product = '';
	for (let i = 0; i < HEADER_BLOCKS; i++) {
		const m = raw[i * BLOCK_SIZE + KEEP_SIZE];
		if (m !== 0x7d) product += String.fromCharCode((m - i - 1) & 0xff);
	}
	if (!/^([^_]+)_(\d+)$/.test(product)) {
		throw new Error(`Invalid .fwsc package identity (${product || 'empty'})`);
	}
	const image = new Uint8Array(raw.length - HEADER_BLOCKS);
	let out = 0;
	for (let i = 0; i < HEADER_BLOCKS; i++) {
		image.set(raw.subarray(i * BLOCK_SIZE, i * BLOCK_SIZE + KEEP_SIZE), out);
		out += KEEP_SIZE;
	}
	image.set(raw.subarray(headerLen), out);
	return { product, image };
}

/** Extracts the base hardware model name from an identity string (`"ota-FM-1_906"` -> `"FM-1"`). */
export function modelOfIdentity(text: string): string {
	return text.split('_')[0].replace(/^ota-/i, '');
}

/** True when device identity `a` and package identity `b` target the same hardware (never FM-1 vs SMK-37). */
export function sameHardwareModel(a: string, b: string): boolean {
	const ma = modelOfIdentity(a);
	const mb = modelOfIdentity(b);
	if (ma.toLowerCase() === mb.toLowerCase()) return true;
	return SMK_FAMILY_RE.test(ma) && SMK_FAMILY_RE.test(mb);
}

/** Matches a MIDI input port name to its corresponding MIDI output port name (handling Windows numbered suffixes). */
export function pairOutputPort(inputName: string, outputs: string[]): string | undefined {
	if (outputs.includes(inputName)) return inputName;
	const strip = (s: string) => s.replace(/\s+\d+$/, '');
	const base = strip(inputName);
	const same = outputs.filter((o) => strip(o) === base);
	if (same.length === 1) return same[0];
	return outputs.length === 1 ? outputs[0] : undefined;
}
