// Messages and pure helpers for the First-Install Welcome Screen tab (UX-5).

export type WelcomeAction =
	| 'playDemo'
	| 'tryFind'
	| 'tryMix'
	| 'tryDevices'
	| 'tryMidi'
	| 'tryRender'
	| 'importProfile'
	| 'openManual';

export interface WelcomeCard {
	id: string;
	badge: string;
	title: string;
	description: string;
	imageFile: string;
	accent: string;
	action: WelcomeAction;
	actionLabel: string;
}

export const WELCOME_CARDS: readonly WelcomeCard[] = [
	{
		id: 'play',
		badge: '01 Play',
		title: 'Live-Code in the Strudel Editor',
		description: 'Edit patterns with inline highlights, live sliders, track color bars, and M / S / C gutter controls. Press Ctrl+Enter to update on the beat.',
		imageFile: 'play.png',
		accent: '#3794ff',
		action: 'playDemo',
		actionLabel: 'Try it',
	},
	{
		id: 'find',
		badge: '02 Find',
		title: 'Two-Column Browser & Waveform Trim',
		description: 'Audition 2,000+ drums, synths, samples, and snippets on a single click, trim slices with .begin()/.end() handles, and drag straight into your song.',
		imageFile: 'find.png',
		accent: '#2ea043',
		action: 'tryFind',
		actionLabel: 'Try it',
	},
	{
		id: 'mix',
		badge: '03 Mix',
		title: 'Mixer, Track Colors & Sidechain Cables',
		description: 'Every $name: chain becomes a strip with stereo LED meters, peak hold, color coding, and drag-and-drop sidechain ducking cables written right to code.',
		imageFile: 'mix.png',
		accent: '#e5a00d',
		action: 'tryMix',
		actionLabel: 'Try it',
	},
	{
		id: 'devices',
		badge: '04 Synths',
		title: 'Devices & FM-1 Hardware Firmwares',
		description: 'Play VIBE .wasm and real FM-1 .fwsc synths with live 480x320 hardware displays, soft keys, and the spacious Full-Screen Synths Gallery.',
		imageFile: 'devices.png',
		accent: '#a855f7',
		action: 'tryDevices',
		actionLabel: 'Open Gallery',
	},
	{
		id: 'midi',
		badge: '05 MIDI',
		title: 'Desktop MIDI & Visuals',
		description: 'Map hardware knobs to any slider with one click (.knob(cc)), sequence external synths over desktop MIDI, and layer live Hydra visuals behind your code.',
		imageFile: 'midi.png',
		accent: '#f43f5e',
		action: 'tryMidi',
		actionLabel: 'Try it',
	},
	{
		id: 'render',
		badge: '06 Render',
		title: 'Record Jams & Offline WAV / MP3',
		description: 'Capture live sets or render exact cycle lengths to studio-quality .wav and .mp3 files beside your .strudel song, with a built-in Master safety limiter.',
		imageFile: 'render.png',
		accent: '#14b8a6',
		action: 'tryRender',
		actionLabel: 'Try it',
	},
];

export type ToWelcome = {
	type: 'init';
	version: string;
	dismissed: boolean;
	logoUrl: string;
	images: Record<string, string>;
	hasDemo: boolean;
	hasProfile: boolean;
};

export type FromWelcome =
	| { type: 'ready' }
	| { type: 'action'; action: WelcomeAction }
	| { type: 'setDismissed'; dismissed: boolean };

/** Pure gate for first-install auto-open: suppressed when dismissed or during automated test runs. */
export function shouldAutoShowWelcome(dismissed: boolean, isTestHost: boolean): boolean {
	return !dismissed && !isTestHost;
}
