// Downloads the official native `fm1-live` JIT binary from github.com/joakimeriksson/fm1-emu
// into `bin/<target>/` for platform-specific `.vsix` packaging in GitHub Actions (Windows, macOS, Linux).
// @credits Joakim Eriksson (fm1-emu) — MIT license
//
// Usage: node scripts/fetch-fm1-native.mjs <win32-x64|darwin-arm64|linux-x64|linux-arm64>
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { findZipBinaryEntry, FM1_NATIVE_TARGETS } from '../src/shared/nativeFm1.ts';

const targetKey = process.argv[2];
const target = targetKey && FM1_NATIVE_TARGETS[targetKey];
if (!target) {
	console.error(`Usage: node scripts/fetch-fm1-native.mjs <${Object.keys(FM1_NATIVE_TARGETS).join('|')}>`);
	process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'bin', target.key);
const tmpDir = join(root, '.strdltn', 'tmp', `fm1-native-${target.key}`);
rmSync(outDir, { recursive: true, force: true });
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

console.log(`Downloading ${target.url} ...`);
const response = await fetch(target.url, {
	headers: { 'User-Agent': 'strdltn-ci (+https://github.com/alienmind/strdltn)' },
});
if (!response.ok) {
	console.error(`Failed to download ${target.url}: HTTP ${response.status}`);
	process.exit(1);
}
const bytes = new Uint8Array(await response.arrayBuffer());
const outPath = join(outDir, target.binary);

if (target.archive === 'zip') {
	const entries = unzipSync(bytes);
	const match = findZipBinaryEntry(entries, target.binary);
	if (!match) {
		console.error(`${target.binary} not found in ${target.asset}`);
		process.exit(1);
	}
	writeFileSync(outPath, match[1]);
} else {
	const archivePath = join(tmpDir, target.asset);
	writeFileSync(archivePath, bytes);
	execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir]);
	const find = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				const nested = find(full);
				if (nested) return nested;
			} else if (entry.name === target.binary) {
				return full;
			}
		}
		return undefined;
	};
	const found = find(tmpDir);
	if (!found) {
		console.error(`${target.binary} not found after extracting ${target.asset}`);
		process.exit(1);
	}
	copyFileSync(found, outPath);
	chmodSync(outPath, 0o755);
}

rmSync(tmpDir, { recursive: true, force: true });
console.log(`Ready: ${outPath}`);
