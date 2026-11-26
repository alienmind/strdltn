// Worker thread for flashing .fwsc firmware directly to an M-VAVE FM-1 over USB-MIDI SysEx.
// Uses @julusian/midi (sharing dist/prebuilds/ with midi-worker.cjs). Always closes MIDI handles cleanly.
// @credits Leo Kuroshita (@kurogedelic) & Joakim Eriksson (fm1_install.py / M-VAVE FM-1 OTA protocol)
import { Input, Output } from '@julusian/midi';
import { parentPort, workerData } from 'node:worker_threads';
import {
	buildResponse,
	FINISH_CHECK,
	FINISH_WRITE,
	FM1_PORT_RE,
	type Fm1Identity,
	HS_QUERY,
	MAX_CHUNK,
	pairOutputPort,
	parseIdentity,
	parseRequest,
	REFUSED_AT,
	sameHardwareModel,
	unwrapFwsc,
	UPGRADE_TRIGGER,
} from '../shared/fm1Flash';

export type FlashWorkerInput =
	| { mode: 'probe'; portHint?: string }
	| { mode: 'flash'; fwscBytes: Uint8Array; portHint?: string };

export type FlashWorkerMessage =
	| { type: 'log'; message: string }
	| { type: 'probed'; device?: { port: string; identity: Fm1Identity }; inputs: string[] }
	| { type: 'progress'; phase: 'check' | 'loader' | 'write' | 'reboot'; percent?: number; detail: string }
	| { type: 'done'; identity: Fm1Identity; expected: string }
	| { type: 'error'; message: string };

const port = parentPort!;
const post = (msg: FlashWorkerMessage) => port.postMessage(msg);
const log = (message: string) => post({ type: 'log', message });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SUCCESS_BYTES = new TextEncoder().encode('success\0');

function listPorts(): { inputs: string[]; outputs: string[] } {
	const inp = new Input();
	const out = new Output();
	const inputs = Array.from({ length: inp.getPortCount() }, (_, i) => inp.getPortName(i));
	const outputs = Array.from({ length: out.getPortCount() }, (_, i) => out.getPortName(i));
	inp.destroy();
	out.destroy();
	return { inputs, outputs };
}

class SysExLink {
	readonly inName: string;
	readonly outName: string;
	private readonly inp: Input;
	private readonly out: Output;
	private readonly queue: number[][] = [];
	private waiter?: (pkt: number[] | undefined) => void;
	private closed = false;

	constructor(inName: string, inIdx: number, outName: string, outIdx: number) {
		this.inName = inName;
		this.outName = outName;
		this.inp = new Input();
		this.out = new Output();
		// Critical: RtMidi ignores SysEx by default; `false` as first arg enables SysEx reception.
		this.inp.ignoreTypes(false, true, true);
		this.inp.on('message', (_delta, bytes) => {
			if (!bytes.length || bytes[0] !== 0xf0) return;
			const pkt = bytes[bytes.length - 1] === 0xf7 ? bytes : [...bytes, 0xf7];
			if (this.waiter) {
				const w = this.waiter;
				this.waiter = undefined;
				w(pkt);
			} else {
				this.queue.push(pkt);
			}
		});
		this.inp.openPort(inIdx);
		try {
			this.out.openPort(outIdx);
		} catch (error) {
			this.inp.closePort();
			this.inp.destroy();
			throw error;
		}
	}

	drain(): void {
		this.queue.length = 0;
	}

	send(pkt: readonly number[]): boolean {
		if (this.closed) return false;
		try {
			this.out.sendMessage([...pkt]);
			return true;
		} catch {
			return false;
		}
	}

	read(timeoutMs: number): Promise<number[] | undefined> {
		if (this.queue.length) return Promise.resolve(this.queue.shift());
		if (this.closed || timeoutMs <= 0) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (this.waiter === finish) this.waiter = undefined;
				resolve(undefined);
			}, timeoutMs);
			const finish = (pkt: number[] | undefined) => {
				clearTimeout(timer);
				resolve(pkt);
			};
			this.waiter = finish;
		});
	}

	isLost(): boolean {
		return !listPorts().inputs.includes(this.inName);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.waiter) {
			const w = this.waiter;
			this.waiter = undefined;
			w(undefined);
		}
		try {
			this.inp.closePort();
			this.inp.destroy();
		} catch {
			// Ignore close errors if device unplugged.
		}
		try {
			this.out.closePort();
			this.out.destroy();
		} catch {
			// Ignore close errors.
		}
	}
}

