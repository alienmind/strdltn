// Runs src/test/m0.ts inside a real desktop VS Code and prints what it recorded.
//
// The instance has its own throwaway profile, so your own settings are not touched.
// Extra arguments go to VS Code, for example:
//   pnpm test:vscode -- --autoplay-policy=no-user-gesture-required
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--test'], { cwd: root, stdio: 'inherit' });

// Set VSCODE_EXE to test against a VS Code you already have. Otherwise the stable
// build is downloaded once into .vscode-test/. We do not default to the installed one:
// it refuses to start a second instance while an update is pending.
const executable = process.env.VSCODE_EXE ?? (await downloadAndUnzipVSCode('stable'));
if (!existsSync(executable)) throw new Error(`VS Code not found at ${executable}.`);

const profile = mkdtempSync(join(tmpdir(), 'vstrudel-test-'));
const out = join(profile, 'result.json');
// This script may itself be started from a VS Code terminal or extension. Those set
// variables that would make the new Code.exe run as plain Node or attach to the parent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ELECTRON_|VSCODE_)/.test(name)));
env.VSTRUDEL_TEST_OUT = out;

const args = [
	`--extensionDevelopmentPath=${root}`,
	`--extensionTestsPath=${join(root, 'dist/test/m0.cjs')}`,
	`--user-data-dir=${join(profile, 'user')}`,
	`--extensions-dir=${join(profile, 'extensions')}`,
	'--disable-workspace-trust',
	'--skip-welcome',
	'--skip-release-notes',
	'--disable-updates',
	...process.argv.slice(2),
	join(root, 'template'),
];

const child = spawn(executable, args, { env, stdio: 'inherit' });
const timeout = setTimeout(() => child.kill(), 6 * 60 * 1000);
child.on('exit', (code) => {
	clearTimeout(timeout);
	console.log(existsSync(out) ? readFileSync(out, 'utf8') : 'no result file was written');
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	} catch {
		// VS Code can still hold a file for a moment. The folder is in the temp directory.
	}
	process.exit(code ?? 1);
});
