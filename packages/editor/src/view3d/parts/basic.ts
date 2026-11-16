import { box, capped, countOf, spans } from "./sizes";
import { boxOf, type AppearanceTable, type Panel, type Part } from "./types";

// The custom boxes stay plain boxes in today's grey-white (parts.05); the plant and the radiator as in `view/symbols/basic.ts`;
// a rug is one thin slab of its drawn shape (spec "New kinds").

/**
 * A plant's crown (hangings.06): each layer's half width as a share of the piece's, bottom up, and its share of the
 * crown's height; `null` is the piece's own drawn ring, the widest layer, which fills the box without leaving the ring
 * (a 12-sided cylinder that wide would, parts.12). `trunk`: a palm's share of the crown under a thin trunk.
 *
 *    plant      palm        fern       rosette
 *     ▄▄         ▄▄▄
 *    ████     ▀▀▀▀▀▀▀▀▀      ▄▄
 *   ██████        █         ████        ▄▄▄▄
 *    ████         █       ████████    ████████
 *     ▀▀         ▄█▄        ▄█▄         ▄█▄
 */
type Crown = { layers: readonly [r: number | null, share: number][]; trunk?: number };
const CROWNS: Readonly<Record<"plant" | "palm" | "fern" | "rosette", Crown>> = {
  plant: { layers: [[0.55, 0.15], [0.8, 0.2], [null, 0.25], [0.75, 0.2], [0.45, 0.2]] },
  palm: { trunk: 0.55, layers: [[0.6, 0.2], [null, 0.25], [0.7, 0.25], [0.35, 0.3]] },
  fern: { layers: [[0.8, 0.2], [null, 0.3], [0.7, 0.25], [0.4, 0.25]] },
  rosette: { layers: [[0.7, 0.15], [null, 0.3], [0.7, 0.3], [0.35, 0.25]] },
};

/** A plant: a ceramic pot in two steps, the lower narrower, under its crown's stacked layers. */
function plant(crown: Crown, w: number, d: number, h: number): Part[] {
  const potTop = capped(0.3, 0.3, h);
  const cyl = (rx: number, ry: number, z0: number, z1: number, slot: Part["slot"]): Part => ({ shape: "cylinder", at: { x0: -rx, x1: rx, y0: -ry, y1: ry, z0, z1 }, slot });
  const pot = [cyl(0.24 * w, 0.24 * d, 0, potTop * 0.45, "ceramic"), cyl(0.3 * w, 0.3 * d, potTop * 0.45, potTop, "ceramic")];
  const trunkTop = potTop + (h - potTop) * (crown.trunk ?? 0);
  const trunk = crown.trunk === undefined ? [] : [cyl(0.04 * w, 0.04 * d, potTop, trunkTop, "wood")];
  const span = h - trunkTop;
  let z = trunkTop;
  const layers = crown.layers.map(([r, share], i): Part => {
    const z0 = z;
    z = i === crown.layers.length - 1 ? h : z + span * share; // the last ends at the top exactly
    return r === null ? { shape: "outline", z0, z1: z, slot: "fabric" } : cyl((r * w) / 2, (r * d) / 2, z0, z, "fabric");
  });
  return [...pot, ...trunk, ...layers];
}

/**
 * A radiator (hangings, the user's review): slim flat panels side by side at the front with narrow gaps, standing off
 * the wall on two rails and two brackets, pipe connectors at its left end, top and bottom, and two valves under it.
 *
 *   ▪┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐      panels about 7 cm wide (at most MAX_PANELS: the face cap)
 *    ││││││││││││││││
 *   ▪└┘└┘└┘└┘└┘└┘└┘└┘
 *     ▫             ▫     valves
 */
const MAX_PANELS = 16;
function radiator(w: number, d: number, h: number): Part[] {
  const conn = capped(0.035, 0.08, w); // the connectors' width at the left end
  const valve = capped(0.03, 0.08, h); // the valves' height under the panels
  const front = capped(0.025, 0.35, d); // the panels' depth
  const rail = -d / 2 + front + capped(0.02, 0.25, d); // the rails' back face, where the brackets start
  const [x0, x1] = [-w / 2 + conn, w / 2];
  const n = Math.max(2, Math.min(MAX_PANELS, Math.round((x1 - x0) / 0.075)));
  const gap = capped(0.006, 0.1, (x1 - x0) / n);
  const panels = spans(x0, x1, n).map(([a, b], i): Part => box("laminate", i === 0 ? a : a + gap / 2, i === n - 1 ? b : b - gap / 2, -d / 2, -d / 2 + front, valve, h));
  const railH = capped(0.03, 0.08, h);
  const [top, bottom] = [h - 0.12 * (h - valve) - railH, valve + 0.12 * (h - valve)];
  const rails = [top, bottom].map((z0): Part => box("laminate", x0, x1, -d / 2 + front, rail, z0, z0 + railH));
  const connectors = [top, bottom].map((z0): Part => box("laminate", -w / 2, x0, -d / 2 + 0.2 * front, rail, z0, z0 + railH));
  const bw = capped(0.03, 0.05, w);
  const brackets = [x0 + 0.15 * (x1 - x0), x1 - 0.15 * (x1 - x0) - bw].map((a): Part => box("metal", a, a + bw, rail, d / 2, top, top + railH));
  const vw = capped(0.02, 0.05, w);
  const valves = [x0 + 0.06 * (x1 - x0), x1 - 0.06 * (x1 - x0) - vw].map((a): Part => box("metal", a, a + vw, -d / 2 + 0.3 * front, -d / 2 + front, 0, valve));
  return [...panels, ...rails, ...connectors, ...brackets, ...valves];
}

