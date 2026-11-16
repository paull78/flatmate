import { convexIntersection, cornerRadius, shapeRing } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { cisternDepth, hasCistern, towelRailPost, vanityLayout } from "../../view/piece-counts";
import { box, capped } from "./sizes";
import type { AppearanceTable, Panel, Part } from "./types";

// The bathroom, as in `view/symbols/bathroom.ts`.

/** A pan cut across at `y` in the parts' frame, into what lies behind it (the back) or in front of it, both convex. */
function panSide(w: number, d: number, y: number, side: "back" | "front"): Point[] {
  const ring = shapeRing("pan", w, d).map((p) => ({ x: p.x, y: p.y + d / 2 }));
  const [y0, y1] = side === "back" ? [y, d / 2] : [-d / 2, y];
  return convexIntersection(ring, [{ x: -w, y: y0 }, { x: w, y: y0 }, { x: w, y: y1 }, { x: -w, y: y1 }]);
}

/**
 * A WC, on its pan (symbols.05): wall-hung, a bowl with a rim and a seat on it; from 0.60 m deep, a cistern at the back reaching the
 * top and a bowl in front to seat height, the same rule as the plan's band (`hasCistern`).
 */
function toilet(w: number, d: number, h: number): Part[] {
  if (!hasCistern(d)) {
    const rim = h - capped(0.03, 0.1, h);
    const [sx, sy] = [0.3 * w, 0.3 * d];
    const seat: Panel = { normal: "+z", at: { x0: -sx, x1: sx, y0: -0.04 * d - sy, y1: -0.04 * d + sy, z0: h, z1: h }, slot: "laminate" };
    return [{ shape: "outline", z0: 0, z1: rim, slot: "ceramic" }, { shape: "outline", z0: rim, z1: h, slot: "ceramic", panels: [seat] }];
  }
  const back = d / 2 - cisternDepth(d);
  const seatZ = capped(0.4, 0.5, h);
  const cy = (-d / 2 + back) / 2;
  const [sx, sy] = [0.3 * w, 0.3 * (back + d / 2)];
  const seat: Panel = { normal: "+z", at: { x0: -sx, x1: sx, y0: cy - sy, y1: cy + sy, z0: seatZ, z1: seatZ }, slot: "laminate" };
  return [
    { shape: "ring", ring: panSide(w, d, back, "back"), z0: 0, z1: h, slot: "ceramic" },
    { shape: "ring", ring: panSide(w, d, back, "front"), z0: 0, z1: seatZ, slot: "ceramic", panels: [seat] },
  ];
}

/**
 * A shower tray (parts.14): a ceramic tray, and a metal riser with its head on the back side. A thin metal frame
 * stands on the open sides, posts at the front corners and bars along the top of the front, left and right, with no
 * pane (no transparency yet, roadmap item 18), so the tray stays in view; the back is the wall's.
 */
function showerTray(w: number, d: number, h: number): Part[] {
  const trayH = capped(0.05, 0.1, h);
  const r = capped(0.025, 0.1, Math.min(w, d));
  const headT = capped(0.03, 0.05, h);
  const headD = capped(0.2, 0.3, d);
  const headW = capped(0.15, 0.3, w);
  const s = capped(0.025, 0.05, Math.min(w, d)); // the frame's section
  const barZ = h - capped(0.025, 0.05, h);
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -d / 2, d / 2];
  return [
    box("ceramic", x0, x1, y0, y1, 0, trayH),
    { shape: "cylinder", at: { x0: -r / 2, x1: r / 2, y0: y1 - r, y1, z0: trayH, z1: h - headT }, slot: "metal" },
    box("metal", -headW / 2, headW / 2, y1 - headD, y1, h - headT, h),
    box("metal", x0, x0 + s, y0, y0 + s, trayH, barZ),
    box("metal", x1 - s, x1, y0, y0 + s, trayH, barZ),
    box("metal", x0, x1, y0, y0 + s, barZ, h),
    box("metal", x0, x0 + s, y0 + s, y1, barZ, h),
    box("metal", x1 - s, x1, y0 + s, y1, barZ, h),
  ];
}

