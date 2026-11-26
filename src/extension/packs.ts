import * as vscode from 'vscode';
import { cacheSegments, hasOwnBases, packAddress, packFiles, remoteFolder, unsafeFile, type PackInfo } from '../shared/packs';
import { ensureStrdltnDir, strdltnCacheDir } from './workspace';

interface PackState {
	source: string;
	folder: vscode.Uri;
	/** Number of audio files the map names. 0 until the map is known. */
	files: number;
	complete: boolean;
	note?: string;
}

/** Where a pack is kept: its folder, the copy of its map, and the file that says the copy is whole. */
interface PackPlace {
	folder: vscode.Uri;
	map: vscode.Uri;
	marker: vscode.Uri;
	/** The address of the map on the network, and of the folder it sits in. */
	mapAddress: string;
	folderAddress: string;
}

export interface CacheUsage {
	bytes: number;
	files: number;
	/** The packs that are whole, by the name a song uses. */
	packs: string[];
}

/**
 * Keeps a copy of the remote samples a song loads, in `.strdltn/cache/` of the
 * workspace folder. A cached pack plays without the network and loads at once.
 *
 * The folder ignores itself for git (a `.gitignore` with `*` inside `.strdltn/`), so
 * the root `.gitignore` of the project is never touched.
 */
export class PackCache {
	private readonly states = new Map<string, PackState>();
	private readonly running = new Map<string, Promise<void>>();
	private readonly changed = new vscode.EventEmitter<'cached' | 'cleared'>();
	/** Fires when a pack finished downloading, and when the cache was emptied. Sessions then send the new state to their webview. */
	readonly onDidChange = this.changed.event;

	constructor(private readonly output: vscode.OutputChannel) {}

	list(): { source: string; files: number; complete: boolean; note?: string }[] {
		return [...this.states.values()].map(({ source, files, complete, note }) => ({ source, files, complete, note }));
	}

	private static cacheRoot(workspaceFolder: vscode.Uri): vscode.Uri {
		return strdltnCacheDir(workspaceFolder);
	}

	/**
	 * `github:eddyflux/crate` -> `<workspace>/.strdltn/cache/github/eddyflux/crate/main/`.
	 * The map of a `github:` pack is always `strudel.json`. An `https://` pack can have
	 * any name, and two maps can sit in one folder, so each has its own marker.
	 */
	private static place(source: string, workspaceFolder: vscode.Uri): PackPlace | undefined {
		const address = packAddress(source);
		const segments = address && cacheSegments(address.folder);
		if (!address || !segments) return undefined;
		const folder = vscode.Uri.joinPath(PackCache.cacheRoot(workspaceFolder), ...segments);
		const marker = address.name === 'strudel.json' ? '.complete' : `.complete.${address.name}`;
		return {
			folder,
			map: vscode.Uri.joinPath(folder, address.name),
			marker: vscode.Uri.joinPath(folder, marker),
			mapAddress: address.map,
			folderAddress: address.folder,
		};
	}