/**
 * A wood stove (pieces.07): a stone hearth across its footprint, the dark stove toward its back, and, when its item gives
 * one, the dark flue from the stove's top up to `flue` (pieces.08), above the box: drawn, never fitted.
 */
function woodStove(w: number, d: number, h: number, flue?: number): Part[] {
  const m = Math.min(w, d);
  const [s, back] = [0.53 * m, 0.107 * m];
  const hearth = capped(0.02, 0.1, h);
  const [y1, y0] = [d / 2 - back, d / 2 - back - s];
  const pipe = Math.min(0.15, 0.4 * s);
  const fy = d / 2 - back - 0.3 * s;
  const parts: Part[] = [box("ceramic", -w / 2, w / 2, -d / 2, d / 2, 0, hearth), box("dark", -s / 2, s / 2, y0, y1, hearth, h)];
  if (flue === undefined || flue <= h + 0.01) return parts;
  return [...parts, { shape: "cylinder", at: { x0: -pipe / 2, x1: pipe / 2, y0: fy - pipe / 2, y1: fy + pipe / 2, z0: h, z1: flue }, slot: "dark" }];
}

/** A wall unit (pieces.07): a white body with a dark vent along the bottom of its front. */
function wallUnit(w: number, d: number, h: number): Part[] {
  const t = capped(0.01, 0.1, d);
  const vent = capped(0.06, 0.25, h);
  return [
    box("dark", -w / 2, w / 2, -d / 2, -d / 2 + t, 0, vent),
    box("laminate", -w / 2, w / 2, -d / 2, -d / 2 + t, vent, h),
    box("laminate", -w / 2, w / 2, -d / 2 + t, d / 2, 0, h),
  ];
}

/** A flame tongue's steps: from and to, as shares of its height, and its half width as a share of its slot's. */
const TAPER: readonly (readonly [number, number, number])[] = [[0, 0.4, 1], [0.4, 0.7, 0.7], [0.7, 0.9, 0.45], [0.9, 1, 0.2]];
/** The flame tongues' heights, as shares of the window over the embers, in turn: uneven, as a fire is. */
const TONGUES = [0.55, 0.85, 0.65, 1, 0.7, 0.9, 0.6, 0.8];

/**
 * An electric fireplace (pieces.07, .20): a dark body behind a dark front whose window shows a glowing ember strip and,
 * rising from it, flame tongues of uneven height, one per about 0.15 m: each tapers in four steps to a point.
 */
function electricFireplace(w: number, d: number, h: number): Part[] {
  const t = capped(0.02, 0.15, d);
  const [mx, mz] = [capped(0.05, 0.1, w), capped(0.06, 0.15, h)];
  const [x0, x1, z0, z1] = [-w / 2 + mx, w / 2 - mx, mz, h - mz];
  const ember = capped(0.04, 0.2, z1 - z0);
  const room = z1 - z0 - ember;
  const face = (slot: "flame" | "linen", cx: number, half: number, za: number, zb: number): Panel => ({ normal: "-y", at: { x0: cx - half, x1: cx + half, y0: -d / 2, y1: -d / 2, z0: za, z1: zb }, slot });
  const base = z0 + ember;
  const tongues = spans(x0, x1, countOf(x1 - x0, 0.15, 3)).flatMap(([a, b], i): Panel[] => {
    const [cx, half] = [(a + b) / 2, (b - a) / 2];
    const tall = room * (TONGUES[i % TONGUES.length] ?? 1);
    return TAPER.map(([from, to, share]) => face("flame", cx, share * half, base + from * tall, base + to * tall));
  });
  return [box("dark", -w / 2, w / 2, -d / 2 + t, d / 2, 0, h), box("dark", -w / 2, w / 2, -d / 2, -d / 2 + t, 0, h, [face("linen", (x0 + x1) / 2, (x1 - x0) / 2, z0, base), ...tongues])];
}

export const BASIC: AppearanceTable = new Map([
  ["block", boxOf("plain")],
  ["roundBlock", boxOf("plain")],
  ["cornerBlock", boxOf("plain")],
  ["plant", (_c, w, d, h) => plant(CROWNS.plant, w, d, h)],
  ["palm", (_c, w, d, h) => plant(CROWNS.palm, w, d, h)],
  ["fern", (_c, w, d, h) => plant(CROWNS.fern, w, d, h)],
  ["rosette", (_c, w, d, h) => plant(CROWNS.rosette, w, d, h)],
  ["radiator", (_c, w, d, h) => radiator(w, d, h)],
  ["woodStove", (_c, w, d, h, _options, _arms, flue) => woodStove(w, d, h, flue)],
  ["wallUnit", (_c, w, d, h) => wallUnit(w, d, h)],
  ["electricFireplace", (_c, w, d, h) => electricFireplace(w, d, h)],
  ["wheelWell", boxOf("plain")], // a boxed-in well, plain as a custom block (trailer.11)
  ["beam", boxOf("wood")], // a timber beam (beams.08)
  ["rug", boxOf("linen")],
  ["roundRug", boxOf("linen")],
]);