async function handshake(link: SysExLink, tries = 2): Promise<Fm1Identity | undefined> {
	link.drain();
	for (let attempt = 0; attempt < tries; attempt++) {
		if (!link.send(HS_QUERY)) return undefined;
		const end = Date.now() + 1000;
		while (Date.now() < end) {
			const pkt = await link.read(end - Date.now());
			if (!pkt) break;
			const id = parseIdentity(pkt);
			if (id) return id;
		}
	}
	return undefined;
}

async function findDevice(
	want?: (id: Fm1Identity) => boolean,
	portHint?: string,
	onlyHint = false,
): Promise<{ link: SysExLink; identity: Fm1Identity; port: string } | undefined> {
	const { inputs, outputs } = listPorts();
	let candidates: string[];
	if (portHint) {
		const hint = portHint.toLowerCase();
		const mine = inputs.filter((n) => n.toLowerCase().includes(hint));
		candidates = onlyHint ? mine : [...mine, ...inputs.filter((n) => !mine.includes(n) && FM1_PORT_RE.test(n))];
	} else {
		candidates = inputs.filter((n) => FM1_PORT_RE.test(n));
	}
	for (const inName of candidates) {
		const outName = pairOutputPort(inName, outputs);
		if (!outName) continue;
		const inIdx = inputs.indexOf(inName);
		const outIdx = outputs.indexOf(outName);
		if (inIdx < 0 || outIdx < 0) continue;
		let link: SysExLink;
		try {
			link = new SysExLink(inName, inIdx, outName, outIdx);
		} catch {
			continue;
		}
		await sleep(300); // CoreMIDI/WinMM settle time after port open
		const identity = await handshake(link, 2);
		if (identity && (!want || want(identity))) {
			return { link, identity, port: inName };
		}
		link.close();
	}
	return undefined;
}

async function waitForDevice(
	want: (id: Fm1Identity) => boolean,
	timeoutMs: number,
	portHint?: string,
): Promise<{ link: SysExLink; identity: Fm1Identity; port: string } | undefined> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const found = await findDevice(want, portHint, false);
		if (found) return found;
		await sleep(1000);
	}
	return undefined;
}

async function serveRequests(
	link: SysExLink,
	image: Uint8Array,
	finishAddr: number,
	idleMs: number,
	onProgress: (served: number, endAddr: number) => void,
): Promise<{ served: number; finished: boolean; lost: boolean }> {
	let served = 0;
	let last = Date.now();
	while (true) {
		const pkt = await link.read(1000);
		if (!pkt) {
			if (link.isLost()) return { served, finished: false, lost: true };
			if (Date.now() - last > idleMs) return { served, finished: false, lost: false };
			continue;
		}
		const req = parseRequest(pkt);
		if (!req) continue;
		last = Date.now();
		if (req.addr === REFUSED_AT) {
			link.send(buildResponse(req.addr, new Uint8Array(req.len), req.flags));
			throw new Error('The FM-1 refused the package (insufficient flash room / add-ons in the way). Nothing was written.');
		}
		if (req.addr === FINISH_CHECK || req.addr === FINISH_WRITE) {
			link.send(buildResponse(req.addr, SUCCESS_BYTES));
			if (req.addr === finishAddr) return { served, finished: true, lost: false };
			continue;
		}
		if (req.len > MAX_CHUNK || req.addr + req.len > image.length) {
			throw new Error(`Device requested out-of-bounds read 0x${req.addr.toString(16)}+${req.len}`);
		}
		await sleep(10);
		if (!link.send(buildResponse(req.addr, image.subarray(req.addr, req.addr + req.len), req.flags))) {
			return { served, finished: false, lost: true };
		}
		served++;
		onProgress(served, req.addr + req.len);
	}
}