/** A bathtub: a ceramic rim around a lower floor, so it reads hollow from above. */
function bathtub(w: number, d: number, h: number): Part[] {
  const rim = capped(0.07, 0.2, Math.min(w, d));
  const floorTop = h - capped(0.4, 0.6, h);
  return [
    box("ceramic", -w / 2, w / 2, -d / 2, -d / 2 + rim, 0, h),
    box("ceramic", -w / 2, w / 2, d / 2 - rim, d / 2, 0, h),
    box("ceramic", -w / 2, -w / 2 + rim, -d / 2 + rim, d / 2 - rim, 0, h),
    box("ceramic", w / 2 - rim, w / 2, -d / 2 + rim, d / 2 - rim, 0, h),
    box("ceramic", -w / 2 + rim, w / 2 - rim, -d / 2 + rim, d / 2 - rim, 0, floorTop),
  ];
}

/** A machine in a washing machine's height: its range and its control strip's height. */
export type Machine = { z0: number; z1: number; strip: number };
/** Above this height a washing machine is a washer under a dryer (its Washer-dryer preset, 1.70). */
const STACK_FROM = 1.3;

/**
 * Where a washing machine's machines sit (hangings, the user's review): one from 0 to `h`, or, from STACK_FROM up, a
 * washer and a dryer either side of a thin stacking strip at the middle. The parts and the round doors (`washerFaces`)
 * both read it.
 */
export function washerMachines(h: number): { machines: Machine[]; kit: [number, number] | null } {
  const strip = (m: number): number => capped(0.1, 0.15, m);
  if (h < STACK_FROM) return { machines: [{ z0: 0, z1: h, strip: strip(h) }], kit: null };
  const g = capped(0.02, 0.02, h);
  const [a, b] = [h / 2 - g / 2, h / 2 + g / 2];
  return { machines: [{ z0: 0, z1: a, strip: strip(a) }, { z0: b, z1: h, strip: strip(h - b) }], kit: [a, b] };
}

/**
 * A washing machine (hangings): per machine a white body, its front set 3 mm back under a control strip flush with
 * the front, and on the strip a drawer, a dial and a dark display; a stack's dark stacking strip between its two.
 * The round doors are faces of their own (`appliance-faces.ts`): no prism makes a disc facing the room.
 *
 *   ┌───────────────┐
 *   │▭▭▭▭  ▪  ▬▬▬▬ │  drawer, dial, display
 *   ├───────────────┤
 *   │     ╭───╮     │
 *   │    │ ● │     │  door (faces)
 *   │     ╰───╯     │
 *   └───────────────┘
 */
function washingMachine(w: number, d: number, h: number): Part[] {
  const t = capped(0.03, 0.1, d);
  const recess = capped(0.003, 0.05, t);
  const { machines, kit } = washerMachines(h);
  const machine = ({ z0, z1, strip }: Machine): Part[] => {
    const top = z1 - strip;
    const panel = (slot: Panel["slot"], x0: number, x1: number, lo: number, hi: number): Panel => ({ normal: "-y", at: { x0: x0 * w, x1: x1 * w, y0: -d / 2, y1: -d / 2, z0: top + lo * strip, z1: top + hi * strip }, slot });
    return [
      box("laminate", -w / 2, w / 2, -d / 2 + t, d / 2, z0, z1),
      box("laminate", -w / 2, w / 2, -d / 2, -d / 2 + t, top, z1, [panel("plain", -0.44, -0.14, 0.3, 0.75), panel("metal", -0.05, 0.05, 0.25, 0.8), panel("dark", 0.14, 0.42, 0.35, 0.7)]),
      box("laminate", -w / 2, w / 2, -d / 2 + recess, -d / 2 + t, z0, top),
    ];
  };
  return [...machines.flatMap(machine), ...(kit ? [box("dark", -w / 2, w / 2, -d / 2 + recess, d / 2, kit[0], kit[1])] : [])];
}

/**
 * A metal tap from `z0` to exactly `h` (the fill property wants a part at the top, and no part may leave the range): a
 * neck of radius `r` at `from`, and a spout at the top reaching over the bowl to `to`.
 */
