// Promotes the current checkout to the maintainer's own VS Code.
//
// Two copies of the extension exist on a maintainer's machine, and they must not mix:
//   dist/   the work in progress. Only an Extension Development Host loads it (F5,
//           `pnpm test:vscode`). An agent may rebuild it at any moment.
//   .bin/   the last promoted build, as a .vsix. This script installs it into the
//           VS Code you work in every day. It changes only when this script runs.
//
// VS Code cannot load a .vsix from a folder by configuration, so the install step is
// `code --install-extension`. The new copy is used after "Developer: Reload Window".
// "Restart Extension Host" reloads the code but can keep old titles and icons.
//
//   pnpm promote                build, package into .bin/, install
//   pnpm promote --no-install   build and package only
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const node = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
// pnpm and code are .cmd files on Windows, which only a shell can start.
const shell = (command) => execSync(command, { cwd: root, stdio: 'inherit' });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const build = git('describe', '--tags', '--always', '--dirty');
if (build.endsWith('-dirty')) console.warn(`warning: uncommitted changes are part of this build (${build})`);
const release = build === `v${version}`;
if (!release) console.warn(`warning: this is not the tagged release v${version}, it is ${build}`);

// A build that is not a release gets a version of its own, inside the package only.
// A window that already runs 0.0.3 treats another 0.0.3 as the same extension and
// keeps the view title and icon it registered (seen after a rename of the side panel).
// package.json is not touched: the maintainer decides when the version changes.
const time = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const packageVersion = release ? '' : `${version}-dev.${time}`;

mkdirSync(join(root, '.bin'), { recursive: true });
const vsix = join(root, '.bin', 'vstrudel.vsix');
node('scripts/build.mjs', '--production');
shell(`pnpm exec vsce package ${packageVersion} --no-dependencies --no-update-package-json --no-git-tag-version --out "${vsix}"`);
writeFileSync(join(root, '.bin', 'PROMOTED.txt'), `${build}\n${new Date().toISOString()}\n`);
// A production build has no source maps and no test bundle. Put the development
// build back, or the next F5 would start from a stripped dist/.
node('scripts/build.mjs');

if (process.argv.includes('--no-install')) {
	console.log(`\npackaged ${build} as .bin/vstrudel.vsix (not installed)`);
} else {
	const installed = spawnSync(`code --install-extension "${vsix}" --force`, { cwd: root, stdio: 'inherit', shell: true });
	if (installed.status !== 0) {
		console.error('\ninstall failed. Is the `code` command on your PATH? The package is at .bin/vstrudel.vsix');
		process.exit(installed.status ?? 1);
	}
	console.log(`\npromoted ${build}${packageVersion ? ` as ${packageVersion}` : ''}. Run "Developer: Reload Window" in VS Code to load it.`);
}
