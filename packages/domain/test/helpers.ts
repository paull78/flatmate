import { OPENING_KINDS, defaultSides, defaultSize, kindOf, type OrCeiling, type Side, type Sides } from "../src/kinds";
import { FLOOR_BASE, emptyDocument, guardFor, type Deck, type Document, type Opening, type Wall, sameGuards } from "../src/model";
import { defaultOpeningHeights, wallRange } from "../src/queries/vertical";
import { nullZones, withZoneExtent, type ZoneExtent, type ZoneExtents } from "../src/use-zone";

export type Spec = {
  joints?: [id: string, x: number, y: number][];
  walls?: [id: string, a: string, b: string, thickness?: number][];
  labels?: [id: string, x: number, y: number, name: string][];
  /** Column rows: a column from joint a to joint b (its width) with this depth (its thickness). */
  columns?: [id: string, a: string, b: string, depth: number][];
};

/** A floor-based wall row to the ceiling, or a column row when `column` is set. */
export function wallRow(id: string, a: string, b: string, thickness = 0.2, column = false): Wall {
  return { id, a, b, thickness, top: "ceiling", base: FLOOR_BASE, column };
}

/** Builds a document from compact tuples; no validation. */
export function docOf(spec: Spec): Document {
  const doc: Document = emptyDocument();
  for (const [id, x, y] of spec.joints ?? []) doc.joints[id] = { id, x, y };
  for (const [id, a, b, thickness = 0.2] of spec.walls ?? []) doc.walls[id] = wallRow(id, a, b, thickness);
  for (const [id, a, b, depth] of spec.columns ?? []) doc.walls[id] = wallRow(id, a, b, depth, true);
  for (const [id, x, y, name] of spec.labels ?? []) doc.zoneLabels[id] = { id, at: { x, y }, name, finish: null };
  return doc;
}

/** A closed rectangle J1(x0,y0) J2(x1,y0) J3(x1,y1) J4(x0,y1), walls W1..W4 counter-clockwise. */
export function rectDoc(x0: number, y0: number, x1: number, y1: number): Document {
  return docOf({
    joints: [["J1", x0, y0], ["J2", x1, y0], ["J3", x1, y1], ["J4", x0, y1]],
    walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
  });
}

/**
 * A closed rectangle as tuples for `docOf`: joints `${p}j1..${p}j4` at (x0,y0) (x1,y0) (x1,y1) (x0,y1), walls
 * `${p}1..${p}4` counter-clockwise. Combine several with `loops`.
 */
export function rectLoop(p: string, x0: number, y0: number, x1: number, y1: number, thickness = 0.2): Required<Pick<Spec, "joints" | "walls">> {
  const j = (n: number): string => `${p}j${n}`;
  return {
    joints: [[j(1), x0, y0], [j(2), x1, y0], [j(3), x1, y1], [j(4), x0, y1]],
    walls: [[`${p}1`, j(1), j(2), thickness], [`${p}2`, j(2), j(3), thickness], [`${p}3`, j(3), j(4), thickness], [`${p}4`, j(4), j(1), thickness]],
  };
}

/** The shared hole fixtures: apartment A (10 × 8 m), core C (3 × 3 m) in it, column K (0.6 × 0.6 m, 0.10 walls) in the core. */
export const A = rectLoop("A", 0, 0, 10, 8);
export const C = rectLoop("C", 3.5, 2.5, 6.5, 5.5);
export const K = rectLoop("K", 4.7, 3.7, 5.3, 4.3, 0.1);

/** A document of all the parts' joints, walls and labels together; no validation. */
export function loops(...parts: Spec[]): Document {
  return docOf({
    joints: parts.flatMap((s) => s.joints ?? []),
    walls: parts.flatMap((s) => s.walls ?? []),
    labels: parts.flatMap((s) => s.labels ?? []),
    columns: parts.flatMap((s) => s.columns ?? []),
  });
}

/** Freezes a value and everything reachable from it: any write then throws (modules run in strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    const children: unknown[] = Object.values(value);
    for (const child of children) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Sizes for `place`: a 1.60 × 2.00 bed, and a sofa bed 2.00 wide in both states. */
export const BED_160x200 = { w: { standard: 1.6 }, d: { standard: 2 } };
export const SOFA_BED_200 = { w: { sofa: 2, bed: 2 }, d: { sofa: 0.9, bed: 1.6 } };

/**
 * A copy of `doc` with an object placed in a state (s0 by default), creating the object and the state on first
 * use. Returns a new document: queries cache by document identity, so a document must not change once read.
 * The configuration defaults to the kind's first, the sides to the kind's, the size (on first use) to the kind's
 * default, the zones to all null (the kind's defaults) with `zones` laid over, the deck to null (the floor); the
 * placement ID defaults to `${object}/${state}`.
 */
