import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';

/** A picture to make: for an item of the Library, from a firmware file, under a key that changes when the file does. */
export interface PreviewJob {
	itemId: string;
	key: string;
	bytes: () => Promise<Uint8Array>;
}

/** A firmware that runs longer than this for its picture is stopped, and gets none. */
const TIMEOUT_MS = 20000;
/** Two at a time: each takes a core while it runs. */
const PARALLEL = 2;

export const previewKey = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * The pictures of the firmwares in the Library: a PNG of each one's display, made once by running it for a moment in a
 * worker thread (preview-worker.ts), and kept in the extension's global storage (`firmware/pictures/<key>.png`), so
 * every project shares them. The firmwares of the hub that are not installed are kept there too
 * (`firmware/files/`), so a picture, the screen popup and an install need one download. See "FM-1 Synths" in
 * doc/ARCHITECTURE.md.
 */
export class FirmwarePreviews implements vscode.Disposable {
	readonly root: vscode.Uri;
	private readonly images = new Map<string, vscode.Uri>();
	private readonly queue: PreviewJob[] = [];
	private readonly queued = new Set<string>();
	private running = 0;
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

	/** Finds the pictures there are, and makes the missing ones in the background. A failed one is not tried again. */
	async want(jobs: PreviewJob[]): Promise<void> {
		let found = false;
		for (const job of jobs) {
			const png = this.picture(job.key);
			if (this.images.get(job.itemId)?.toString() === png.toString()) continue;
			if (await exists(png)) {
				this.images.set(job.itemId, png);
				found = true;
			} else if (!this.queued.has(job.key) && !(await exists(this.picture(job.key, '.none')))) {
				this.queued.add(job.key);
				this.queue.push(job);
			}
		}
		if (found) this.changed.fire();
		this.pump();
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

	private async download(url: string): Promise<vscode.Uri> {
		const file = vscode.Uri.joinPath(this.root, 'files', `${previewKey(url)}.wasm`);
		if (await exists(file)) return file;
		const response = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
		if (!response.ok) throw new Error(`${response.status} for ${url}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'files'));
		await vscode.workspace.fs.writeFile(file, bytes);
		this.output.appendLine(`[firmware] ${url}: downloaded for its picture, ${Math.round(bytes.length / 1024)} KB`);
		return file;
	}

	private picture(key: string, ending = '.png'): vscode.Uri {
		return vscode.Uri.joinPath(this.root, 'pictures', `${key}${ending}`);
	}

	private pump(): void {
		while (this.running < PARALLEL && this.queue.length) {
			const job = this.queue.shift()!;
			this.running++;
			void this.make(job).finally(() => {
				this.running--;
				this.queued.delete(job.key);
				this.pump();
			});
		}
	}

	private async make(job: PreviewJob): Promise<void> {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'pictures'));
		try {
			const png = await this.run(await job.bytes());
			await vscode.workspace.fs.writeFile(this.picture(job.key), png);
			this.images.set(job.itemId, this.picture(job.key));
			this.made.push(job.itemId);
			// Pictures come one by one: the Library is told once they pause.
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.changed.fire(), 200);
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
