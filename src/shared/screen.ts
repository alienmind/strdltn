// Messages of the firmware screen popup: a tab that runs one installed firmware without sound and shows its display,
// opened from the Firmware category of the Library. See "Firmware screen" in doc/ARCHITECTURE.md.

/** The firmware to show. `url` is the `.wasm` or package `.zip`, as a webview URL. */
export interface ScreenFirmware {
	id: string;
	name: string;
	version?: string;
	author?: string;
	license?: string;
	description?: string;
	/** Not installed yet: the page offers Install instead of Insert. */
	available?: boolean;
	url: string;
}

export type ToScreen = { type: 'firmware'; firmware: ScreenFirmware };

export type FromScreen =
	| { type: 'ready' }
	/** What the page shows now: frames painted since the firmware started, or why it could not run. For the test. */
	| { type: 'state'; id: string; frames: number; params: number; error?: string }
	| { type: 'insert'; id: string }
	| { type: 'install'; id: string }
	| { type: 'log'; message: string };