export function place(
  input: Document,
  p: {
    object: string;
    kind: string;
    at: [x: number, y: number];
    state?: string;
    rotation?: number;
    config?: string;
    id?: string;
    sides?: Sides;
    zones?: Partial<ZoneExtents>;
    deck?: string | null;
    size?: { w: Record<string, number>; d: Record<string, number>; h?: Record<string, number>; z?: Record<string, OrCeiling> };
  },
): Document {
  const doc: Document = { ...input, states: { ...input.states }, objects: { ...input.objects }, placements: { ...input.placements } };
  const kind = kindOf(p.kind);
  const defaults = defaultSize(p.kind);
  const size = p.size && defaults ? { h: defaults.h, z: defaults.z, ...p.size } : defaults;
  const sides = p.sides ?? defaultSides(p.kind);
  if (!kind || !size || !sides) throw new Error(`unknown kind ${p.kind}`);
  const arms = kind.arms === null ? {} : { arms: { ...kind.arms } }; // an `L` kind's object stores its arms (catalog.17)
  if (!doc.objects[p.object]) doc.objects[p.object] = { id: p.object, kind: p.kind, name: kind.label, w: { ...size.w }, d: { ...size.d }, h: { ...size.h }, z: { ...size.z }, ...arms };
  const state = p.state ?? "s0";
  if (!doc.states[state]) doc.states[state] = { id: state, name: state, order: Object.keys(doc.states).length };
  const id = p.id ?? `${p.object}/${state}`;
  doc.placements[id] = {
    id, object: p.object, state, at: { x: p.at[0], y: p.at[1] }, rotation: p.rotation ?? 0, config: p.config ?? kind.configs[0]?.id ?? "standard",
    sides: { ...sides }, zones: { ...nullZones(), ...p.zones }, deck: p.deck ?? null,
  };
  return doc;
}

/** A copy of `doc` whose placement stores `extent` on `side` (null clears it); throws on an unknown placement. */
export function withStoredZone(doc: Document, placementId: string, side: Side, extent: ZoneExtent | null): Document {
  const p = doc.placements[placementId];
  if (!p) throw new Error(`unknown placement ${placementId}`);
  return { ...doc, placements: { ...doc.placements, [p.id]: { ...p, zones: withZoneExtent(p.zones, side, extent) } } };
}

/**
 * A copy of `doc` with an opening on a wall: a swing door, 0.80 m wide, opening to the left of a → b and hinged at
 * `a`, at the heights a new one takes on that wall (`defaultOpeningHeights`: a door 0 to 2.10, a window 0.90 to 2.10,
 * the head 0.10 under a lower wall's top), unless told otherwise. Returns a new document, like `place`.
 */
export function withOpening(input: Document, o: Partial<Opening> & { id: string; wall: string; offset: number }): Document {
  const kind = o.kind ?? "swing";
  const range = wallRange(input, o.wall);
  const opening: Opening = {
    kind, width: kind === "window" ? 1 : 0.8, side: "left", hinge: "a", glazed: false, ...defaultOpeningHeights(OPENING_KINDS[kind].fromFloor, range ? range.top - range.bottom : 2.5), ...o,
  };
  return { ...input, openings: { ...input.openings, [opening.id]: opening } };
}

/**
 * A copy of `doc` with a deck: a 2.00 × 1.40 solid Platform at 0.45, unrotated, named by its ID unless told
 * otherwise. Returns a new document, like `place`.
 */
export function withDeck(input: Document, d: Partial<Omit<Deck, "at">> & { id: string; at: [x: number, y: number] }): Document {
  const deck: Deck = { name: d.id, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards(guardFor(d.top ?? 0.45)), ...d, at: { x: d.at[0], y: d.at[1] } };
  return { ...input, decks: { ...input.decks, [deck.id]: deck } };
}

/**
 * The decks' tiny house (decks.20), no furniture: a 7 × 2.5 m shell of 0.20 walls (inner faces x 0.1 and 6.9, y 0.1
 * and 2.4) with a partition P from (2, 0) to (2, 2.5), 2.03 m high, closing the bathroom (x 0–2) off the main room;
 * the shell's bottom and top walls are split at the partition (W1a, W1b, W3a, W3b). Default 2.50 m ceiling.
 */
export function tinyHouse(): Document {
  const doc = docOf({
    joints: [["J1", 0, 0], ["Ja", 2, 0], ["J2", 7, 0], ["J3", 7, 2.5], ["Jb", 2, 2.5], ["J4", 0, 2.5]],
    walls: [["W1a", "J1", "Ja"], ["W1b", "Ja", "J2"], ["W2", "J2", "J3"], ["W3a", "J3", "Jb"], ["W3b", "Jb", "J4"], ["W4", "J4", "J1"], ["P", "Ja", "Jb"]],
  });
  const p = doc.walls.P;
  if (p) doc.walls.P = { ...p, top: 2.03 };
  return doc;
}

/**
 * A studio-like room (pillars): a 7 × 2.5 m shell of 0.20 walls W1..W4 (clear x 0.1–6.9, y 0.1–2.4), a 3.05 ceiling,
 * a hollow Loft "loft" at 2.15 over x 0.1–2.5, y 0.1–2.4 (underside 2.03), and a 1.40 × 2.00 mattress "mat" on it in
 * state s0 (x 0.4–1.8, y 0.4–2.4).
 */
export function loftStudio(): Document {
  const shell = rectDoc(0, 0, 7, 2.5);
  const doc = withDeck({ ...shell, ceilings: { ceiling: { id: "ceiling", height: 3.05 } } }, { id: "loft", name: "Loft", at: [1.3, 1.25], w: 2.4, d: 2.3, top: 2.15, solid: false });
  return place(doc, { object: "mat", kind: "mattress", at: [1.1, 2.4], deck: "loft", size: { w: { standard: 1.4 }, d: { standard: 2 } } });
}

/** An n × n grid of 1 m rooms, one label per room. */
export function grid(n: number): Document {
  const doc: Document = emptyDocument();
  const j = (x: number, y: number): string => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = wallRow(`h${x}_${y}`, j(x, y), j(x + 1, y));
      if (y < n) doc.walls[`v${x}_${y}`] = wallRow(`v${x}_${y}`, j(x, y), j(x, y + 1));
      if (x < n && y < n) doc.zoneLabels[`l${x}_${y}`] = { id: `l${x}_${y}`, at: { x: x + 0.5, y: y + 0.5 }, name: "Room", finish: null };
    }
  }
  return doc;
}

/** A small deterministic generator (mulberry32), so a failure reproduces from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
