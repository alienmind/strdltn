// Messages of the Devices view: between the engine (the webview that plays a song), the extension host, and the
// Devices view in the bottom panel. A firmware runs in the engine's AudioWorklet; the view is another webview, so
// everything goes through the host. See "Devices" in doc/ARCHITECTURE.md.

/** A parameter a firmware declared with vibe_params (vibe_wasm_param_info). */
export interface DeviceParam {
	index: number;
	id: string;
	name: string;
	min: number;
	max: number;
	def: number;
	unit: string;
	/** 0 for a continuous value, else the number of steps. */
	steps: number;
}

/** One running copy of a firmware: one per firmware and orbit. */
export interface DeviceInfo {
	/** `<id>@<orbit>`, unique in its engine. */
	key: string;
	id: string;
	orbit: number;
	params: DeviceParam[];
}

/** What the view asks of a device. Routed to the engine that runs it. */
export type DeviceRequest =
	/** A panel opened or closed: the firmware draws only while one is open. */
	| { action: 'draw'; key: string; on: boolean }
	/** The view painted the last frame: the next may come (one frame in flight per panel, spike F1). */
	| { action: 'painted'; key: string }
	| { action: 'param'; key: string; index: number; value: number }
	/** A VIBE_EV_BUTTON (3) or VIBE_EV_ENCODER (4) event, ids as in vibe.h. */
	| { action: 'control'; key: string; event: 3 | 4; id: number; down: number; value: number };

/** A device as the view sees it: with the song that plays it. */
export interface ViewDevice extends DeviceInfo {
	/** Which engine runs it: an id the host gives each one. */
	engine: string;
	song: string;
}

export type ToDevices =
	| { type: 'devices'; devices: ViewDevice[] }
	/**
	 * What this page is. `only`: a tab with one device taken out of the view (`<engine>/<key>`). `out`: in the view, the
	 * devices that are in a tab now. `shrub`: the SHRUB editor panel is on (setting strdltn.experimental.shrubEditor).
	 */
	| { type: 'page'; only?: string; out: string[]; shrub: boolean }
	/** A display frame: 480 x 320 RGB565, row by row, and the parameters' values now. */
	| { type: 'frame'; engine: string; key: string; px: Uint8Array; values: number[] };

export type FromDevices =
	| { type: 'ready' }
	| ({ type: 'request'; engine: string } & DeviceRequest)
	/** Take a device out of the view into an editor tab. For SHRUB, its own tab. */
	| { type: 'takeOut'; engine: string; key: string }
	| { type: 'takeOutShrub' }
	| { type: 'state'; panels: { key: string; open: boolean; frames: number }[] }
	| { type: 'log'; message: string };
