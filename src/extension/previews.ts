import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { FM1_EMU_WASM_URL } from '../shared/firmware';

/**
 * A picture to make for a Library firmware row.
 * When `imageUrl` is provided, a lightweight remote thumbnail (~2-7 KB) is fetched directly without
 * downloading the full firmware binary. If that fails (e.g. a VIBE-only native synth) and `bytes`
 * is provided, the host falls back to running the VIBE `.wasm` briefly in `preview-worker.cjs`.
 */
export interface PreviewJob {
	itemId: string;
	key: string;
	imageUrl?: string;
	bytes?: () => Promise<Uint8Array>;
}

/** A firmware that runs longer than this for its picture is stopped, and gets none. */
const TIMEOUT_MS = 20000;
/** Two worker threads at a time: each takes a core while it runs. */
const WORKER_PARALLEL = 2;
/** Lightweight thumbnail image fetches (~2-7 KB each) can run much faster in parallel. */
const IMAGE_PARALLEL = 8;

const IMAGE_EXTS = ['.webp', '.png', '.jpg'] as const;

export const previewKey = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * The pictures of the firmwares in the Library: fast pre-loaded screen thumbnails from The Firmware Hub
 * or vendor pages (cached in `firmware/pictures/<key>.<ext>`), with an automatic worker-thread fallback
 * (`preview-worker.ts`) for local or VIBE-only `.wasm` firmwares. The hub's downloadable firmware files
 * are kept in `firmware/files/` so the screen popup, previews, and installs share one download.
 */
export class FirmwarePreviews implements vscode.Disposable {
	readonly root: vscode.Uri;
	private readonly images = new Map<string, vscode.Uri>();
	private readonly imageQueue: PreviewJob[] = [];
	private readonly workerQueue: PreviewJob[] = [];
	private readonly queued = new Set<string>();
	/** Multiple catalog rows can share one thumbnail key (e.g. SHRUB .fwsc and SHRUB Hardware MIDI). */
	private readonly keyItems = new Map<string, Set<string>>();
	private imageRunning = 0;
	private workerRunning = 0;
	private readonly downloads = new Map<string, Promise<vscode.Uri>>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private timer?: ReturnType<typeof setTimeout>;
	/** Pictures made and failed in this session. For the integration test. */
	readonly made: string[] = [];
	readonly failed: string[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel,
		private readonly userAgent: string,
	) {
		this.root = vscode.Uri.joinPath(context.globalStorageUri, 'firmware');
	}

	/** The picture of each item that has one, by item id. */
	all(): Record<string, vscode.Uri> {
		return Object.fromEntries(this.images);
	}

	/** Finds cached pictures and fetches/renders missing ones in the background. */
	async want(jobs: PreviewJob[]): Promise<void> {
		let found = false;
		for (const job of jobs) {
			let set = this.keyItems.get(job.key);
			if (!set) {
				set = new Set();
				this.keyItems.set(job.key, set);
			}
			set.add(job.itemId);

			const cached = await this.existingPicture(job.key);
			if (cached) {
				if (this.images.get(job.itemId)?.toString() !== cached.toString()) {
					this.images.set(job.itemId, cached);
					found = true;
				}
				continue;
			}
			if (this.queued.has(job.key) || (await exists(this.picture(job.key, '.none')))) continue;
			if (!job.imageUrl && !job.bytes) continue;
			this.queued.add(job.key);
			if (job.imageUrl) this.imageQueue.push(job);
			else this.workerQueue.push(job);
		}
		if (found) this.changed.fire();
		this.pumpImages();
		this.pumpWorkers();
	}

	/**
	 * A firmware of the hub, as a local file: downloaded once into global storage. The hub sends no CORS header, so the
	 * host downloads, never a webview. The `?v=` stamp of the address is part of the name, so a new version is a new file.
	 */
	hubFile(url: string): Promise<vscode.Uri> {
		let run = this.downloads.get(url);
		if (!run) {
			run = this.download(url).finally(() => this.downloads.delete(url));
			this.downloads.set(url, run);
		}
		return run;
	}

	/**
	 * Downloads and caches MIT `fm1-emu`'s `fm1_web.wasm` on demand into global storage so `.fwsc` firmwares can be
	 * previewed and played inside VS Code without bundling a 3.4 MB binary in the `.vsix`.
	 */
	emuWasmFile(): Promise<vscode.Uri> {
		return this.hubFile(FM1_EMU_WASM_URL);
	}