async function run(): Promise<void> {
	const input = workerData as FlashWorkerInput;
	if (input.mode === 'probe') {
		const found = await findDevice(undefined, input.portHint, false);
		const { inputs } = listPorts();
		if (found) {
			found.link.close();
			post({ type: 'probed', device: { port: found.port, identity: found.identity }, inputs });
		} else {
			post({ type: 'probed', inputs });
		}
		return;
	}

	const { product, image } = unwrapFwsc(new Uint8Array(input.fwscBytes));
	log(`Unwrapped .fwsc package: ${product} (${image.length} bytes logical image)`);

	const dev = await findDevice(undefined, input.portHint, false);
	if (!dev) {
		const { inputs } = listPorts();
		throw new Error(`M-VAVE FM-1 not found on MIDI ports (inputs: ${inputs.join(', ') || 'none'}). Connect via USB data cable and close other MIDI apps.`);
	}
	log(`Found device ${dev.identity.text} on "${dev.port}"${dev.identity.loader ? ' (already in OTA loader)' : ''}`);

	if (!sameHardwareModel(dev.identity.text, product)) {
		dev.link.close();
		throw new Error(`Hardware mismatch: connected device is ${dev.identity.text}, but package is for ${product}. Nothing was written.`);
	}

	let ota = dev;
	if (!dev.identity.loader) {
		post({ type: 'progress', phase: 'check', percent: 0, detail: `Checking package on ${dev.identity.text}...` });
		dev.link.send(UPGRADE_TRIGGER);
		await sleep(2000);
		const step1 = await serveRequests(dev.link, image, FINISH_CHECK, 10_000, (served) => {
			post({ type: 'progress', phase: 'check', detail: `Checking package (${served} reads)...` });
		});
		dev.link.close();
		if (!step1.finished) {
			throw new Error(`FM-1 ${step1.lost ? 'disconnected' : 'stopped answering'} during package check after ${step1.served} reads; nothing was written.`);
		}
		post({ type: 'progress', phase: 'loader', percent: 5, detail: 'Switching FM-1 into OTA update mode...' });
		await sleep(3000);
		const foundOta = await waitForDevice((id) => id.loader, 30_000, input.portHint);
		if (!foundOta) {
			throw new Error('OTA update loader did not appear within 30 s. Replug the USB cable and run Flash again to finish.');
		}
		ota = foundOta;
		log(`Connected to OTA loader ${ota.identity.text} on "${ota.port}"`);
	}

	post({ type: 'progress', phase: 'write', percent: 5, detail: `Writing ${product} to flash (0%)...` });
	ota.link.send(UPGRADE_TRIGGER);
	await sleep(2000);
	let lastPct = -1;
	const step2 = await serveRequests(ota.link, image, FINISH_WRITE, 180_000, (_served, endAddr) => {
		const pct = Math.min(99, Math.floor((endAddr * 100) / image.length));
		if (pct !== lastPct) {
			lastPct = pct;
			post({ type: 'progress', phase: 'write', percent: pct, detail: `Writing ${product} to flash (${pct}%)...` });
		}
	});
	ota.link.close();
	if (!step2.finished) {
		throw new Error(`OTA loader ${step2.lost ? 'disconnected' : 'stopped answering'} while writing after ${step2.served} chunks. Replug the USB cable and flash again to resume.`);
	}

	post({ type: 'progress', phase: 'reboot', percent: 100, detail: 'Write complete. Waiting for FM-1 to restart...' });
	await sleep(3000);
	const back = await waitForDevice((id) => !id.loader, 40_000, input.portHint);
	if (!back) {
		throw new Error('Firmware write finished, but the FM-1 did not reconnect within 40 s. Power-cycle your FM-1.');
	}
	back.link.close();
	log(`FM-1 rebooted cleanly as ${back.identity.text}`);
	post({ type: 'done', identity: back.identity, expected: product });
}

void run().catch((error) => {
	post({ type: 'error', message: (error as Error)?.message ?? String(error) });
});
