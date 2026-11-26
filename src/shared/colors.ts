// Track colors (`// @color <name>` or `// @color #rrggbb`) shared across Mixer, Editor gutter, and Devices.
// Colors stay fixed across light/dark/high-contrast themes so tracks are recognized at a glance.

export interface TrackColor {
	name: string;
	hex: string;
}

/** Curated Ableton-inspired 14-color track palette. */
export const TRACK_PALETTE: readonly TrackColor[] = [
	{ name: 'coral', hex: '#ff6b6b' },
	{ name: 'orange', hex: '#f08c2e' },
	{ name: 'amber', hex: '#e5a00d' },
	{ name: 'yellow', hex: '#d8c036' },
	{ name: 'lime', hex: '#8bc34a' },
	{ name: 'green', hex: '#3fb950' },
	{ name: 'teal', hex: '#2ec4b6' },
	{ name: 'cyan', hex: '#39c5cf' },
	{ name: 'sky', hex: '#3794ff' },
	{ name: 'blue', hex: '#5c7cfa' },
	{ name: 'indigo', hex: '#846cf0' },
	{ name: 'purple', hex: '#b180d7' },
	{ name: 'magenta', hex: '#e056b0' },
	{ name: 'rose', hex: '#f27298' },
] as const;

const BY_NAME = new Map<string, string>(TRACK_PALETTE.map((c) => [c.name, c.hex]));
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_LINE_RE = /^[ \t]*\/\/[ \t]*@color[ \t]+([^\s]+)[ \t]*$/i;

/** Resolves a palette name (case-insensitive) or `#rrggbb` / `#rgb` value to its hex color. */
export function resolveTrackColor(raw: string | undefined): { name?: string; hex: string } | undefined {
	if (!raw) return undefined;
	const clean = raw.trim().toLowerCase();
	const named = BY_NAME.get(clean);
	if (named) return { name: clean, hex: named };
	if (HEX_RE.test(clean)) {
		const hex =
			clean.length === 4
				? `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`
				: clean;
		const matched = TRACK_PALETTE.find((c) => c.hex.toLowerCase() === hex);
		return { name: matched?.name, hex };
	}
	return undefined;
}

/** Returns the first palette color whose hex is not in `usedHexes` (or cycles when all 14 are used). */
export function nextUnusedColor(usedHexes: Iterable<string>, fallbackIndex = 0): TrackColor {
	const used = new Set([...usedHexes].map((h) => h.toLowerCase()));
	const free = TRACK_PALETTE.find((c) => !used.has(c.hex.toLowerCase()));
	return free ?? TRACK_PALETTE[fallbackIndex % TRACK_PALETTE.length];
}

export interface ColorCommentMatch {
	raw: string;
	name?: string;
	hex: string;
	/** Start offset of the `// @color ...` line in `\n`-normalized `code`. */
	lineFrom: number;
	/** End offset of the line (excluding the trailing `\n`). */
	lineTo: number;
}

/**
 * Finds a `// @color <value>` comment linked to the chain starting at `statementStart`.
 * Other `//` comment lines may sit between them; an empty line or code line breaks the link.
 */
export function findColorComment(code: string, statementStart: number): ColorCommentMatch | undefined {
	let lineStart = code.lastIndexOf('\n', statementStart - 1) + 1;
	while (lineStart > 0) {
		const prevEnd = lineStart - 1;
		const prevStart = code.lastIndexOf('\n', prevEnd - 1) + 1;
		const line = code.slice(prevStart, prevEnd);
		const trimmed = line.trim();
		if (!trimmed.startsWith('//')) return undefined;
		const match = COLOR_LINE_RE.exec(line);
		if (match) {
			const resolved = resolveTrackColor(match[1]);
			if (resolved) return { raw: match[1], ...resolved, lineFrom: prevStart, lineTo: prevEnd };
		}
		lineStart = prevStart;
	}
	return undefined;
}

/**
 * Computes the single edit that sets, updates, or removes `// @color <value>` directly above the chain
 * starting at `statementStart` in `\n`-normalized `code`.
 */
export function buildColorEdit(
	code: string,
	statementStart: number,
	color: string | undefined,
): { from: number; to: number; insert: string } | undefined {
	const existing = findColorComment(code, statementStart);
	if (!color) {
		if (!existing) return undefined;
		const end = existing.lineTo < code.length && code[existing.lineTo] === '\n' ? existing.lineTo + 1 : existing.lineTo;
		return { from: existing.lineFrom, to: end, insert: '' };
	}
	const resolved = resolveTrackColor(color);
	if (!resolved) return undefined;
	const token = resolved.name ?? resolved.hex;
	const lineStart = code.lastIndexOf('\n', statementStart - 1) + 1;
	const indent = /^[ \t]*/.exec(code.slice(lineStart, statementStart))?.[0] ?? '';
	if (existing) {
		const existingIndent = /^[ \t]*/.exec(code.slice(existing.lineFrom, existing.lineTo))?.[0] ?? '';
		const replacement = `${existingIndent}// @color ${token}`;
		if (code.slice(existing.lineFrom, existing.lineTo) === replacement) return undefined;
		return { from: existing.lineFrom, to: existing.lineTo, insert: replacement };
	}
	return { from: lineStart, to: lineStart, insert: `${indent}// @color ${token}\n` };
}