	private async download(url: string): Promise<vscode.Uri> {
		const ext = /\.fwsc(\?|$)/i.test(url) ? 'fwsc' : 'wasm';
		const file = vscode.Uri.joinPath(this.root, 'files', `${previewKey(url)}.${ext}`);
		if (await exists(file)) return file;
		const response = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
		if (!response.ok) throw new Error(`${response.status} for ${url}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'files'));
		await vscode.workspace.fs.writeFile(file, bytes);
		this.output.appendLine(`[firmware] ${url}: downloaded, ${Math.round(bytes.length / 1024)} KB`);
		return file;
	}

	private picture(key: string, ending = '.png'): vscode.Uri {
		return vscode.Uri.joinPath(this.root, 'pictures', `${key}${ending}`);
	}

	private async existingPicture(key: string): Promise<vscode.Uri | undefined> {
		for (const ext of IMAGE_EXTS) {
			const uri = this.picture(key, ext);
			if (await exists(uri)) return uri;
		}
		return undefined;
	}

	private publish(key: string, file: vscode.Uri): void {
		const ids = this.keyItems.get(key);
		if (ids) {
			for (const id of ids) {
				this.images.set(id, file);
				this.made.push(id);
			}
		}
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.changed.fire(), 150);
	}

	private pumpImages(): void {
		while (this.imageRunning < IMAGE_PARALLEL && this.imageQueue.length) {
			const job = this.imageQueue.shift()!;
			this.imageRunning++;
			void this.fetchThumb(job).finally(() => {
				this.imageRunning--;
				this.pumpImages();
			});
		}
	}

	private pumpWorkers(): void {
		while (this.workerRunning < WORKER_PARALLEL && this.workerQueue.length) {
			const job = this.workerQueue.shift()!;
			this.workerRunning++;
			void this.makeFromWasm(job).finally(() => {
				this.workerRunning--;
				this.queued.delete(job.key);
				this.pumpWorkers();
			});
		}
	}

	private async fetchThumb(job: PreviewJob): Promise<void> {
		if (!job.imageUrl) {
			this.queued.delete(job.key);
			return;
		}
		try {
			const response = await fetch(job.imageUrl, { headers: { 'User-Agent': this.userAgent } });
			const ctype = (response.headers.get('content-type') ?? '').toLowerCase();
			if (response.ok && ctype.startsWith('image/')) {
				const bytes = new Uint8Array(await response.arrayBuffer());
				if (bytes.length > 0) {
					const ext = ctype.includes('webp') ? '.webp' : ctype.includes('jpeg') || ctype.includes('jpg') ? '.jpg' : '.png';
					const dest = this.picture(job.key, ext);
					await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'pictures'));
					await vscode.workspace.fs.writeFile(dest, bytes);
					this.publish(job.key, dest);
					this.queued.delete(job.key);
					return;
				}
			}
			// No remote thumbnail (404 / non-image): fall back to WASM worker if this job has a .wasm source.
			if (job.bytes) {
				this.workerQueue.push(job);
				this.pumpWorkers();
				return;
			}
			if (response.status === 404) {
				await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'pictures'));
				await vscode.workspace.fs.writeFile(this.picture(job.key, '.none'), new TextEncoder().encode(`404 ${job.imageUrl}\n`));
			}
			this.queued.delete(job.key);
		} catch {
			// Transient network failure: do not write .none so it retries next time, or fall back to local bytes if present.
			if (job.bytes) {
				this.workerQueue.push(job);
				this.pumpWorkers();
				return;
			}
			this.queued.delete(job.key);
		}
	}

	private async makeFromWasm(job: PreviewJob): Promise<void> {
		if (!job.bytes) return;
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'pictures'));
		try {
			const png = await this.run(await job.bytes());
			const dest = this.picture(job.key, '.png');
			await vscode.workspace.fs.writeFile(dest, png);
			this.publish(job.key, dest);
		} catch (error) {
			const reason = (error as Error).message;
			this.failed.push(`${job.itemId}: ${reason}`);
			this.output.appendLine(`[firmware] no picture of ${job.itemId.slice('firmware:'.length)}: ${reason}`);
			// A download that failed is tried again next time; a firmware that cannot draw is not.
			if (!/^\d{3} for |fetch failed/.test(reason)) await vscode.workspace.fs.writeFile(this.picture(job.key, '.none'), new TextEncoder().encode(`${reason}\n`));
		}
	}

	private run(bytes: Uint8Array): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(join(this.context.extensionPath, 'dist', 'preview-worker.cjs'), { workerData: bytes });
			const timer = setTimeout(() => {
				void worker.terminate();
				reject(new Error(`no picture after ${TIMEOUT_MS / 1000} s`));
			}, TIMEOUT_MS);
			worker.once('message', (message: { png?: Uint8Array; error?: string }) => {
				clearTimeout(timer);
				void worker.terminate();
				if (message.png) resolve(new Uint8Array(message.png));
				else reject(new Error(message.error ?? 'no picture'));
			});
			worker.once('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.changed.dispose();
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
