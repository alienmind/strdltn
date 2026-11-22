import * as vscode from 'vscode';
import { songOfAudio } from '../shared/render';

/** Never songs: packages, the cache of remote samples, and git's own folder. */
const EXCLUDE = '**/{node_modules,.strdltn,.git}/**';

/**
 * The songs of the workspace: every `.strudel` file. The Browser shows them in its Songs
 * category, under their folders, and a click opens one the way the Explorer would.
 */
export class SongList {
	private songs: { path: string; uri: vscode.Uri }[] = [];
	/** The renders and recordings of the songs: `.wav` and `.mp3` named after a song, beside it. */
	private audio: { path: string; uri: vscode.Uri; song: string }[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	async refresh(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const found = await vscode.workspace.findFiles('**/*.strudel', EXCLUDE);
		// With several workspace folders the path starts with the folder's name, as in the Explorer.
		this.songs = found.map((uri) => ({ path: vscode.workspace.asRelativePath(uri, folders.length > 1), uri })).sort((a, b) => a.path.localeCompare(b.path));
		const songs = new Set(this.songs.map((song) => song.path));
		const sounds = await vscode.workspace.findFiles('**/*.{wav,mp3,WAV,MP3}', EXCLUDE);
		this.audio = sounds
			.map((uri) => {
				const path = vscode.workspace.asRelativePath(uri, folders.length > 1);
				const song = songOfAudio(path, songs);
				return song ? { path, uri, song } : undefined;
			})
			.filter((entry) => !!entry)
			.sort((a, b) => a.path.localeCompare(b.path));
		this.changed.fire();
	}

	/** Every song, as a path from the workspace folder. */
	all(): string[] {
		return this.songs.map((song) => song.path);
	}

	uri(path: string): vscode.Uri | undefined {
		return this.songs.find((song) => song.path === path)?.uri ?? this.audio.find((audio) => audio.path === path)?.uri;
	}

	/** The renders and recordings, each with the path of its song. */
	renders(): { path: string; song: string }[] {
		return this.audio.map(({ path, song }) => ({ path, song }));
	}
}
