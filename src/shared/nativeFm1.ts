// Platform target mapping and CLI argument builders for native fm1-live emulation.
// @credits Joakim Eriksson (fm1-emu) — MIT licensed native JIT emulator for M-VAVE FM-1 .fwsc firmwares.

export const FM1_NATIVE_VERSION = '0.5.1';
const RELEASE_BASE = `https://github.com/joakimeriksson/fm1-emu/releases/download/v${FM1_NATIVE_VERSION}`;

export type NativePlatformKey = 'win32-x64' | 'darwin-arm64' | 'linux-x64' | 'linux-arm64';

export interface NativeFm1Target {
	key: NativePlatformKey;
	asset: string;
	url: string;
	archive: 'zip' | 'tar.gz';
	binary: string;
	/** True when `fm1-live --usb` creates a virtual OS MIDI port automatically (macOS CoreMIDI / Linux ALSA). */
	usbMidi: boolean;
}

export const FM1_NATIVE_TARGETS: Record<NativePlatformKey, NativeFm1Target> = {
	'win32-x64': {
		key: 'win32-x64',
		asset: `fm1-emu-${FM1_NATIVE_VERSION}-windows-x86_64.zip`,
		url: `${RELEASE_BASE}/fm1-emu-${FM1_NATIVE_VERSION}-windows-x86_64.zip`,
		archive: 'zip',
		binary: 'fm1-live.exe',
		usbMidi: false,
	},
	'darwin-arm64': {
		key: 'darwin-arm64',
		asset: `fm1-emu-${FM1_NATIVE_VERSION}-macos-arm64.tar.gz`,
		url: `${RELEASE_BASE}/fm1-emu-${FM1_NATIVE_VERSION}-macos-arm64.tar.gz`,
		archive: 'tar.gz',
		binary: 'fm1-live',
		usbMidi: true,
	},
	'linux-x64': {
		key: 'linux-x64',
		asset: `fm1-emu-${FM1_NATIVE_VERSION}-linux-x86_64.tar.gz`,
		url: `${RELEASE_BASE}/fm1-emu-${FM1_NATIVE_VERSION}-linux-x86_64.tar.gz`,
		archive: 'tar.gz',
		binary: 'fm1-live',
		usbMidi: true,
	},
	'linux-arm64': {
		key: 'linux-arm64',
		asset: `fm1-emu-${FM1_NATIVE_VERSION}-linux-arm64.tar.gz`,
		url: `${RELEASE_BASE}/fm1-emu-${FM1_NATIVE_VERSION}-linux-arm64.tar.gz`,
		archive: 'tar.gz',
		binary: 'fm1-live',
		usbMidi: true,
	},
};

/** Resolves the prebuilt `fm1-live` release target for a Node `(platform, arch)` pair, if one exists. */
export function nativeTargetFor(platform: string, arch: string): NativeFm1Target | undefined {
	const key = `${platform}-${arch}` as NativePlatformKey;
	return FM1_NATIVE_TARGETS[key];
}

/** Builds CLI arguments for launching `fm1-live` with a `.fwsc` firmware package. */
export function nativeFm1Args(
	fwscPath: string,
	options: { flashPath?: string; usb?: boolean; midi?: string } = {},
): string[] {
	const args = ['--fwsc', fwscPath];
	if (options.flashPath) args.push('--flash', options.flashPath);
	if (options.usb) args.push('--usb');
	if (options.midi) args.push('--midi', options.midi);
	return args;
}

/** True when a file name looks like a user-supplied SHRUB `.fwsc` package. */
export function isShrubFileName(name: string): boolean {
	return /shrub.*\.fwsc$/i.test(name);
}
