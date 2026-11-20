import * as vscode from 'vscode';
import type { SoundInfo } from '../shared/protocol';

/** A group, a bank of a drum machine, a sound, or one numbered variation of a sound. */
export type SoundNode =
	| { kind: 'group'; label: string; icon: string; sounds: SoundInfo[]; banks: boolean; children?: SoundNode[] }
	| { kind: 'bank'; name: string; sounds: SoundInfo[]; parent: SoundNode; children?: SoundNode[] }
	| { kind: 'sound'; sound: SoundInfo; label: string; parent: SoundNode }
	| { kind: 'variation'; sound: SoundInfo; index: number; parent: SoundNode };

/**
 * Group order in the view. Local sounds come first: they are the user's own. `icon` is
 * the name of a pair of files in media/icons. `banks` adds a level for the drum machine
 * a sound belongs to.
 */
const GROUPS: { label: string; icon: string; banks?: boolean; test: (sound: SoundInfo) => boolean }[] = [
	{ label: 'Local samples', icon: 'sample', test: (s) => s.tag === 'local' },
	{ label: 'Samples', icon: 'sample', test: (s) => s.type === 'sample' && s.tag !== 'drum-machines' },
	{ label: 'Drum machines', icon: 'drum', banks: true, test: (s) => s.tag === 'drum-machines' },
	{ label: 'Synths', icon: 'keyboard', test: (s) => s.type === 'synth' },
	{ label: 'Soundfonts', icon: 'note', test: (s) => s.type === 'soundfont' },
	{ label: 'Firmware', icon: 'midi', test: (s) => s.type === 'firmware' },
	{ label: 'Wavetables', icon: 'keyboard', test: (s) => s.type === 'wavetable' },
	{ label: 'Other', icon: 'sample', test: () => true },
];

/** Showing 500 numbered children helps nobody. The rest still plays with `name:n`. */
const MAX_VARIATIONS = 64;

/**
 * A drum machine sound is named `<bank>_<sound>`, for example `RolandTR909_bd`, and
 * Strudel lets you write it as `s("bd").bank("RolandTR909")`. The bank is everything
 * before the last underscore.
 */
function splitBank(name: string): { bank: string; sound: string } | undefined {
	const cut = name.lastIndexOf('_');
	return cut > 0 && cut < name.length - 1 ? { bank: name.slice(0, cut), sound: name.slice(cut + 1) } : undefined;
}

/**
 * The Sounds view. It shows what the engine in the webview reports, so it lists exactly
 * the sounds that can be played, including the ones of the workspace. Before a .strudel
 * file is open there is no engine, and the view shows the list of the last one.
 */
export class SoundsProvider implements vscode.TreeDataProvider<SoundNode> {
	private sounds: SoundInfo[] = [];
	/** The nodes are kept, with their children, so that `TreeView.reveal` finds the same objects again. */
	private roots: SoundNode[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly extensionUri: vscode.Uri) {}

	setSounds(sounds: SoundInfo[]): void {
		this.sounds = [...sounds].sort((a, b) => a.name.localeCompare(b.name));
		this.roots = this.groups().map((group) => ({ kind: 'group', ...group }));
		this.changed.fire();
	}

	group(label: string): SoundNode | undefined {
		return this.roots.find((node) => node.kind === 'group' && node.label === label);
	}

	/** A bank by name, in the drum machines or in a pack. For the test and for reveal. */
	bank(name: string): SoundNode | undefined {
		return this.roots.flatMap((group) => this.getChildren(group)).find((node) => node.kind === 'bank' && node.name === name);
	}

	/** The names of the banks of one group. */
	banksOf(label: string): string[] {
		const group = this.group(label);
		return group ? this.getChildren(group).flatMap((node) => (node.kind === 'bank' ? [node.name] : [])) : [];
	}

	getParent(node: SoundNode): SoundNode | undefined {
		return node.kind === 'group' ? undefined : node.parent;
	}

	all(): SoundInfo[] {
		return this.sounds;
	}

	groups(): { label: string; icon: string; banks: boolean; sounds: SoundInfo[] }[] {
		const rest = new Set(this.sounds);
		// A pack that a song loads by name (`github:...` or an `https://` address) is
		// tagged with that name by the webview and gets a group of its own, after the
		// user's samples.
		const packTags = [...new Set(this.sounds.flatMap((s) => (s.tag && /^(github:|https:\/\/)/.test(s.tag) ? [s.tag] : [])))].sort();
		// Packs name their sounds `<bank>_<sound>` too (`crate_bd`), so they get the bank level.
		const packGroups = packTags.map((tag) => ({ label: tag, icon: 'sample', banks: true, test: (s: SoundInfo) => s.tag === tag }));
		return [GROUPS[0], ...packGroups, ...GROUPS.slice(1)].map(({ label, icon, banks, test }) => {
			const sounds = [...rest].filter(test);
			sounds.forEach((sound) => rest.delete(sound));
			return { label, icon, banks: !!banks, sounds };
		}).filter((group) => group.sounds.length);
	}

