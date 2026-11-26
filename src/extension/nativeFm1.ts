// Native desktop FM-1 emulation via Joakim Eriksson's `fm1-live` (MIT, native JIT at 240 MHz).
// Lets SHRUB (.fwsc) and any other real FM-1 firmware run smoothly in real time without WebAssembly dropouts.
// @credits Joakim Eriksson (fm1-emu) — https://github.com/joakimeriksson/fm1-emu
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import * as vscode from 'vscode';
import { FM1_NATIVE_VERSION, isShrubFileName, nativeFm1Args, nativeTargetFor } from '../shared/nativeFm1';
import type { FirmwareLibrary } from './firmware';
import type { FirmwareMarket } from './market';

const execFileAsync = promisify(execFile);
const SHRUB_PATH_KEY = 'strdltn.shrub.fwscPath';

export class NativeFm1Host implements vscode.Disposable {
	private readonly running = new Map<string, ChildProcess>();
	private readonly changed = new vscode.EventEmitter<string[]>();
	readonly onDidChange = this.changed.event;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly library: FirmwareLibrary,
		private readonly market: FirmwareMarket,
		private readonly output: vscode.OutputChannel,
	) {}

	/** Ids of firmwares currently running in native `fm1-live`. */
	runningIds(): string[] {
		return [...this.running.keys()];
	}

	/** Starts native `fm1-live` for `id` (or stops it if already running). */
	async toggle(id: string): Promise<'started' | 'stopped' | 'cancelled'> {
		if (this.running.has(id)) {
			this.stop(id);
			return 'stopped';
		}
		return this.start(id);
	}

	/** Launches `fm1-live` natively with JIT for SHRUB or any `.fwsc` firmware. */
	async start(id: string): Promise<'started' | 'cancelled'> {
		if (vscode.env.remoteName) {
			void vscode.window.showWarningMessage('strdltn: native fm1-live emulation runs on desktop VS Code only.');
			return 'cancelled';
		}
		if (this.running.has(id)) return 'started';

		const fwscPath = await this.resolveFwsc(id);
		if (!fwscPath) return 'cancelled';

		const binary = await this.ensureBinary();
		if (!binary) return 'cancelled';

		const flashDir = join(this.context.globalStorageUri.fsPath, 'firmware', 'flash');
		mkdirSync(flashDir, { recursive: true });
		const safeId = id.replace(/[^a-z0-9._-]/gi, '_');
		const flashPath = join(flashDir, `${safeId}.bin`);
		const target = nativeTargetFor(process.platform, process.arch);
		const args = nativeFm1Args(fwscPath, { flashPath, usb: target?.usbMidi ?? process.platform !== 'win32' });

		this.output.appendLine(`[fm1-native] launching ${binary} ${args.join(' ')}`);
		const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		this.running.set(id, child);
		this.changed.fire(this.runningIds());

		child.stdout?.on('data', (chunk: Buffer) => {
			for (const line of chunk.toString('utf8').split(/\r?\n/)) {
				if (line.trim()) this.output.appendLine(`[fm1-native:${id}] ${line}`);
			}
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			for (const line of chunk.toString('utf8').split(/\r?\n/)) {
				if (line.trim()) this.output.appendLine(`[fm1-native:${id}] ${line}`);
			}
		});
		child.on('error', (error) => {
			this.output.appendLine(`[fm1-native:${id}] error: ${error.message}`);
			this.running.delete(id);
			this.changed.fire(this.runningIds());
			void vscode.window.showErrorMessage(`strdltn: could not start native fm1-live for ${id}: ${error.message}`);
		});
		child.on('exit', (code, signal) => {
			this.output.appendLine(`[fm1-native:${id}] exited (code=${code ?? 'none'}, signal=${signal ?? 'none'})`);
			this.running.delete(id);
			this.changed.fire(this.runningIds());
		});

		const midiHint =
			process.platform === 'win32'
				? 'Listen via Windows MIDI inputs (e.g. loopMIDI or a MIDI controller).'
				: 'Virtual USB-MIDI port enabled (--usb): target it with .midi(...) in Strudel.';
		void vscode.window.showInformationMessage(`strdltn: ${id} running natively in fm1-live (240 MHz JIT). ${midiHint}`, 'Stop').then((choice) => {
			if (choice === 'Stop') this.stop(id);
		});
		return 'started';
	}

	stop(id: string): void {
		const child = this.running.get(id);
		if (!child) return;
		this.running.delete(id);
		try {
			child.kill();
		} catch {
			// Already exited.
		}
		this.changed.fire(this.runningIds());
	}

	stopAll(): void {
		for (const id of [...this.running.keys()]) this.stop(id);
	}

	/** Finds or prompts for the `.fwsc` package to run natively. Never redistributes proprietary SHRUB. */
	private async resolveFwsc(id: string): Promise<string | undefined> {
		if (id === 'shrub') {
			const installed = this.library.all().find((fw) => fw.runtime === 'fwsc' && (fw.id.includes('shrub') || isShrubFileName(fw.path)));
			if (installed) {
				const uri = this.library.file(installed.id);
				if (uri && existsSync(uri.fsPath)) return uri.fsPath;
			}
			const configured = vscode.workspace.getConfiguration('strdltn').get<string>('shrub.fwscPath', '').trim();
			if (configured && existsSync(configured)) return configured;
			const remembered = this.context.globalState.get<string>(SHRUB_PATH_KEY);
			if (remembered && existsSync(remembered)) return remembered;
			const picked = await vscode.window.showOpenDialog({
				canSelectMany: false,
				openLabel: 'Run SHRUB .fwsc natively',
				title: 'Select your SHRUB .fwsc firmware file (e.g. SHRUB-V1.11.fwsc)',
				filters: { 'FM-1 Firmware (.fwsc)': ['fwsc'] },
			});
			const chosen = picked?.[0]?.fsPath;
			if (!chosen) return undefined;
			await this.context.globalState.update(SHRUB_PATH_KEY, chosen);
			return chosen;
		}
		const source = await this.market.screenSource(id);
		if (source?.file && source.file.fsPath.toLowerCase().endsWith('.fwsc')) return source.file.fsPath;
		void vscode.window.showWarningMessage(`strdltn: ${id} does not have a .fwsc firmware package for native fm1-live.`);
		return undefined;
	}

	/**
	 * Resolves `fm1-live`: custom setting -> bundled platform `.vsix` binary (`bin/<platform>-<arch>/`) ->
	 * on-demand cached download from official `fm1-emu` GitHub Releases (`globalStorageUri/firmware/native/`).
	 */
	private async ensureBinary(): Promise<string | undefined> {
		const custom = vscode.workspace.getConfiguration('strdltn').get<string>('fm1.nativeBinary', '').trim();
		if (custom) {
			if (existsSync(custom)) return custom;
			void vscode.window.showErrorMessage(`strdltn: configured strdltn.fm1.nativeBinary was not found: ${custom}`);
			return undefined;
		}

		const target = nativeTargetFor(process.platform, process.arch);
		if (!target) {
			void vscode.window.showErrorMessage(
				`strdltn: no prebuilt fm1-live binary for ${process.platform}-${process.arch}. Build fm1-live from github.com/joakimeriksson/fm1-emu and set strdltn.fm1.nativeBinary.`,
			);
			return undefined;
		}

		// 1. Platform-specific .vsix bundled binary (packaged by CI for Windows, macOS, Linux).
		const bundled = join(this.context.extensionPath, 'bin', target.key, target.binary);
		if (existsSync(bundled)) {
			if (process.platform !== 'win32') {
				try {
					chmodSync(bundled, 0o755);
				} catch {
					// Read-only extension folder; CI already marked it executable.
				}
			}
			return bundled;
		}

		// 2. Cached on-demand binary in globalStorageUri.
		const cacheDir = join(this.context.globalStorageUri.fsPath, 'firmware', 'native', `v${FM1_NATIVE_VERSION}`, target.key);
		const cached = join(cacheDir, target.binary);
		if (existsSync(cached)) return cached;

		// 3. Download and extract from official fm1-emu GitHub Release.
		try {
			return await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Downloading native FM-1 emulator (fm1-live v${FM1_NATIVE_VERSION})...` },
				async () => {
					mkdirSync(cacheDir, { recursive: true });
					const response = await fetch(target.url, {
						headers: { 'User-Agent': `strdltn/${this.context.extension.packageJSON.version} (VS Code extension; +https://github.com/alienmind/strdltn)` },
					});
					if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${target.asset}`);
					const bytes = new Uint8Array(await response.arrayBuffer());
					if (target.archive === 'zip') {
						const entries = unzipSync(bytes);
						const match = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith(`/${target.binary}`) || name.toLowerCase() === target.binary);
						if (!match) throw new Error(`${target.binary} not found inside ${target.asset}`);
						writeFileSync(cached, match[1]);
					} else {
						const archivePath = join(cacheDir, target.asset);
						writeFileSync(archivePath, bytes);
						await execFileAsync('tar', ['-xzf', archivePath, '-C', cacheDir]);
						const found = findFileRecursive(cacheDir, target.binary);
						if (!found) throw new Error(`${target.binary} not found after extracting ${target.asset}`);
						if (found !== cached) {
							const data = await vscode.workspace.fs.readFile(vscode.Uri.file(found));
							writeFileSync(cached, data);
						}
						chmodSync(cached, 0o755);
					}
					this.output.appendLine(`[fm1-native] downloaded ${target.asset} -> ${cached}`);
					return cached;
				},
			);
		} catch (error) {
			void vscode.window.showErrorMessage(`strdltn: failed to download fm1-live: ${(error as Error).message}`);
			return undefined;
		}
	}

	dispose(): void {
		this.stopAll();
		this.changed.dispose();
	}
}

function findFileRecursive(dir: string, targetName: string): string | undefined {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = findFileRecursive(full, targetName);
			if (nested) return nested;
		} else if (entry.name === targetName) {
			return full;
		}
	}
	return undefined;
}
