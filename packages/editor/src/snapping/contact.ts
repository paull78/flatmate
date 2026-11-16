import { add, anchorAt, anchorAtMm, deckViews, dot, footprintQuad, isBeam, normalize, outlineOf, perpLeft, scale, stairRuleOf, sub, wallBodies, type Document, type Level } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { cornerTurn, isCornerKind } from "./corner";
import { wallSeenAt } from "./near-walls";
import { pieceFit, type Piece } from "./piece";
import { tuckPlace } from "./tuck";

// Contact plus fit (furnish.16): where a w × d piece lands near walls while it is placed, dragged or carried as a
// duplicate's ghost. One stateless call per move, always from the gesture's start angle, so the ghost and the click
// agree (ux-polish.16). The turn keeps the centre; the anchor is the back edge's middle (layout-states.49).
//
//   a beam ──► never turns: a long side square on a wall face, or a loft's edge from under it, slides flush (beams.19)
//   a seat's front at a sit-at piece ──► square to its edge, fully tucked (snapping/tuck.ts)    taken if it fits
//   back within tol of a face ──► straighten to it, slide flush (and into a corner)          always taken
//     (an `ell` piece's left side too: both are outer sides, catalog.42)
//   other side within tol     ──► turn that side to the back, flush, corner, then pieceFit     taken if it fits
//   nothing taken             ──► the start angle, the centre's anchor to the millimetre

type Side = "front" | "back" | "left" | "right";
const SIDES: readonly Side[] = ["back", "front", "left", "right"];
const TIE = 1e-9;

/**
 * A long face of a wall body: from `p` along unit `dir` for `len`, its unit normal `n` pointing away from the body. A
 * deck's edge is one too for a stair (`wallId` empty, stairs.10).
 */
type WallFace = { wallId: string; p: Point; dir: Point; n: Point; len: number };
/** A face within the tolerance of a footprint: its nearest corner's signed `gap` and the footprint side facing it. */
type Contact = { face: WallFace; order: number; gap: number; side: Side };
/** `held`: the tuck snap, or a beam's snap to a slab edge, took it, so no guide may move it (alignAfterContact). */
type Placed = { at: Point; rotation: number; flushWalls: readonly string[]; held?: true };

/** Whole degrees in [0, 360); `+ 0` turns −0 into 0. */
const norm = (r: number): number => (((Math.round(r) % 360) + 360) % 360) + 0;

/**
 * The two long faces of every wall body `level` sees (above an upper level, levels.19), by wall id then face (b0→b1
 * first); end caps don't count.
 */
function wallFaces(doc: Document, level: Level): WallFace[] {
  const out: WallFace[] = [];
  const bodies = [...wallBodies(doc)].filter(([id]) => wallSeenAt(doc, id, level)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [wallId, [b0, b1, b2, b3]] of bodies) {
    if (!b0 || !b1 || !b2 || !b3) continue;
    for (const [p, q, other] of [[b0, b1, b3], [b2, b3, b1]]) {
      if (!p || !q || !other) continue;
      const dir = normalize(sub(q, p));
      if (!dir) continue;
      const left = perpLeft(dir);
      out.push({ wallId, p, dir, n: dot(sub(other, p), left) < 0 ? left : scale(left, -1), len: dot(sub(q, p), dir) });
    }
  }
  return out;
}

/**
 * Every deck's slab edges as faces whose normals point away from the slab (stairwell.17), so a stair's back snaps flush
 * to an edge, a hole's side included, as to a wall (stairs.10); a notch's open side is no face. The domain owns the
 * edges (`deckViews`), with the slab on their left, so the normal is the edge's right. A piece standing on the deck has
 * its centre on the slab, so never meets them.
 */
function deckEdgeFaces(doc: Document): WallFace[] {
  return deckViews(doc).flatMap((deck) => deck.edges.flatMap(({ a, b }): WallFace[] => {
    const dir = normalize(sub(b, a));
    if (!dir) return [];
    return [{ wallId: "", p: a, dir, n: scale(perpLeft(dir), -1), len: dot(sub(b, a), dir) }];
  }));
}

/**
 * A beam's slab edges (beams.19): every hollow deck's edges, a hole's sides included, with normals into the slab (on the
 * edge's left), so a beam under the slab slides its side onto the edge from below.
 */
function underSlabFaces(doc: Document): WallFace[] {
  return deckViews(doc).filter((deck) => !deck.solid).flatMap((deck) => deck.edges.flatMap(({ a, b }): WallFace[] => {
    const dir = normalize(sub(b, a));
    if (!dir) return [];
    return [{ wallId: "", p: a, dir, n: perpLeft(dir), len: dot(sub(b, a), dir) }];
  }));
}

