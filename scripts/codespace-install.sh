#!/usr/bin/env bash
# Builds the extension from this checkout and installs it into the Codespace.
#
#   codespace-install.sh build     build the .vsix (postCreateCommand)
#   codespace-install.sh install   install it, building first if it is missing
#                                  (postAttachCommand: `code` needs a connected editor)
#
# The .vsix is kept in the home folder. The first version passed it through /tmp and
# the file was gone by the time the editor attached. Building again on attach when the
# file is missing also puts any build error in the terminal you are looking at.
set -euo pipefail

cd "$(dirname "$0")/.."
vsix="$HOME/.vstrudel/vstrudel.vsix"

build() {
	# No global pnpm in the image. npx runs the exact version package.json names,
	# without `corepack enable`, which needs write access to the Node folder.
	local pnpm="pnpm"
	if ! command -v pnpm >/dev/null 2>&1; then
		pnpm="npx --yes pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
	fi
	$pnpm install --frozen-lockfile
	$pnpm package
	mkdir -p "$(dirname "$vsix")"
	cp vstrudel-*.vsix "$vsix"
	echo "built $vsix"
}

case "${1:-install}" in
	build)
		build
		;;
	install)
		[ -f "$vsix" ] || build
		code --install-extension "$vsix" --force
		;;
	*)
		echo "usage: $0 build|install" >&2
		exit 2
		;;
esac