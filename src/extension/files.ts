import * as vscode from 'vscode';
import { buildFileTree, countFiles, type FileTreeFile, type FileTreeFolder } from '../shared/filetree';

/** A folder or a file of the tree, with the workspace folder it belongs to. */
export type FileNode = { item: FileTreeFolder | FileTreeFile; root: vscode.Uri; parent?: FileNode; children?: FileNode[] };

/** Never songs: packages, the cache of remote samples, and git's own folder. */
const EXCLUDE = '**/{node_modules,.strdltn,.git}/**';

/**
 * The Files view: the folders of the workspace that hold `.strudel` files, and those
 * files. It is the Explorer with everything else left out, so a song is one click away
 * without leaving the strdltn side bar. A click opens the file the way the Explorer
 * would, which is the Strudel editor unless the user chose otherwise.
 */
export class FilesProvider implements vscode.TreeDataProvider<FileNode> {
	private roots: FileNode[] = [];
	private paths: string[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	async refresh(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const found = await vscode.workspace.findFiles('**/*.strudel', EXCLUDE);
		this.paths = found.map((uri) => vscode.workspace.asRelativePath(uri, folders.length > 1)).sort();
		const trees = folders.map((folder) => {
			// Ask VS Code which folder a file is in. Comparing the paths as text fails on
			// Windows, where the drive letter of the two can differ in case.
			const inside = found
				.filter((uri) => vscode.workspace.getWorkspaceFolder(uri)?.index === folder.index)
				.map((uri) => vscode.workspace.asRelativePath(uri, false));
			return { folder, tree: buildFileTree(inside) };
		});
		// One workspace folder: its content is the top level, as in the Explorer. Several:
		// each is a row, named after the folder.
		this.roots =
			trees.length === 1
				? this.nodes(trees[0].tree, trees[0].folder.uri, undefined)
				: trees.filter(({ tree }) => countFiles(tree)).map(({ folder, tree }) => ({ item: { ...tree, name: folder.name }, root: folder.uri }));
		this.changed.fire();
	}

	/** Every file of the view, as a path from the workspace folder. For the test. */
	all(): string[] {
		return this.paths;
	}

	private nodes(folder: FileTreeFolder, root: vscode.Uri, parent: FileNode | undefined): FileNode[] {
		return [...folder.folders, ...folder.files].map((item) => ({ item, root, parent }));
	}

	getChildren(node?: FileNode): FileNode[] {
		if (!node) return this.roots;
		if (node.item.kind === 'file') return [];
		// Kept, so that `TreeView.reveal` finds the same objects again.
		return (node.children ??= this.nodes(node.item, node.root, node));
	}

	getParent(node: FileNode): FileNode | undefined {
		return node.parent;
	}

	getTreeItem(node: FileNode): vscode.TreeItem {
		const { item, root } = node;
		const uri = item.path ? vscode.Uri.joinPath(root, ...item.path.split('/')) : root;
		if (item.kind === 'folder') {
			const tree = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.Collapsed);
			// With the address, the row gets the folder icon of the theme and the colors of git.
			tree.resourceUri = uri;
			tree.iconPath = vscode.ThemeIcon.Folder;
			tree.description = String(countFiles(item));
			tree.contextValue = 'folder';
			return tree;
		}
		const tree = new vscode.TreeItem(item.name.replace(/\.strudel$/, ''), vscode.TreeItemCollapsibleState.None);
		tree.resourceUri = uri;
		tree.iconPath = vscode.ThemeIcon.File;
		tree.tooltip = item.path;
		tree.contextValue = 'file';
		tree.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
		return tree;
	}
}
