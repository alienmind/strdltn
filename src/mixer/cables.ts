// Cables between jacks, drawn as one SVG path each: a cubic curve from plug to plug that
// sags under its own weight. Only the sag moves, on a damped spring, so a cable swings
// when one of its ends moves and comes to rest.
//
// @credits ableton-rackutils
//
// The physics and the constants are those of the cables that stay plugged in there (see
// "The cables of ableton-rackutils" in doc/DAW-PLAN.md). Written again without React.
// A cable being dragged is one more cable whose loose end is a marker under the pointer
// (see main.ts), so it swings like the others.

export interface CableSpec {
	/** Stable across redraws, so a spring keeps its motion when the model is sent again. */
	key: string;
	from: Element;
	to: Element;
	/** `drag`: the cable in the hand, from a jack to the pointer. */
	kind: 'sidechain' | 'drag';
	label?: string;
}

interface Point {
	x: number;
	y: number;
}

interface Cable extends CableSpec {
	sag: number;
	velocity: number;
	last?: { from: Point; to: Point };
	path: SVGPathElement;
	plugs: SVGCircleElement[];
	text?: SVGTextElement;
}

const SAG_RATIO = 0.18;
const SAG_MAX = 90;
const STIFFNESS = 120;
const DAMPING = 9;
/** An end that moved by n pixels adds n times this to the velocity: the swing. */
const SWING = 6;
/** The loop sleeps after this many frames with every spring at rest. */
const REST_FRAMES = 30;

const SVG = 'http://www.w3.org/2000/svg';

export class CableLayer {
	readonly svg: SVGSVGElement;
	private cables = new Map<string, Cable>();
	private frame = 0;
	private restFrames = 0;
	private lastTime = 0;
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	/** `container` is the scrolling element the jacks live in. The layer scrolls with it and is clipped by it. */
	constructor(private readonly container: HTMLElement) {
		this.svg = document.createElementNS(SVG, 'svg');
		this.svg.classList.add('cables');
		container.appendChild(this.svg);
		new ResizeObserver(() => this.wake()).observe(container);
		window.addEventListener('resize', () => this.wake());
	}

	/** Replaces the cables. Ones with a key that was there before keep their spring. */
	set(specs: CableSpec[]): void {
		const next = new Map<string, Cable>();
		for (const spec of specs) {
			const old = this.cables.get(spec.key);
			const cable: Cable = old ? { ...old, ...spec } : this.create(spec);
			next.set(spec.key, cable);
		}
		for (const [key, cable] of this.cables) if (!next.has(key)) this.remove(cable);
		this.cables = next;
		this.wake();
	}

	count(): number {
		return this.cables.size;
	}

	/** Something moved: a fold, a resize. The loop runs until the springs rest again. */
	wake(): void {
		this.restFrames = 0;
		if (!this.frame) {
			this.lastTime = performance.now();
			this.frame = requestAnimationFrame((time) => this.step(time));
		}
	}

	private create(spec: CableSpec): Cable {
		const group = this.svg.appendChild(document.createElementNS(SVG, 'g'));
		group.classList.add('cable', spec.kind);
		const path = group.appendChild(document.createElementNS(SVG, 'path'));
		const plugs = [0, 1].map(() => {
			const plug = group.appendChild(document.createElementNS(SVG, 'circle'));
			plug.setAttribute('r', '3');
			return plug;
		});
		const text = spec.label ? group.appendChild(document.createElementNS(SVG, 'text')) : undefined;
		if (text) text.textContent = spec.label!;
		return { ...spec, sag: 0, velocity: 0, path, plugs, text };
	}

	private remove(cable: Cable): void {
		cable.path.parentElement?.remove();
	}

	/** The center of a jack in the coordinates of the container's content. */
	private center(element: Element): Point {
		const box = element.getBoundingClientRect();
		const origin = this.container.getBoundingClientRect();
		return { x: box.left + box.width / 2 - origin.left + this.container.scrollLeft, y: box.top + box.height / 2 - origin.top + this.container.scrollTop };
	}

	private step(time: number): void {
		const dt = Math.min((time - this.lastTime) / 1000, 1 / 30);
		this.lastTime = time;
		let moving = false;
		for (const cable of this.cables.values()) {
			const from = this.center(cable.from);
			const to = this.center(cable.to);
			const distance = Math.hypot(to.x - from.x, to.y - from.y);
			const target = Math.min(distance * SAG_RATIO, SAG_MAX);
			if (cable.last) {
				const moved = Math.hypot(from.x - cable.last.from.x, from.y - cable.last.from.y) + Math.hypot(to.x - cable.last.to.x, to.y - cable.last.to.y);
				cable.velocity += moved * SWING;
			} else {
				cable.sag = target;
			}
			cable.last = { from, to };
			if (this.reducedMotion.matches) {
				cable.sag = target;
				cable.velocity = 0;
			} else {
				const acceleration = STIFFNESS * (target - cable.sag) - DAMPING * cable.velocity;
				cable.velocity += acceleration * dt;
				cable.sag += cable.velocity * dt;
			}
			if (Math.abs(cable.velocity) > 0.5 || Math.abs(target - cable.sag) > 0.5) moving = true;
			cable.path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${from.y + cable.sag} ${to.x} ${to.y + cable.sag} ${to.x} ${to.y}`);
			[from, to].forEach((point, i) => {
				cable.plugs[i].setAttribute('cx', String(point.x));
				cable.plugs[i].setAttribute('cy', String(point.y));
			});
			if (cable.text) {
				// Near the end it plugs into, at t = 0.85 of the curve. At the middle the labels of
				// cables from one jack lie on top of each other.
				const t = 0.85;
				const u = 1 - t;
				const bezier = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
				cable.text.setAttribute('x', String(bezier(from.x, from.x, to.x, to.x) - 8));
				cable.text.setAttribute('y', String(bezier(from.y, from.y + cable.sag, to.y + cable.sag, to.y) + 14));
			}
		}
		this.restFrames = moving ? 0 : this.restFrames + 1;
		this.frame = this.restFrames < REST_FRAMES ? requestAnimationFrame((next) => this.step(next)) : 0;
	}
}