/** The outward normal of `side` of a footprint at rotation `r` (its front faces (sin r, −cos r)). */
function sideNormal(side: Side, r: number): Point {
  const c = Math.cos((r * Math.PI) / 180);
  const s = Math.sin((r * Math.PI) / 180);
  switch (side) {
    case "front":
      return { x: s, y: -c };
    case "back":
      return { x: -s, y: c };
    case "right":
      return { x: c, y: s };
    case "left":
      return { x: -c, y: -s };
    default:
      return assertNever(side);
  }
}

const quadAt = (centre: Point, w: number, d: number, r: number): Point[] => footprintQuad(anchorAt(centre, d, r), w, d, r);

/** The signed distance of the quad's nearest corner to face `f`: negative when a corner is across it. */
const gapTo = (quad: readonly Point[], f: WallFace): number => Math.min(...quad.map((c) => dot(sub(c, f.p), f.n)));

/**
 * The faces within `tol` of `quad` (centred on `centre`, at rotation `r`): the centre on the face's room side, the quad
 * overlapping the face's span, its nearest corner at most `tol` on either side of the face.
 */
function contactsOf(faces: readonly WallFace[], quad: readonly Point[], centre: Point, r: number, tol: number): Contact[] {
  const out: Contact[] = [];
  faces.forEach((face, order) => {
    if (dot(sub(centre, face.p), face.n) <= 0) return;
    const ts = quad.map((c) => dot(sub(c, face.p), face.dir));
    if (Math.min(Math.max(...ts), face.len) - Math.max(Math.min(...ts), 0) <= TIE) return;
    const gap = gapTo(quad, face);
    if (Math.abs(gap) > tol + TIE) return;
    const into = scale(face.n, -1);
    let side: Side = "back";
    let best = -Infinity;
    for (const s of SIDES) {
      const v = dot(sideNormal(s, r), into);
      if (v > best + TIE) [side, best] = [s, v];
    }
    out.push({ face, order, gap, side });
  });
  return out;
}

/** The rotation whose back faces `f` (its back normal (−sin r, cos r) along −n), in whole degrees. */
const backTo = (f: WallFace): number => norm((Math.atan2(f.n.x, -f.n.y) * 180) / Math.PI);
/** The turn from `start` to `r`, folded to [−180, 180). */
const turn = (r: number, start: number): number => ((((r - start) % 360) + 540) % 360) - 180;
/** Flush lands on an axis face exactly; on a slanted one 1 mm off, so the millimetre anchor never ends inside it (direct.19). */
const flushTarget = (f: WallFace): number => (Math.abs(f.n.x) < TIE || Math.abs(f.n.y) < TIE ? 0 : 0.001);

/** A side that only straightens when it touches: the back, and an `ell` piece's left side too (catalog.42). */
const holds = (side: Side, ell: boolean): boolean => side === "back" || (ell && side === "left");
/** The rotation that puts `side` on face `f` without turning the piece's sides: the back's, less 90° for the left. */
const sideTo = (side: Side, f: WallFace): number => norm(backTo(f) - (side === "left" ? 90 : 0));
/** The two sides square to `side`, whose faces slide the piece into a corner. */
const across = (side: Side): readonly Side[] => (side === "back" || side === "front" ? ["left", "right"] : ["back", "front"]);

/** Compares number keys in order with a TIE margin, then the faces' order. */
function byKeys(key: (c: Contact) => readonly number[]): (a: Contact, b: Contact) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (Math.abs(diff) > TIE) return diff;
    }
    return a.order - b.order;
  };
}

/**
 * Where a `size.w` × `size.d` piece centred on `centre` lands in `layout`, starting from `startRotation` (spec: layouts,
 * furnish.16). Wall faces within `opts.tolerance` of the footprint are taken in order: the one behind the back first,
 * then the smaller gap (a crossing counts as 0), the smaller turn, wall-ID order. Each turns the piece so the facing
 * side becomes its back (keeping the centre), slides it flush and, when a side square to it is within the tolerance
 * of a second face, along the first face into the corner. An `ell` piece's left side is a back too: it straightens and
 * slides flush, never turns (catalog.42). A back contact is taken as is; any other is taken only if
 * the final piece fits (piece.ts `pieceFit`: by its shape, on the surface it lands on with `opts.land`, decks.11). With
 * `opts.free` (Ctrl), or when nothing is taken, the piece keeps the start angle. `flushWalls` lists the walls it ended flush with. Then a
 * corner kind (`opts.kind`, outline quarter, corner or `ell`) left touching two faces at a right angle takes the corner turn
 * (snapping/corner.ts, furnish.18) if it fits; Ctrl skips it too. Before all of it a seat kind takes the tuck snap
 * (snapping/tuck.ts, seating.11) when it finds a fitting tucked place; Ctrl skips it. A beam takes none of it: its own
 * rule instead (`beamPlace`, beams.19).
 */
