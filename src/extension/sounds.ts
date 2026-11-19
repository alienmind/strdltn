import * as vscode from 'vscode';
import type { SoundInfo } from '../shared/protocol';

/** A group, a sound, or one numbered variation of a sound. */
export type SoundNode =
	| { kind: 'group'; label: string; sounds: SoundInfo[] }
	| { kind: 'sound'; sound: SoundInfo }
	| { kind: 'variation'; sound: SoundInfo; index: number };

/** Group order in the view. Local sounds come first: they are the user's own. */
const GROUPS: { label: string; test: (sound: SoundInfo) => boolean }[] = [
	{ label: 'Local samples', test: (s) => s.tag === 'local' },
	{ label: 'Samples', test: (s) => s.type === 'sample' && s.tag !== 'drum-machines' },
	{ label: 'Drum machines', test: (s) => s.tag === 'drum-machines' },
	{ label: 'Synths', test: (s) => s.type === 'synth' },
	{ label: 'Soundfonts', test: (s) => s.type === 'soundfont' },
	{ label: 'Wavetables', test: (s) => s.type === 'wavetable' },
	{ label: 'Other', test: () => true },
];

/** Showing 500 numbered children helps nobody. The rest still plays with `name:n`. */
const MAX_VARIATIONS = 64;

/**
 * The Sounds view. It shows what the engine in the webview reports, so it lists exactly
 * the sounds that can be played, including the ones of the workspace. It is empty until
 * a .strudel file has been opened, because only then does an engine exist.
 */
export class SoundsProvider implements vscode.TreeDataProvider<SoundNode> {
	private sounds: SoundInfo[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	setSounds(sounds: SoundInfo[]): void {
		this.sounds = [...sounds].sort((a, b) => a.name.localeCompare(b.name));
		this.changed.fire();
	}

	all(): SoundInfo[] {
		return this.sounds;
	}

	groups(): { label: string; sounds: SoundInfo[] }[] {
		const rest = new Set(this.sounds);
		return GROUPS.map(({ label, test }) => {
			const sounds = [...rest].filter(test);
			sounds.forEach((sound) => rest.delete(sound));
			return { label, sounds };
		}).filter((group) => group.sounds.length);
	}

	getChildren(node?: SoundNode): SoundNode[] {
		if (!node) return this.groups().map((group) => ({ kind: 'group', ...group }));
		if (node.kind === 'group') return node.sounds.map((sound) => ({ kind: 'sound', sound }));
		if (node.kind === 'sound' && node.sound.count > 1) {
			const count = Math.min(node.sound.count, MAX_VARIATIONS);
			return Array.from({ length: count }, (_, index) => ({ kind: 'variation', sound: node.sound, index }));
		}
		return [];
	}

	getTreeItem(node: SoundNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = String(node.sounds.length);
			item.contextValue = 'group';
			return item;
		}
		const { sound } = node;
		const variation = node.kind === 'variation';
		const label = variation ? `${sound.name}:${node.index}` : sound.name;
		const expandable = !variation && sound.count > 1;
		const item = new vscode.TreeItem(label, expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		if (expandable) item.description = String(sound.count);
		item.contextValue = 'sound';
		item.iconPath = new vscode.ThemeIcon(sound.type === 'sample' ? 'unmute' : 'pulse');
		item.tooltip = `${label} (${sound.tag ?? sound.type}). Click to hear it.`;
		// A click plays the sound, as on strudel.cc. Inserting is the inline button.
		item.command = { command: 'vstrudel.previewSound', title: 'Preview', arguments: [node] };
		return item;
	}
}

/** The text to put in the code for a node: `bd` or `bd:3`. */
export function soundText(node: SoundNode): string | undefined {
	if (node.kind === 'group') return undefined;
	return node.kind === 'variation' ? `${node.sound.name}:${node.index}` : node.sound.name;
}
