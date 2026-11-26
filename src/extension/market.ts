import * as vscode from 'vscode';
import { availableFirmware, HARDWARE_FM1_PROFILES, type HubFirmware } from '../shared/firmware';
import type { ScreenFirmware } from '../shared/screen';
import type { BrowserView } from './browser';
import type { FirmwareLibrary } from './firmware';
import { HubCatalog } from './hub';
import { FirmwarePreviews, type PreviewJob, previewKey } from './previews';
import { SHRUB_SETTING, ShrubPanel } from './shrub';

/**
 * The marketplace of FM-1 Synths: the firmwares installed in the project (FirmwareLibrary), the hub's list (HubCatalog),
 * the picture of each one (FirmwarePreviews), and installing one. Keeps the Library's items current when any of them
 * changes. See "FM-1 Synths" in doc/ARCHITECTURE.md.
 */
export class FirmwareMarket implements vscode.Disposable {
	readonly hub: HubCatalog;
	readonly previews: FirmwarePreviews;
	private readonly disposables: vscode.Disposable[] = [];
	private wanted = false;
	/** Installs done in this session, for the integration test. */
	readonly installed: string[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly library: FirmwareLibrary,
		private readonly browser: BrowserView,
		private readonly output: vscode.OutputChannel,
	) {
		// Says who reads, as the hub asks of apps. No user data in it.
		const agent = `strdltn/${context.extension.packageJSON.version} (VS Code extension; +https://github.com/alienmind/strdltn)`;
		this.hub = new HubCatalog(context, output, agent);
		this.previews = new FirmwarePreviews(context, output, agent);
		this.disposables.push(
			this.hub,
			this.previews,
			library.onDidChange(() => this.changed()),
			this.hub.onDidChange(() => this.changed()),
			this.previews.onDidChange(() => this.push()),
		);
	}

	/**
	 * FM-1 Synths came into sight: read the hub's list (at most once a day) and make the pictures that are missing.
	 * Not before: the pictures of the hub's firmwares mean downloading each one, about 1 MB each.
	 */
	want(): void {
		if (this.wanted) return;
		this.wanted = true;
		void this.hub.load();
		void this.requestPictures();
	}

	private changed(): void {
		this.push();
		if (this.wanted) void this.requestPictures();
	}

	private push(): void {
		this.browser.setFirmware(this.library.all(), this.hub.all(), this.previews.all());
	}

	private async requestPictures(): Promise<void> {
		const jobs: PreviewJob[] = [];
		for (const fw of this.library.all()) {
			if (fw.runtime === 'fwsc') continue;
			const stamp = await this.library.stamp(fw.id);
			const file = this.library.file(fw.id);
			if (!stamp || !file) continue;
			jobs.push({ itemId: `firmware:${fw.id}`, key: previewKey(stamp), bytes: () => Promise.resolve(vscode.workspace.fs.readFile(file)) });
		}
		for (const fw of this.available()) {
			if (fw.runtime === 'fwsc') continue;
			jobs.push({ itemId: `firmware:${fw.id}`, key: previewKey(fw.url), bytes: async () => vscode.workspace.fs.readFile(await this.previews.hubFile(fw.url)) });
		}
		await this.previews.want(jobs);
	}

	/** The ids under Available, in the order the Library shows them. */
	availableIds(): string[] {
		return this.available()
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
			.map((fw) => fw.id);
	}

	private available(): HubFirmware[] {
		return availableFirmware(this.hub.all(), this.library.all());
	}

	/** Installs a firmware of the hub into the project's firmware folder, from the copy its picture was made from. */
	async install(id: string): Promise<void> {
		const fw = this.available().find((f) => f.id === id);
		if (!fw) return;
		try {
			const bytes = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Installing ${fw.name}...` },
				async () => vscode.workspace.fs.readFile(await this.previews.hubFile(fw.url)),
			);
			const folder = await this.library.install(fw, bytes);
			this.installed.push(fw.id);
			const where = vscode.workspace.asRelativePath(folder);
			const playAs = fw.runtime === 'fwsc' ? `fm1:${fw.id}` : `vibefm1:${fw.id}`;
			this.output.appendLine(`[firmware] ${fw.name} installed into ${where}`);
			void vscode.window.showInformationMessage(`${fw.name} is installed in ${where}. Songs play it as ${playAs}.`);
		} catch (error) {
			void vscode.window.showErrorMessage(`${fw.name} could not be installed: ${(error as Error).message}`);
		}
	}

	/** What the screen popup runs: an installed firmware from the project, an Available one from its downloaded copy. */
	async screenSource(id: string): Promise<{ firmware: Omit<ScreenFirmware, 'url'>; file: vscode.Uri } | undefined> {
		const own = this.library.all().find((f) => f.id === id);
		const file = this.library.file(id);
		if (own && file) return { firmware: own, file };
		const hub = this.available().find((f) => f.id === id);
		if (!hub) return undefined;
		return { firmware: { ...hub, available: true }, file: await this.previews.hubFile(hub.url) };
	}

	/** Cached `fm1_web.wasm` for emulating `.fwsc` firmwares inside VS Code. */
	emuWasmFile(): Promise<vscode.Uri> {
		return this.previews.emuWasmFile();
	}

	/** Opens the companion web editor for a firmware (or the built-in SHRUB panel when its setting is enabled). */
	openEditor(id: string): void {
		if (id === 'shrub' && vscode.workspace.getConfiguration('strdltn').get<boolean>(SHRUB_SETTING, false)) {
			ShrubPanel.show(this.context);
			return;
		}
		const url =
			HARDWARE_FM1_PROFILES.find((p) => p.id === id)?.editor ??
			this.library.all().find((f) => f.id === id)?.editor ??
			this.available().find((f) => f.id === id)?.editor;
		if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}
}