	getChildren(node?: SoundNode): SoundNode[] {
		if (!node) return this.roots;
		if (node.kind === 'group') return (node.children ??= node.banks ? this.bankNodes(node) : this.soundNodes(node.sounds, node));
		if (node.kind === 'bank') return (node.children ??= this.soundNodes(node.sounds, node, true));
		if (node.kind === 'sound' && node.sound.count > 1) {
			const count = Math.min(node.sound.count, MAX_VARIATIONS);
			return Array.from({ length: count }, (_, index) => ({ kind: 'variation', sound: node.sound, index, parent: node }));
		}
		return [];
	}

	private soundNodes(sounds: SoundInfo[], parent: SoundNode, inBank = false): SoundNode[] {
		return sounds.map((sound) => ({ kind: 'sound', sound, parent, label: (inBank && splitBank(sound.name)?.sound) || sound.name }));
	}

	private bankNodes(group: SoundNode & { kind: 'group' }): SoundNode[] {
		const banks = new Map<string, SoundInfo[]>();
		const loose: SoundInfo[] = [];
		for (const sound of group.sounds) {
			const split = splitBank(sound.name);
			if (!split) loose.push(sound);
			else banks.set(split.bank, [...(banks.get(split.bank) ?? []), sound]);
		}
		// One sound with an underscore in its name is not a bank. It stays a plain row.
		for (const [name, sounds] of banks) {
			if (sounds.length > 1) continue;
			loose.push(...sounds);
			banks.delete(name);
		}
		const nodes: SoundNode[] = [...banks.entries()]
			.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
			.map(([name, sounds]) => ({ kind: 'bank', name, sounds, parent: group }));
		loose.sort((a, b) => a.name.localeCompare(b.name));
		return [...nodes, ...this.soundNodes(loose, group)];
	}

	/** Tree icons are images, not text, so they cannot take the theme's color. Hence one file per theme. */
	private icon(name: string): { light: vscode.Uri; dark: vscode.Uri } {
		const file = (theme: string) => vscode.Uri.joinPath(this.extensionUri, 'media', 'icons', `${name}-${theme}.svg`);
		return { light: file('light'), dark: file('dark') };
	}

	private groupOf(node: SoundNode): SoundNode & { kind: 'group' } {
		let current = node;
		while (current.kind !== 'group') current = current.parent;
		return current;
	}

	getTreeItem(node: SoundNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = String(node.sounds.length);
			item.contextValue = 'group';
			item.iconPath = this.icon(node.icon);
			return item;
		}
		if (node.kind === 'bank') {
			const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = String(node.sounds.length);
			item.contextValue = 'bank';
			item.iconPath = this.icon('drum');
			item.tooltip = `${node.name}: ${node.sounds.length} sounds. The button types .bank("${node.name}").`;
			return item;
		}
		const { sound } = node;
		const variation = node.kind === 'variation';
		const label = variation ? `${sound.name}:${variationName(sound, node.index)}` : node.label;
		const expandable = !variation && sound.count > 1;
		const item = new vscode.TreeItem(label, expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		if (expandable) item.description = String(sound.count);
		item.contextValue = 'sound';
		item.iconPath = this.icon(this.groupOf(node).icon);
		item.tooltip = `${soundText(node)} (${sound.tag ?? sound.type}). A click plays it when preview is on. The first button types the name at the cursor.`;
		item.command = { command: 'vstrudel.clickSound', title: 'Preview', arguments: [node] };
		return item;
	}
}

/** The text to put in the code for a node: `bd`, `bd:3` or `RolandTR909_bd`. Always the full name, which is valid anywhere. */
export function soundText(node: SoundNode): string | undefined {
	if (node.kind === 'group' || node.kind === 'bank') return undefined;
	return node.kind === 'variation' ? `${node.sound.name}:${variationName(node.sound, node.index)}` : node.sound.name;
}

/** `3` for a sample, `obervave` for a firmware of `vibefm1`. */
function variationName(sound: SoundInfo, index: number): string {
	return sound.variations?.[index] ?? String(index);
}
