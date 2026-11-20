// Icons of the Browser, drawn in its text color. 16 by 16, stroked, in the style of the
// icons in media/icons (which the old tree views used as files, one per theme).
const svg = (body: string, extra = '') =>
	`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS: Record<string, string> = {
	all: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
	keyboard: svg('<rect x="1.5" y="3.5" width="13" height="9" rx="1"/><path d="M4.75 8.5v4M8 8.5v4M11.25 8.5v4"/><path d="M4.75 3.5v5M8 3.5v5M11.25 3.5v5" stroke-width="2.2" stroke-linecap="butt"/>'),
	drum: svg('<ellipse cx="8" cy="6.5" rx="5.5" ry="2.2"/><path d="M2.5 6.5v4.8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V6.5"/><path d="M3.5 1.5l3 3.2M12.5 1.5l-3 3.2"/>'),
	sample: svg('<path d="M1.5 8h1M4 5.5v5M6.5 3v10M9 6v4M11.5 4.5v7M14 7.5v1"/>'),
	midi: svg('<circle cx="8" cy="8" r="6"/><path d="M6.8 13.8v-1.3h2.4v1.3"/><circle cx="4.7" cy="8" r=".6" fill="currentColor"/><circle cx="11.3" cy="8" r=".6" fill="currentColor"/><circle cx="5.7" cy="5.5" r=".6" fill="currentColor"/><circle cx="10.3" cy="5.5" r=".6" fill="currentColor"/><circle cx="8" cy="4.6" r=".6" fill="currentColor"/>'),
	snippet: svg('<path d="M5.5 3C4 3 4 4 4 5v1.5C4 7.5 3 8 2.5 8 3 8 4 8.5 4 9.5V11c0 1 0 2 1.5 2M10.5 3C12 3 12 4 12 5v1.5c0 1 1 1.5 1.5 1.5-.5 0-1.5.5-1.5 1.5V11c0 1 0 2-1.5 2"/>'),
	song: svg('<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/><circle cx="7" cy="11" r="1.3"/><path d="M8.3 11V7l2-.5"/>'),
	function: svg('<path d="M10.5 2.5c-2 0-2.5 1-2.8 3L6.3 12c-.3 1.5-.8 2-2.3 2M5 6.5h5"/>'),
	folder: svg('<path d="M1.5 4V12.5h13v-7H7.5L6 4z"/>'),
	pack: svg('<path d="M2 5l6-3 6 3v6.5l-6 3-6-3z"/><path d="M2 5l6 3 6-3M8 8v6.5"/>'),
	play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor"/>'),
	insert: svg('<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/>'),
	copy: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M11 5V3.5c0-.6-.4-1-1-1H3.5c-.6 0-1 .4-1 1V10c0 .6.4 1 1 1H5"/>'),
	open: svg('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4"/>'),
	chevron: svg('<path d="M6 4l4 4-4 4"/>'),
	speaker: svg('<path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 5.5c1 1.4 1 3.6 0 5M12.8 4c1.8 2.3 1.8 5.7 0 8"/>'),
	mute: svg('<path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 6l3.5 4M14.5 6L11 10"/>'),
	search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3l3.7 3.7"/>'),
	close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
	tag: svg('<path d="M2 2.5h5.5l6.5 6.5-5 5-6.5-6.5z"/><circle cx="5" cy="5.5" r="1"/>'),
	save: svg('<path d="M3.5 2.5h7l2 2v9h-9z"/><path d="M5.5 2.5v3h4v-3M5.5 13.5v-4h5v4"/>'),
};

export function icon(name: string): string {
	return ICONS[name] ?? ICONS.all;
}
