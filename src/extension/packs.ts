import * as vscode from 'vscode';
import { githubBase, packFiles, type PackInfo } from '../shared/packs';

interface PackState {
	source: string;
	folder: vscode.Uri;
	/** Number of audio files the map names. 0 until the map is known. */
	files: number;
	complete: boolean;
	note?: string;
}

/**
 * Keeps a copy of the remote sample packs a song loads, in `.vstrudel/cache/` of the
 * workspace folder. A cached pack plays without the network and loads at once.
 *
 * The folder ignores itself for git (a `.gitignore` with `*` inside `.vstrudel/`), so
 * the root `.gitignore` of the project is never touched.
 */
export class PackCache {
	private readonly states = new Map<string, PackState>();
	private readonly running = new Map<string, Promise<void>>();
	private readonly changed = new vscode.EventEmitter<void>();
	/** Fires when a pack finished downloading. Sessions then send the new state to their webview. */
	readonly onDidChange = this.changed.event;

	constructor(private readonly output: vscode.OutputChannel) {}

	list(): { source: string; files: number; complete: boolean; note?: string }[] {
		return [...this.states.values()].map(({ source, files, complete, note }) => ({ source, files, complete, note }));
	}

	private static cacheRoot(workspaceFolder: vscode.Uri): vscode.Uri {
		return vscode.Uri.joinPath(workspaceFolder, '.vstrudel', 'cache');
	}

	/** `github:eddyflux/crate` -> `<workspace>/.vstrudel/cache/github/eddyflux/crate/main/`. */
	private static folderOf(source: string, workspaceFolder: vscode.Uri): vscode.Uri {
		const path = new URL(githubBase(source)).pathname.split('/').filter(Boolean);
		return vscode.Uri.joinPath(PackCache.cacheRoot(workspaceFolder), 'github', ...path);
	}

	/** What a webview needs to play `source` from the cache, or only the name when it is not cached yet. */
	async info(source: string, workspaceFolder: vscode.Uri, webview: vscode.Webview): Promise<PackInfo> {
		const folder = PackCache.folderOf(source, workspaceFolder);
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, '.complete'));
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, 'strudel.json')));
			const map = JSON.parse(text) as Record<string, unknown>;
			// The files sit below the cache folder at the paths the map names, so the
			// map only needs a new base.
			delete map._base;
			this.states.set(folder.toString(), { source, folder, files: packFiles(map).length, complete: true });
			return { source, cached: { map, base: `${webview.asWebviewUri(folder).toString()}/` } };
		} catch {
			return { source };
		}
	}

	/** Downloads a pack unless it is there already or on its way. Never throws: a pack that cannot be cached still plays from the network. */
	ensure(source: string, workspaceFolder: vscode.Uri): Promise<void> {
		const folder = PackCache.folderOf(source, workspaceFolder);
		const key = folder.toString();
		if (this.states.get(key)?.complete) return Promise.resolve();
		let run = this.running.get(key);
		if (!run) {
			run = this.download(source, workspaceFolder, folder)
				.catch((error: Error) => {
					this.states.set(key, { source, folder, files: this.states.get(key)?.files ?? 0, complete: false, note: error.message });
					this.output.appendLine(`[packs] ${source}: not cached (${error.message})`);
				})
				.finally(() => this.running.delete(key));
			this.running.set(key, run);
		}
		return run;
	}

	private async download(source: string, workspaceFolder: vscode.Uri, folder: vscode.Uri): Promise<void> {
		const configuration = vscode.workspace.getConfiguration('vstrudel');
		if (!configuration.get('remoteSamples.cache', true)) return;
		const key = folder.toString();
		const fs = vscode.workspace.fs;
		try {
			await fs.stat(vscode.Uri.joinPath(folder, '.complete'));
			return; // Cached by an earlier session.
		} catch {
			// Not complete yet.
		}

		const base = githubBase(source);
		const mapBytes = await get(`${base}strudel.json`);
		const map = JSON.parse(new TextDecoder().decode(mapBytes)) as Record<string, unknown>;
		const files = packFiles(map);
		this.states.set(key, { source, folder, files: files.length, complete: false });

		// A sound may name its own `_base`. Then its files do not sit below one folder
		// and the simple "same paths, new base" trick of info() would be wrong.
		const ownBase = Object.values(map).some((value) => value && typeof value === 'object' && !Array.isArray(value) && '_base' in value);
		if (ownBase || files.some((file) => /^[a-z]+:\/\//i.test(file))) throw new Error('the map uses more than one base address');
		const limit = configuration.get('remoteSamples.maxFiles', 600);
		if (files.length > limit) throw new Error(`${files.length} files, more than the limit of ${limit} (setting vstrudel.remoteSamples.maxFiles)`);

		const ignore = vscode.Uri.joinPath(workspaceFolder, '.vstrudel', '.gitignore');
		await fs.createDirectory(folder);
		try {
			await fs.stat(ignore);
		} catch {
			await fs.writeFile(ignore, new TextEncoder().encode('# Downloaded by vstrudel. Safe to delete.\n*\n'));
		}

		let fileBase = typeof map._base === 'string' ? map._base : base;
		if (fileBase.startsWith('github:')) fileBase = githubBase(fileBase);
		let failed = 0;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `vstrudel: caching ${source}` }, async (progress) => {
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
							await fs.writeFile(target, await get(fileBase + file.split('/').map(encodeURIComponent).join('/')));
						} catch (error) {
							failed++;
							this.output.appendLine(`[packs] ${source}: ${file} failed (${(error as Error).message})`);
						}
					}
					progress.report({ message: `${++done} of ${files.length}` });
				}
			};
			await Promise.all(Array.from({ length: 6 }, worker));
		});
		if (failed) throw new Error(`${failed} of ${files.length} files did not download`);

		await fs.writeFile(vscode.Uri.joinPath(folder, 'strudel.json'), mapBytes);
		// Written last: info() only trusts a folder that has it.
		await fs.writeFile(vscode.Uri.joinPath(folder, '.complete'), new TextEncoder().encode(`${source}\n`));
		this.states.set(key, { source, folder, files: files.length, complete: true });
		this.output.appendLine(`[packs] ${source}: cached ${files.length} files`);
		this.changed.fire();
	}
}

async function get(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return new Uint8Array(await response.arrayBuffer());
}