function tap(from: Point, to: Point, r: number, z0: number, h: number): Part[] {
  const spoutZ = h - capped(0.02, 0.25, h - z0);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const [nx, ny] = [(-(to.y - from.y) / len) * r * 0.7, ((to.x - from.x) / len) * r * 0.7];
  return [
    { shape: "cylinder", at: { x0: from.x - r, x1: from.x + r, y0: from.y - r, y1: from.y + r, z0, z1: spoutZ }, slot: "metal" },
    {
      shape: "ring",
      ring: [{ x: from.x + nx, y: from.y + ny }, { x: from.x - nx, y: from.y - ny }, { x: to.x - nx, y: to.y - ny }, { x: to.x + nx, y: to.y + ny }],
      z0: spoutZ,
      z1: h,
      slot: "metal",
    },
  ];
}

/** A basin's levels: the rim at about 0.85 m and the pedestal's top a bowl's depth under it. */
const basinLevels = (h: number): { pedestalTop: number; rim: number } => {
  const rim = capped(0.85, 0.81, h);
  return { pedestalTop: rim - capped(0.17, 0.16, h), rim };
};

/** A washbasin on its soft ring: a pedestal, a solid bowl with a metal panel as the sink's, a rim round it, wider at the back for the tap, its four strips stopping short of the rounded corners (symbols.05). */
function washbasin(w: number, d: number, h: number): Part[] {
  const { pedestalTop, rim } = basinLevels(h);
  const lip = rim - capped(0.02, 0.02, h);
  const side = capped(0.04, 0.12, Math.min(w, d));
  const ledge = capped(0.1, 0.25, d);
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -d / 2, d / 2];
  const pr = capped(0.09, 0.2, Math.min(w, d));
  const r = capped(0.015, 0.05, Math.min(w, d));
  const round = cornerRadius(w, d);
  const tapY = y1 - ledge / 2;
  const bowl: Panel = { normal: "+z", at: { x0: x0 + side, x1: x1 - side, y0: y0 + side, y1: y1 - ledge, z0: lip, z1: lip }, slot: "metal" };
  return [
    { shape: "cylinder", at: { x0: -pr, x1: pr, y0: -pr, y1: pr, z0: 0, z1: pedestalTop }, slot: "ceramic" },
    { shape: "outline", z0: pedestalTop, z1: lip, slot: "ceramic", panels: [bowl] },
    box("ceramic", x0 + round, x1 - round, y0, y0 + side, lip, rim),
    box("ceramic", x0 + round, x1 - round, y1 - ledge, y1, lip, rim),
    box("ceramic", x0, x0 + side, y0 + round, y1 - round, lip, rim),
    box("ceramic", x1 - side, x1, y0 + round, y1 - round, lip, rim),
    ...tap({ x: 0, y: tapY }, { x: 0, y: y1 - ledge - capped(0.04, 0.1, d) }, r, rim, h),
  ];
}

/** A vanity unit: a wood cabinet to the washbasin's rim, a ceramic top with a metal bowl panel per basin and a metal tap behind each. */
function vanityUnit(w: number, d: number, h: number): Part[] {
  const { rim } = basinLevels(h);
  const top = rim - capped(0.04, 0.05, h);
  const { xs, width, margin, ledge } = vanityLayout(w, d);
  const halfWidth = width / 2;
  const r = capped(0.015, 0.05, Math.min(w, d));
  const [front, back] = [-d / 2 + margin, d / 2 - ledge];
  const bowls = xs.map((x): Panel => ({ normal: "+z", at: { x0: x - halfWidth, x1: x + halfWidth, y0: front, y1: back, z0: rim, z1: rim }, slot: "metal" }));
  return [
    box("wood", -w / 2, w / 2, -d / 2, d / 2, 0, top),
    box("ceramic", -w / 2, w / 2, -d / 2, d / 2, top, rim, bowls),
    ...xs.flatMap((x) => tap({ x, y: d / 2 - ledge / 2 }, { x, y: back - capped(0.04, 0.1, d) }, r, rim, h)),
  ];
}