	/** What a webview needs to play `source` from the cache, or only the name when it is not cached yet. */
	async info(source: string, workspaceFolder: vscode.Uri, webview: vscode.Webview): Promise<PackInfo> {
		const place = PackCache.place(source, workspaceFolder);
		if (!place) return { source };
		try {
			await vscode.workspace.fs.stat(place.marker);
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(place.map));
			const map = JSON.parse(text) as Record<string, unknown>;
			// The files sit below the cache folder at the paths the map names, so the
			// map only needs a new base.
			delete map._base;
			this.states.set(place.marker.toString(), { source, folder: place.folder, files: packFiles(map).length, complete: true });
			return { source, cached: { map, base: `${webview.asWebviewUri(place.folder).toString()}/` } };
		} catch {
			return { source };
		}
	}

	/** Downloads a pack unless it is there already or on its way. Never throws: a pack that cannot be cached still plays from the network. */
	ensure(source: string, workspaceFolder: vscode.Uri): Promise<void> {
		const place = PackCache.place(source, workspaceFolder);
		if (!place) return Promise.resolve();
		const key = place.marker.toString();
		if (this.states.get(key)?.complete) return Promise.resolve();
		return this.once(key, () =>
			this.download(source, workspaceFolder, place).catch((error: Error) => {
				this.states.set(key, { source, folder: place.folder, files: this.states.get(key)?.files ?? 0, complete: false, note: error.message });
				this.output.appendLine(`[packs] ${source}: not cached (${error.message})`);
			}),
		);
	}

	/** Runs one job per key at a time. A second request for the same key gets the running one. */
	private once(key: string, job: () => Promise<void>): Promise<void> {
		let run = this.running.get(key);
		if (!run) {
			run = job().finally(() => this.running.delete(key));
			this.running.set(key, run);
		}
		return run;
	}

	private static enabled(): boolean {
		return vscode.workspace.getConfiguration('strdltn').get('remoteSamples.cache', true);
	}

	private static limit(count: number): void {
		const limit = vscode.workspace.getConfiguration('strdltn').get('remoteSamples.maxFiles', 600);
		if (count > limit) throw new Error(`${count} files, more than the limit of ${limit} (setting strdltn.remoteSamples.maxFiles)`);
	}

	private async download(source: string, workspaceFolder: vscode.Uri, place: PackPlace): Promise<void> {
		if (!PackCache.enabled()) return;
		const key = place.marker.toString();
		const fs = vscode.workspace.fs;
		try {
			await fs.stat(place.marker);
			return; // Cached by an earlier session.
		} catch {
			// Not complete yet.
		}

		const mapBytes = await get(place.mapAddress);
		const map = JSON.parse(new TextDecoder().decode(mapBytes)) as Record<string, unknown>;
		const files = packFiles(map);
		this.states.set(key, { source, folder: place.folder, files: files.length, complete: false });

		// A sound may name its own `_base`. Then its files do not sit below one folder
		// and the simple "same paths, new base" trick of info() would be wrong.
		if (hasOwnBases(map)) throw new Error('the map uses more than one base address');
		if (files.some(unsafeFile)) throw new Error('the map names a file by a full address, or outside its own folder');
		// Upstream puts the base and the path together as they are. Only a base that
		// ends in a slash gives the same file below our folder.
		const fileBase = remoteFolder(typeof map._base === 'string' ? map._base : place.folderAddress);
		if (!fileBase.startsWith('https://') || !fileBase.endsWith('/')) throw new Error(`the base address ${fileBase} is not an https folder`);
		PackCache.limit(files.length);

		const failed = await this.fetchInto(workspaceFolder, place.folder, fileBase, files, source);
		if (failed) throw new Error(`${failed} of ${files.length} files did not download`);

		await fs.writeFile(place.map, mapBytes);
		// Written last: info() only trusts a folder that has it.
		await fs.writeFile(place.marker, new TextEncoder().encode(`${source}\n`));
		this.states.set(key, { source, folder: place.folder, files: files.length, complete: true });
		this.output.appendLine(`[packs] ${source}: cached ${files.length} files`);
		this.changed.fire('cached');
	}

	/**
	 * For `samples(map, base)` with a map written in the song: the cached folder of
	 * `base` when it holds every one of `files`. When it does not, the missing files are
	 * downloaded in the background and the next evaluation finds them. There is no map
	 * to keep here, the song has it.
	 */
	async files(base: string, files: string[], workspaceFolder: vscode.Uri): Promise<vscode.Uri | undefined> {
		const address = remoteFolder(base);
		const segments = cacheSegments(address);
		if (!segments || !files.length || files.some(unsafeFile)) return undefined;
		const folder = vscode.Uri.joinPath(PackCache.cacheRoot(workspaceFolder), ...segments);
		const missing = await this.missing(folder, files);
		if (!missing.length) return folder;
		if (!PackCache.enabled()) return undefined;
		const key = `files ${folder.toString()}`;
		void this.once(key, async () => {
			try {
				PackCache.limit(files.length);
				const failed = await this.fetchInto(workspaceFolder, folder, address, missing, base);
				this.output.appendLine(`[packs] ${base}: cached ${missing.length - failed} of ${missing.length} files`);
				this.states.set(key, { source: base, folder, files: files.length, complete: !failed, note: failed ? `${failed} files did not download` : undefined });
			} catch (error) {
				this.states.set(key, { source: base, folder, files: files.length, complete: false, note: (error as Error).message });
				this.output.appendLine(`[packs] ${base}: not cached (${(error as Error).message})`);
			}
		});
		return undefined;
	}

	private async missing(folder: vscode.Uri, files: string[]): Promise<string[]> {
		const there = await Promise.all(
			files.map((file) =>
				vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, ...file.split('/'))).then(
					() => true,
					() => false,
				),
			),
		);
		return files.filter((_, index) => !there[index]);
	}

	/** Downloads `files` from `address` into `folder`, six at a time. Returns how many failed. */
	private async fetchInto(workspaceFolder: vscode.Uri, folder: vscode.Uri, address: string, files: string[], title: string): Promise<number> {
		const fs = vscode.workspace.fs;
		await ensureStrdltnDir(workspaceFolder, 'cache');
		await fs.createDirectory(folder);
		let failed = 0;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `strdltn: caching ${title}` }, async (progress) => {
			let done = 0;
			const queue = [...files];
			const worker = async () => {
				for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
					const target = vscode.Uri.joinPath(folder, ...file.split('/'));
					try {
						await fs.stat(target);
					} catch {
						try {
							// The names in a map are plain text, so a space or a "#" has to be escaped for the request.
							const bytes = await get(address + file.split('/').map(encodeURIComponent).join('/'));
							// Written under another name first. A file with the right name is then
							// always whole, also when the window was closed in the middle.
							const part = target.with({ path: `${target.path}.part` });
							await fs.writeFile(part, bytes);
							await fs.rename(part, target, { overwrite: true });
						} catch (error) {
							failed++;
							this.output.appendLine(`[packs] ${title}: ${file} failed (${(error as Error).message})`);
						}
					}
					progress.report({ message: `${++done} of ${files.length}` });
				}
			};
			await Promise.all(Array.from({ length: 6 }, worker));
		});
		return failed;
	}

	/** True while something is being downloaded. The cache is not emptied then. */
	get busy(): boolean {
		return this.running.size > 0;
	}

	/** How much the caches of these workspace folders hold. */
	async usage(workspaceFolders: readonly vscode.Uri[]): Promise<CacheUsage> {
		const usage: CacheUsage = { bytes: 0, files: 0, packs: [] };
		const fs = vscode.workspace.fs;
		const walk = async (folder: vscode.Uri): Promise<void> => {
			let entries: [string, vscode.FileType][];
			try {
				entries = await fs.readDirectory(folder);
			} catch {
				return; // No cache here.
			}
			await Promise.all(
				entries.map(async ([name, type]) => {
					const uri = vscode.Uri.joinPath(folder, name);
					if (type & vscode.FileType.Directory) return walk(uri);
					// The marker holds the name the song uses for the pack.
					if (name.startsWith('.complete')) usage.packs.push(new TextDecoder().decode(await fs.readFile(uri)).trim());
					// Not `usage.bytes += (await ...)`: that reads the sum before the wait, and
					// the files are read side by side, so most sizes would be lost.
					const { size } = await fs.stat(uri);
					usage.bytes += size;
					usage.files++;
				}),
			);
		};
		await Promise.all(workspaceFolders.map((folder) => walk(PackCache.cacheRoot(folder))));
		usage.packs.sort();
		return usage;
	}

	/** Deletes the caches of these workspace folders. Open webviews are told, and go back to the network. */
	async clear(workspaceFolders: readonly vscode.Uri[]): Promise<void> {
		for (const folder of workspaceFolders) {
			const root = PackCache.cacheRoot(folder);
			try {
				await vscode.workspace.fs.stat(root);
			} catch {
				continue; // No cache here.
			}
			await vscode.workspace.fs.delete(root, { recursive: true });
		}
		this.states.clear();
		this.changed.fire('cleared');
	}
}

async function get(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return new Uint8Array(await response.arrayBuffer());
}

/** `1536` -> `1.5 KB`. */
export function formatBytes(bytes: number): string {
	const units = ['bytes', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${units[unit]}`;
}