export function contactPlace(doc: Document, layout: string, size: { w: number; d: number }, centre: Point, startRotation: number,
  opts: { tolerance: number; free: boolean } & Piece): Placed {
  if (opts.free) return { at: anchorAtMm(centre, size.d, startRotation), rotation: norm(startRotation), flushWalls: [] };
  if (opts.kind !== undefined && isBeam(opts.kind)) return beamPlace(doc, size, centre, startRotation, opts);
  const tucked = tuckPlace(doc, layout, size, centre, startRotation, opts);
  if (tucked) return { ...tucked, flushWalls: [], held: true };
  const generic = touchToTurn(doc, layout, size, centre, startRotation, opts);
  if (opts.kind === undefined || !isCornerKind(opts.kind)) return generic;
  const fits = (at: Point, r: number): boolean => pieceFit(doc, layout, opts, size, at, r).fits;
  return cornerTurn(doc, size, generic, fits, opts.level) ?? generic;
}

/**
 * A beam's contact (beams.19): it keeps the start angle. Of the wall faces `opts.level` sees and the slab edges from
 * below (`underSlabFaces`), those within the tolerance that a long side (back or front) faces square on, with the centre
 * on their inner side, the nearest slides it flush, taken as is (a beam's fit skips walls, beams.05). Its ends take no
 * contact, so it runs into a wall unturned. On a slab edge it is `held`.
 */
function beamPlace(doc: Document, size: { w: number; d: number }, centre: Point, startRotation: number, opts: { tolerance: number } & Piece): Placed {
  const { w, d } = size;
  const start = norm(startRotation);
  const faces = [...wallFaces(doc, opts.level), ...underSlabFaces(doc)];
  const square = (c: Contact): boolean => (c.side === "back" && backTo(c.face) === start) || (c.side === "front" && norm(backTo(c.face) + 180) === start);
  const c = contactsOf(faces, quadAt(centre, w, d, startRotation), centre, startRotation, opts.tolerance).filter(square).sort(byKeys((x) => [Math.abs(x.gap)]))[0];
  if (!c) return { at: anchorAtMm(centre, d, startRotation), rotation: start, flushWalls: [] };
  const at = anchorAtMm(add(centre, scale(c.face.n, flushTarget(c.face) - c.gap)), d, start);
  return c.face.wallId === "" ? { at, rotation: start, flushWalls: [], held: true } : { at, rotation: start, flushWalls: [c.face.wallId] };
}

/** Touch to turn (furnish.16): `contactPlace` without Ctrl and before the corner turn. */
function touchToTurn(doc: Document, layout: string, size: { w: number; d: number }, centre: Point, startRotation: number,
  opts: { tolerance: number } & Piece): Placed {
  const { w, d } = size;
  const start = norm(startRotation);
  const keep: Placed = { at: anchorAtMm(centre, d, startRotation), rotation: start, flushWalls: [] };
  const faces = [...wallFaces(doc, opts.level), ...(opts.kind !== undefined && stairRuleOf(opts.kind) !== null ? deckEdgeFaces(doc) : [])];
  const ell = opts.kind !== undefined && outlineOf(opts.kind) === "ell";
  const rotationFor = (c: Contact): number => (holds(c.side, ell) ? sideTo(c.side, c.face) : backTo(c.face));
  const found = contactsOf(faces, quadAt(centre, w, d, startRotation), centre, startRotation, opts.tolerance)
    .sort(byKeys((c) => [holds(c.side, ell) ? 0 : 1, Math.max(c.gap, 0), Math.abs(turn(rotationFor(c), start))]));
  for (const c of found) {
    const r = rotationFor(c);
    const facing = holds(c.side, ell) ? c.side : "back";
    let at = add(centre, scale(c.face.n, flushTarget(c.face) - gapTo(quadAt(centre, w, d, r), c.face)));
    const flushWalls = c.face.wallId === "" ? [] : [c.face.wallId];
    const corner = contactsOf(faces, quadAt(at, w, d, r), at, r, opts.tolerance)
      .filter((x) => across(facing).includes(x.side) && x.face !== c.face)
      .sort(byKeys((x) => [Math.max(x.gap, 0)]))[0];
    const k = corner ? dot(c.face.dir, corner.face.n) : 0;
    if (corner && Math.abs(k) > TIE) {
      at = add(at, scale(c.face.dir, (flushTarget(corner.face) - corner.gap) / k));
      if (corner.face.wallId !== "") flushWalls.push(corner.face.wallId);
    }
    const anchor = anchorAtMm(at, d, r);
    if (!holds(c.side, ell) && !pieceFit(doc, layout, opts, size, anchor, r).fits) continue;
    return { at: anchor, rotation: r, flushWalls };
  }
  return keep;
}