/**
 * A corner basin: the washbasin on its triangle, with the bowl a square panel round the plan's (`cornerBasin` in the
 * symbols: the triangle's incircle, r, with the bowl at 0.7 r), which stays inside at any size. A rim strip's box would
 * cover the piece, so the rim is what the panel leaves. The tap stands in the back corner, clear of the panel.
 */
function cornerBasin(w: number, d: number, h: number): Part[] {
  const { pedestalTop, rim } = basinLevels(h);
  const r = (w + d - Math.hypot(w, d)) / 2;
  const at = (u: number, v: number): Point => ({ x: -w / 2 + u, y: d / 2 - v }); // from the back-left corner
  const c = at(r, r);
  const s = 0.7 * r;
  const pr = capped(0.07, 0.7, r);
  const bowl: Panel = { normal: "+z", at: { x0: c.x - s, x1: c.x + s, y0: c.y - s, y1: c.y + s, z0: rim, z1: rim }, slot: "metal" };
  return [
    { shape: "cylinder", at: { x0: c.x - pr, x1: c.x + pr, y0: c.y - pr, y1: c.y + pr, z0: 0, z1: pedestalTop }, slot: "ceramic" },
    { shape: "outline", z0: pedestalTop, z1: rim, slot: "ceramic", panels: [bowl] },
    ...tap(at(0.15 * r, 0.15 * r), at(0.75 * r, 0.75 * r), capped(0.015, 0.12, r), rim, h),
  ];
}

/** A bidet: a bowl on its pan on a narrower foot, or it reads as a drum; no cistern, a metal panel in the bowl, a tap at its back (as the plan's). */
function bidet(w: number, d: number, h: number): Part[] {
  const top = capped(0.4, 0.73, h);
  const bowlZ = top - capped(0.14, 0.35, top);
  const r = capped(0.015, 0.05, Math.min(w, d));
  const inner: Panel = { normal: "+z", at: { x0: -0.22 * w, x1: 0.22 * w, y0: -0.28 * d, y1: 0.14 * d, z0: top, z1: top }, slot: "metal" };
  return [
    { shape: "cylinder", at: { x0: -0.33 * w, x1: 0.33 * w, y0: -0.33 * d, y1: 0.33 * d, z0: 0, z1: bowlZ }, slot: "ceramic" },
    { shape: "outline", z0: bowlZ, z1: top, slot: "ceramic", panels: [inner] },
    ...tap({ x: 0, y: 0.34 * d }, { x: 0, y: 0.2 * d }, r, top, h),
  ];
}

/**
 * A corner shower: a tray on its quarter outline, a metal riser with its head on the back side, and a thin metal frame
 * along the curve, no pane, as the shower tray (parts.14). A box would leave the curve, so the frame's bars and posts are
 * rings built from the outline's own chords: the outer edge on them, the inner on the same ellipse less the frame's section.
 */
