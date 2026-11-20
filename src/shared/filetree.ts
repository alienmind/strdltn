// The tree of the Files view: every folder of the workspace that holds a .strudel file,
// at any depth, and nothing else. Built from a flat list of paths so it can be tested
// without VS Code.

export interface FileTreeFolder {
	kind: 'folder';
	name: string;
	/** Path from the root, with `/`. Empty for the root. */
	path: string;
	folders: FileTreeFolder[];
	files: FileTreeFile[];
}

export interface FileTreeFile {
	kind: 'file';
	name: string;
	path: string;
}

/** Names sort the way a person reads them: `2-b` before `10-a`, case ignored. */
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * `paths` are relative to the root, with `/`. Folders come before files, as in the
 * Explorer. A folder is only there because a file below it is.
 */
export function buildFileTree(paths: string[]): FileTreeFolder {
	const root: FileTreeFolder = { kind: 'folder', name: '', path: '', folders: [], files: [] };
	for (const path of new Set(paths)) {
		const parts = path.split('/').filter(Boolean);
		const name = parts.pop();
		if (!name) continue;
		let folder = root;
		for (const part of parts) {
			let next = folder.folders.find((child) => child.name === part);
			if (!next) {
				next = { kind: 'folder', name: part, path: folder.path ? `${folder.path}/${part}` : part, folders: [], files: [] };
				folder.folders.push(next);
			}
			folder = next;
		}
		folder.files.push({ kind: 'file', name, path });
	}
	const sort = (folder: FileTreeFolder): void => {
		folder.folders.sort(byName);
		folder.files.sort(byName);
		folder.folders.forEach(sort);
	};
	sort(root);
	return root;
}

/** How many files a folder holds, at any depth. */
export function countFiles(folder: FileTreeFolder): number {
	return folder.files.length + folder.folders.reduce((sum, child) => sum + countFiles(child), 0);
}
