// Extension-host coordinator for flashing real .fwsc firmwares directly onto an M-VAVE FM-1 over USB-MIDI SysEx.
// Suspends Strudel's MidiBridge during flashing so exclusive WinMM ports are free, probes the hardware first,
// requires explicit modal user confirmation, streams progress, and resumes MidiBridge when finished.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { isShrubFileName } from '../shared/nativeFm1';
import { type Fm1Identity, sameHardwareModel, unwrapFwsc } from '../shared/fm1Flash';
import type { FirmwareLibrary } from './firmware';
import type { FirmwareMarket } from './market';
import type { MidiBridge } from './midi';
import type { FlashWorkerInput, FlashWorkerMessage } from './fm1-flash-worker';

const SHRUB_PATH_KEY = 'strdltn.shrub.fwscPath';

export class Fm1Flasher {
	private busy = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly dist: string,
		private readonly library: FirmwareLibrary,
		private readonly market: FirmwareMarket,
		private readonly midi: MidiBridge,
		private readonly output: vscode.OutputChannel,
	) {}

	/** Flashes a marketplace/installed firmware by id, or prompts for a local `.fwsc` file when `id` is omitted. */
	async flash(id?: string): Promise<void> {
		if (vscode.env.remoteName) {
			void vscode.window.showWarningMessage('strdltn: hardware flashing over USB-MIDI works on desktop VS Code only.');
			return;
		}
		if (this.busy) {
			void vscode.window.showWarningMessage('strdltn: a hardware firmware flash is already in progress.');
			return;
		}

		const resolved = await this.resolveFwscBytes(id);
		if (!resolved) return;

		let unwrapped: { product: string; image: Uint8Array };
		try {
			unwrapped = unwrapFwsc(resolved.bytes);
		} catch (error) {
			void vscode.window.showErrorMessage(`strdltn: ${resolved.name} cannot be flashed: ${(error as Error).message}`);
			return;
		}

		this.busy = true;
		let suspended = false;
		try {
			await this.midi.suspend();
			suspended = true;

			const probed = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Looking for connected M-VAVE FM-1 over USB-MIDI...' },
				() => this.runWorker({ mode: 'probe' }),
			);

			if (!probed.device) {
				void vscode.window.showErrorMessage(
					`strdltn: M-VAVE FM-1 not found. Connect it with a USB data cable and close any other MIDI app or web flasher. (MIDI inputs: ${probed.inputs.join(', ') || 'none'})`,
				);
				return;
			}

			const { port, identity } = probed.device;
			if (!sameHardwareModel(identity.text, unwrapped.product)) {
				void vscode.window.showErrorMessage(
					`strdltn: hardware mismatch - connected device is ${identity.text} (${port}), but ${resolved.name} is for ${unwrapped.product}. Nothing was written.`,
				);
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Flash ${resolved.name} (${unwrapped.product}) to ${identity.text}?`,
				{
					modal: true,
					detail: [
						`Device: ${identity.text}${identity.loader ? ' [OTA update mode]' : ''} on MIDI port "${port}"`,
						`Package: ${resolved.name} (${unwrapped.product}, ${(resolved.bytes.length / 1024).toFixed(0)} KB)`,
						'',
						'Do NOT unplug or power off your FM-1 while flashing. If interrupted, replug and run Flash again to resume.',
					].join('\n'),
				},
				'Flash FM-1',
			);
			if (confirm !== 'Flash FM-1') return;

			this.output.show(true);
			this.output.appendLine(`[fm1-flash] starting flash of ${resolved.name} (${unwrapped.product}) -> ${identity.text} on "${port}"`);

			let reported = 0;
			const result = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Flashing ${resolved.name} to FM-1`, cancellable: false },
				(progress) =>
					this.runWorker({ mode: 'flash', fwscBytes: resolved.bytes, portHint: port }, (msg) => {
						if (msg.type === 'progress') {
							const pct = msg.percent ?? reported;
							const inc = Math.max(0, pct - reported);
							reported = Math.max(reported, pct);
							progress.report({ message: msg.detail, ...(inc > 0 ? { increment: inc } : {}) });
						}
					}),
			);

			if (result.done) {
				const ok = result.done.identity.text === result.done.expected;
				void vscode.window.showInformationMessage(
					ok
						? `strdltn: flashed ${resolved.name} cleanly! FM-1 is now running ${result.done.identity.text}.`
						: `strdltn: flash finished. FM-1 rebooted as ${result.done.identity.text} (package reported ${result.done.expected}).`,
				);
			}
		} catch (error) {
			const message = (error as Error)?.message ?? String(error);
			this.output.appendLine(`[fm1-flash] error: ${message}`);
			void vscode.window.showErrorMessage(`strdltn: FM-1 flash failed: ${message}`);
		} finally {
			this.busy = false;
			if (suspended) this.midi.resume();
		}
	}

	private async resolveFwscBytes(id?: string): Promise<{ name: string; bytes: Uint8Array } | undefined> {
		if (!id) return this.pickLocalFwsc('Select an FM-1 .fwsc firmware package to flash');

		if (id === 'shrub' || id === 'shrub-midi') {
			const installed = this.library.all().find((fw) => fw.runtime === 'fwsc' && (fw.id.includes('shrub') || isShrubFileName(fw.path)));
			if (installed) {
				const uri = this.library.file(installed.id);
				if (uri && existsSync(uri.fsPath)) return { name: installed.name, bytes: new Uint8Array(await vscode.workspace.fs.readFile(uri)) };
			}
			const configured = vscode.workspace.getConfiguration('strdltn').get<string>('shrub.fwscPath', '').trim();
			if (configured && existsSync(configured)) {
				return { name: path.basename(configured), bytes: new Uint8Array(await vscode.workspace.fs.readFile(vscode.Uri.file(configured))) };
			}
			const remembered = this.context.globalState.get<string>(SHRUB_PATH_KEY);
			if (remembered && existsSync(remembered)) {
				return { name: path.basename(remembered), bytes: new Uint8Array(await vscode.workspace.fs.readFile(vscode.Uri.file(remembered))) };
			}
			const picked = await this.pickLocalFwsc('Select your SHRUB .fwsc file to flash (get it from shrub.audio)');
			if (picked?.fsPath) await this.context.globalState.update(SHRUB_PATH_KEY, picked.fsPath);
			return picked;
		}

		// Installed local .fwsc
		const own = this.library.all().find((f) => f.id === id);
		const ownFile = this.library.file(id);
		if (own && ownFile && ownFile.fsPath.toLowerCase().endsWith('.fwsc')) {
			return { name: own.name, bytes: new Uint8Array(await vscode.workspace.fs.readFile(ownFile)) };
		}

		// Available Hub .fwsc (downloads & verifies SHA-256 if provided)
		const avail = this.market.hub.all().find((f) => f.id === id);
		if (avail) {
			if (avail.externalUrl) {
				const choice = await vscode.window.showInformationMessage(
					`${avail.name} is hosted externally at ${avail.externalUrl}. Open the page to download the .fwsc, or select a downloaded .fwsc file now.`,
					'Select .fwsc File',
					'Open Website',
				);
				if (choice === 'Open Website') {
					await vscode.env.openExternal(vscode.Uri.parse(avail.externalUrl));
					return undefined;
				}
				if (choice === 'Select .fwsc File') return this.pickLocalFwsc(`Select downloaded ${avail.name} .fwsc file`);
				return undefined;
			}
			if (avail.runtime !== 'fwsc') {
				void vscode.window.showWarningMessage(`strdltn: ${avail.name} is a VIBE FM (.wasm) build. Only real FM-1 (.fwsc) packages can be flashed to hardware.`);
				return undefined;
			}
			const bytes = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Downloading ${avail.name} (.fwsc)...` },
				async () => new Uint8Array(await vscode.workspace.fs.readFile(await this.market.previews.hubFile(avail.url))),
			);
			if (avail.sha256) {
				const got = createHash('sha256').update(bytes).digest('hex');
				if (got.toLowerCase() !== avail.sha256.toLowerCase()) {
					throw new Error(`SHA-256 mismatch for ${avail.name}: expected ${avail.sha256.slice(0, 12)}, got ${got.slice(0, 12)}`);
				}
			}
			return { name: avail.name, bytes };
		}

		return this.pickLocalFwsc('Select an FM-1 .fwsc firmware package to flash');
	}

	private async pickLocalFwsc(title: string): Promise<{ name: string; bytes: Uint8Array; fsPath: string } | undefined> {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Flash to FM-1',
			title,
			filters: { 'FM-1 Firmware (.fwsc)': ['fwsc'] },
		});
		const uri = picked?.[0];
		if (!uri) return undefined;
		return { name: path.basename(uri.fsPath), bytes: new Uint8Array(await vscode.workspace.fs.readFile(uri)), fsPath: uri.fsPath };
	}

	private runWorker(
		input: FlashWorkerInput,
		onEvent?: (msg: FlashWorkerMessage) => void,
	): Promise<{ device?: { port: string; identity: Fm1Identity }; inputs: string[]; done?: { identity: Fm1Identity; expected: string } }> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(path.join(this.dist, 'fm1-flash-worker.cjs'), { workerData: input });
			let settled = false;
			worker.on('message', (msg: FlashWorkerMessage) => {
				if (msg.type === 'log') {
					this.output.appendLine(`[fm1-flash] ${msg.message}`);
					return;
				}
				onEvent?.(msg);
				if (msg.type === 'probed') {
					settled = true;
					resolve({ device: msg.device, inputs: msg.inputs });
				} else if (msg.type === 'done') {
					settled = true;
					resolve({ inputs: [], done: { identity: msg.identity, expected: msg.expected } });
				} else if (msg.type === 'error') {
					settled = true;
					reject(new Error(msg.message));
				}
			});
			worker.on('error', (error) => {
				if (!settled) {
					settled = true;
					reject(error);
				}
			});
			worker.on('exit', (code) => {
				if (!settled) {
					settled = true;
					reject(new Error(`Flash worker exited unexpectedly (code ${code})`));
				}
			});
		});
	}
}
