import * as vscode from 'vscode';

/** Where the SHRUB editor lives. Xfer's site: we only frame it, nothing of it is in vstrudel. */
export const SHRUB_EDITOR_URL = 'https://shrub.audio/editor/';
export const SHRUB_SETTING = 'experimental.shrubEditor';

/**
 * An experimental mockup: SHRUB's web editor in a tab, behind the setting `vstrudel.experimental.shrubEditor`. It is a
 * second, separate synth: its sound is not in the song's mix or tempo, and it has no MIDI, because a webview and any
 * frame inside it may not use WebMIDI. Why we would not build it further is in doc/DRAWER_OF_FAILED_IDEAS.md.
 */
export class ShrubPanel {
	private static current: ShrubPanel | undefined;

	static show(context: vscode.ExtensionContext): void {
		if (!vscode.workspace.getConfiguration('vstrudel').get<boolean>(SHRUB_SETTING, false)) {
			void vscode.window
				.showInformationMessage('The SHRUB editor panel is an experiment and is off.', 'Open setting')
				.then((choice) => {
					if (choice) void vscode.commands.executeCommand('workbench.action.openSettings', `vstrudel.${SHRUB_SETTING}`);
				});
			return;
		}
		if (ShrubPanel.current) {
			ShrubPanel.current.panel.reveal();
			return;
		}
		ShrubPanel.current = new ShrubPanel(context);
	}

	/** Closes the panel when the setting is turned off. */
	static settingChanged(): void {
		if (!vscode.workspace.getConfiguration('vstrudel').get<boolean>(SHRUB_SETTING, false)) ShrubPanel.current?.panel.dispose();
	}

	private readonly panel: vscode.WebviewPanel;

	private constructor(context: vscode.ExtensionContext) {
		this.panel = vscode.window.createWebviewPanel('vstrudel.shrub', 'SHRUB editor (experimental)', vscode.ViewColumn.Beside, {
			enableScripts: true,
			// The frame's page is gone when the tab is hidden otherwise, with every unsaved patch in it.
			retainContextWhenHidden: true,
			localResourceRoots: [],
		});
		this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'keyboard-dark.svg');
		const nonce = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('');
		this.panel.webview.html = shrubHtml(this.panel.webview.cspSource, nonce);
		this.panel.webview.onDidReceiveMessage((message: { type: string }) => {
			if (message.type === 'openExternal') void vscode.env.openExternal(vscode.Uri.parse(SHRUB_EDITOR_URL));
		});
		this.panel.onDidDispose(() => (ShrubPanel.current = undefined));
	}
}

/** The page of the panel. A plain function of its inputs, so it can be looked at in a browser too. */
export function shrubHtml(cspSource: string, nonce: string): string {
	const origin = new URL(SHRUB_EDITOR_URL).origin;
	const csp = [
		`default-src 'none'`,
		`frame-src ${origin}`,
		`style-src ${cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
	html, body { height: 100%; margin: 0; }
	body { display: flex; flex-direction: column; font: 13px var(--vscode-font-family, sans-serif);
		color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); }
	header { display: flex; align-items: center; gap: 10px; padding: 6px 10px; flex-wrap: wrap;
		border-bottom: 1px solid var(--vscode-panel-border, #333); }
	h1 { font-size: 13px; margin: 0; font-weight: 600; }
	.badge { font-size: 11px; padding: 1px 6px; border-radius: 8px;
		background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }
	.note { color: var(--vscode-descriptionForeground, #999); flex: 1; min-width: 200px; }
	button { font: inherit; padding: 3px 10px; border: 0; border-radius: 2px; cursor: pointer;
		background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); }
	button:disabled { opacity: .5; cursor: default; }
	main { position: relative; flex: 1; }
	iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
</style>
</head>
<body>
<header>
	<h1>SHRUB editor</h1>
	<span class="badge">experimental mockup</span>
	<span class="note">Xfer's editor, framed from ${origin}. A separate synth: not in the song's mix or tempo, and no MIDI here.
		Blank or an error below? The site may not allow being framed: use "Open in browser".</span>
	<button id="song" disabled title="Needs a VIBE FM build of SHRUB. Then: s(&quot;vibefm1:shrub&quot;).progNum(n)">Use in song</button>
	<button id="reload">Reload</button>
	<button id="external">Open in browser</button>
</header>
<main>
	<iframe id="editor" src="${SHRUB_EDITOR_URL}" allow="autoplay" title="SHRUB editor"></iframe>
</main>
<script nonce="${nonce}">
	const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage() {} };
	const frame = document.getElementById('editor');
	document.getElementById('external').addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
	document.getElementById('reload').addEventListener('click', () => { frame.src = 'about:blank'; frame.src = '${SHRUB_EDITOR_URL}'; });
</script>
</body>
</html>`;
}