function cornerShower(w: number, d: number, h: number): Part[] {
  const trayH = capped(0.05, 0.1, h);
  const s = capped(0.025, 0.05, Math.min(w, d)); // the frame's section
  const barZ = h - capped(0.025, 0.05, h);
  const r = capped(0.025, 0.1, Math.min(w, d));
  const headT = capped(0.03, 0.05, h);
  const headD = capped(0.2, 0.3, d);
  const headW = capped(0.15, 0.3, w);
  const riserX = -w / 2 + 0.35 * w;
  const outer = shapeRing("quarter", w, d).slice(1).map((p): Point => ({ x: p.x, y: p.y + d / 2 })); // to the local frame
  const chords = outer.length - 1; // 8, within MAX_REPEAT
  const inward = (p: Point): Point => ({ x: -w / 2 + (p.x + w / 2) * (1 - s / w), y: d / 2 + (p.y - d / 2) * (1 - s / d) });
  /** The point a share `t` along chord `k`. */
  const along = (k: number, t: number): Point => {
    const [a = { x: 0, y: 0 }, b = a] = [outer[k], outer[k + 1]];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  /** The frame's band along chord `k`, from share `a` to share `b`. */
  const band = (k: number, a: number, b: number): Point[] => [along(k, a), along(k, b), inward(along(k, b)), inward(along(k, a))];
  /** A post's share of chord `k`: the frame's section. */
  const postShare = (k: number): number => Math.min(1, s / Math.hypot(along(k, 1).x - along(k, 0).x, along(k, 1).y - along(k, 0).y));
  const post = (k: number, a: number, b: number): Part => ({ shape: "ring", ring: band(k, a, b), z0: trayH, z1: barZ, slot: "metal" });
  return [
    { shape: "outline", z0: 0, z1: trayH, slot: "ceramic" },
    { shape: "cylinder", at: { x0: riserX - r / 2, x1: riserX + r / 2, y0: d / 2 - r, y1: d / 2, z0: trayH, z1: h - headT }, slot: "metal" },
    box("metal", riserX - headW / 2, riserX + headW / 2, d / 2 - headD, d / 2, h - headT, h),
    post(0, 0, postShare(0)),
    post(chords - 1, 1 - postShare(chords - 1), 1),
    ...Array.from({ length: chords }, (_, k): Part => ({ shape: "ring", ring: band(k, 0, 1), z0: barZ, z1: h, slot: "metal" })),
  ];
}

/**
 * A towel rail (catalog.23, hangings): a ladder at its front, two posts the full height at its ends and a bar between
 * them about every 10 cm (at most MAX_BARS: the face cap), and four brackets from the posts back to the wall.
 *
 *   front          side
 *   ┌┐▬▬▬▬▬▬▬▬┌┐    ┌┐━━ bracket
 *   ││▬▬▬▬▬▬▬▬││    ││
 *   ││  ...   ││    ││
 *   ││▬▬▬▬▬▬▬▬││    ││━━ bracket
 *   └┘        └┘    └┘
 */
const MAX_BARS = 14;
function towelRail(w: number, d: number, h: number): Part[] {
  const r = towelRailPost(w, d);
  const front = -d / 2 + 2 * r; // the posts' back face, where the brackets start
  const post = (x0: number): Part => ({ shape: "cylinder", at: { x0, x1: x0 + 2 * r, y0: -d / 2, y1: front, z0: 0, z1: h }, slot: "metal" });
  const [left, right] = [-w / 2 + 2 * r, w / 2 - 2 * r];
  const bar = capped(0.02, 0.05, h); // a bar's height and depth
  const n = Math.max(2, Math.min(MAX_BARS, Math.round(h / 0.1)));
  const step = (h - 3 * bar) / (n - 1); // the first bar one bar's height up, the last one bar's height under the top
  const bars = Array.from({ length: n }, (_, i): Part => {
    const z0 = bar + i * step;
    return box("metal", left, right, -d / 2 + r - bar / 2, -d / 2 + r + bar / 2, z0, z0 + bar);
  });
  const bracketZ = [capped(0.15, 0.12, h), h - capped(0.15, 0.12, h) - bar];
  const brackets = [-w / 2, right].flatMap((x0) => bracketZ.map((z0): Part => box("metal", x0, x0 + 2 * r, front, d / 2, z0, z0 + bar)));
  return [post(-w / 2), post(right), ...bars, ...brackets];
}

export const BATHROOM: AppearanceTable = new Map([
  ["toilet", (_c, w, d, h) => toilet(w, d, h)],
  ["bidet", (_c, w, d, h) => bidet(w, d, h)],
  ["washbasin", (_c, w, d, h) => washbasin(w, d, h)],
  ["vanityUnit", (_c, w, d, h) => vanityUnit(w, d, h)],
  ["cornerBasin", (_c, w, d, h) => cornerBasin(w, d, h)],
  ["showerTray", (_c, w, d, h) => showerTray(w, d, h)],
  ["cornerShower", (_c, w, d, h) => cornerShower(w, d, h)],
  ["bathtub", (_c, w, d, h) => bathtub(w, d, h)],
  ["washingMachine", (_c, w, d, h) => washingMachine(w, d, h)],
  ["towelRail", (_c, w, d, h) => towelRail(w, d, h)],
]);
