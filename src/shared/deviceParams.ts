// Pure helpers for Devices rotary knob grid, prefix auto-grouping, search, and code snippets (UX-6 UI).
import type { DeviceParam } from './devices.ts';

export type ParamGroupId = 'OSC' | 'FLT' | 'ENV' | 'MOD' | 'FX' | 'MIX' | 'OTHER';

const GROUP_ORDER: readonly ParamGroupId[] = ['OSC', 'FLT', 'ENV', 'MOD', 'FX', 'MIX', 'OTHER'];

const GROUP_RULES: readonly { id: ParamGroupId; pattern: RegExp }[] = [
	{
		id: 'FLT',
		pattern: /(^|[_\-\s])(flt|filt|filter|cut|cutoff|res|reso|resonance|lp|lpf|hp|hpf|bp|bpf|drive|keytrack|kbd|slope|ftype)($|[_\-\s\d])/,
	},
	{
		id: 'ENV',
		pattern: /(^|[_\-\s])(env|adsr|atk|attack|dec|decay|sus|sustain|rel|release|eg|vel|velocity)($|[_\-\s\d])/,
	},
	{
		id: 'MOD',
		pattern: /(^|[_\-\s])(lfo|mod|arp|seq|glide|porta|portamento|vib|vibrato|trem|tremolo|macro|matrix|wheel|aftertouch)($|[_\-\s\d])/,
	},
	{
		id: 'FX',
		pattern: /(^|[_\-\s])(fx|rev|reverb|room|del|delay|echo|cho|chorus|flang|flanger|phas|phaser|dist|distort|overdrive|crush|bit|comp|eq|sat|tape|space)($|[_\-\s\d])/,
	},
	{
		id: 'OSC',
		pattern: /(^|[_\-\s])(osc|vco|wave|waveform|shape|pitch|tune|detune|semi|coarse|fine|pw|pwm|sub|noise|fm|op|ratio|alg|algorithm|sync|unison|chord|ring|wavetable|wt)($|[_\-\s\d])/,
	},
	{
		id: 'MIX',
		pattern: /(^|[_\-\s])(mix|vol|volume|gain|level|lvl|pan|master|out|output|bal|balance|dry|wet|send|amp)($|[_\-\s\d])/,
	},
];

/** Auto-classifies a firmware parameter into a synth section group from its id and label. */
export function classifyParamGroup(param: Pick<DeviceParam, 'id' | 'name'>): ParamGroupId {
	const haystack = `${param.id} ${param.name}`.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2');
	for (const rule of GROUP_RULES) {
		if (rule.pattern.test(haystack)) return rule.id;
	}
	return 'OTHER';
}

/** Returns non-empty parameter groups in canonical synth signal-flow order. */
export function paramGroups(params: readonly DeviceParam[]): { id: ParamGroupId; count: number }[] {
	const counts = new Map<ParamGroupId, number>();
	for (const param of params) {
		const g = classifyParamGroup(param);
		counts.set(g, (counts.get(g) ?? 0) + 1);
	}
	return GROUP_ORDER.flatMap((id) => {
		const count = counts.get(id) ?? 0;
		return count > 0 ? [{ id, count }] : [];
	});
}

/** Filters firmware parameters by selected group and free-text query across id, name, and unit. */
export function filterDeviceParams(params: readonly DeviceParam[], group: ParamGroupId | 'ALL', query: string): DeviceParam[] {
	const q = query.trim().toLowerCase();
	return params.filter((param) => {
		if (group !== 'ALL' && classifyParamGroup(param) !== group) return false;
		if (!q) return true;
		return (
			param.id.toLowerCase().includes(q) ||
			param.name.toLowerCase().includes(q) ||
			param.unit.toLowerCase().includes(q)
		);
	});
}

/** Clamps and snaps a parameter value to its declared min/max/steps. */
export function clampParamValue(param: Pick<DeviceParam, 'min' | 'max' | 'steps'>, raw: number): number {
	const lo = Math.min(param.min, param.max);
	const hi = Math.max(param.min, param.max);
	let v = Math.max(lo, Math.min(hi, raw));
	if (param.steps > 1 && hi > lo) {
		const step = (hi - lo) / (param.steps - 1);
		v = lo + Math.round((v - lo) / step) * step;
		v = Math.max(lo, Math.min(hi, v));
	}
	return v;
}

function roundNumber(v: number): string {
	const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000;
	return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Formats a `.vp("<id>", <value>)` Strudel code snippet for clipboard copy. */
export function formatVpSnippet(param: Pick<DeviceParam, 'id' | 'min' | 'max' | 'steps'>, value: number): string {
	const v = clampParamValue(param, value);
	return `.vp("${param.id}", ${roundNumber(v)})`;
}

/** Formats a `.vp("<id>", slider(<value>, <min>, <max>[, <step>]))` snippet for editor insert. */
export function formatVpSliderSnippet(param: Pick<DeviceParam, 'id' | 'min' | 'max' | 'steps'>, value: number): string {
	const v = clampParamValue(param, value);
	const lo = Math.min(param.min, param.max);
	const hi = Math.max(param.min, param.max);
	const step = param.steps > 1 && hi > lo ? (hi - lo) / (param.steps - 1) : undefined;
	const args = [roundNumber(v), roundNumber(lo), roundNumber(hi), ...(step !== undefined ? [roundNumber(step)] : [])];
	return `.vp("${param.id}", slider(${args.join(', ')}))`;
}
