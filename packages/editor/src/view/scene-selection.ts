import { add, perpLeft, scale, sub, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { activeStateId, type EditorState } from "../state";
import { chipUnderPointer } from "../tools/hit-test";
import { COLORS } from "./colors";
import { handles } from "./handles";
import type { Primitive } from "./scene-types";
import { ZONE_CHIP_GLYPH_PX, ZONE_CHIP_INNER_PX, ZONE_CHIP_RADIUS_PX, zoneChips, zoneOutlines, type ZoneChip } from "./zone-chips";
import { CHROME_FONT } from "./fonts";

/**
 * The selected pieces' zone outlines (smart.09), the handles, then one piece's zone chips (smart.24). A joint handle
 * is a disc over a disc; a side grip is a square over a square, turned with its piece, an arm grip one filled square; the rotation grip is a circular
 * arrow (shapefit AC-01) on a white disc, which goes in `under` (the layer below) since a layer's discs are drawn
 * after its arcs; a zone handle is a 4 px blue ring (a white disc over a blue one); a chip is a ring disc, a fill disc
 * and its glyph. WebGL draws each layer by kind, so the marks go out in that order and both renderers stack them
 * alike: a zone outline lying on a side is drawn over that side's grip squares.
 */
export function drawSelection(state: EditorState, doc: Document, out: Primitive[], under: Primitive[]): void {
  const pieces = state.selection.filter((r) => r.table === "placements").map((r) => r.id);
  const marks = zoneOutlines(doc, pieces, activeStateId(state));
  for (const h of handles(state, doc)) {
    switch (h.kind) {
      case "joint":
        marks.push(...handle(h.at, h.fixed ? COLORS.handleFixed : COLORS.handle));
        break;
      case "sectionEnd":
        marks.push(...handle(h.at, COLORS.handle));
        break;
      case "side":
      case "deckSide":
      case "holeSide":
      case "areaSide":
      case "sectionFar":
        marks.push(square(h.at, h.normal, 5 / state.camera.zoom, COLORS.wallSelected), square(h.at, h.normal, 3.5 / state.camera.zoom, COLORS.handle));
        break;
      case "armGrip": // filled, apart from the hollow side grips (the approved mockup)
        marks.push(square(h.at, h.normal, 5 / state.camera.zoom, COLORS.wallSelected));
        break;
      case "rotate":
        under.push({ kind: "disc", center: h.at, radius: { px: 5 }, color: COLORS.handle });
        marks.push(...rotateArrow(h.at, state.camera.zoom));
        break;
      case "zoneDepth":
      case "zoneEnd":
        marks.push(
          { kind: "disc", center: h.at, radius: { px: 4 }, color: COLORS.chip },
          { kind: "disc", center: h.at, radius: { px: 2.5 }, color: COLORS.handle },
        );
        break;
      default:
        assertNever(h);
    }
  }
  const hot = chipUnderPointer(state, doc);
  for (const c of zoneChips(state, doc)) marks.push(...chip(c, hot?.placementId === c.placementId && hot.side === c.side));
  out.push(...byKind(marks));
}

/**
 * A grip-sized chip (furnish.09): "×" white on a blue disc; "+" light grey on a white disc with a light grey ring,
 * darker while the pointer is over it (`hot`).
 */
function chip(c: ZoneChip, hot: boolean): Primitive[] {
  const ring = c.on ? COLORS.chip : hot ? COLORS.chipOffHover : COLORS.chipOff;
  return [
    { kind: "disc", center: c.at, radius: { px: ZONE_CHIP_RADIUS_PX }, color: ring },
    { kind: "disc", center: c.at, radius: { px: ZONE_CHIP_INNER_PX }, color: c.on ? COLORS.chip : COLORS.handle },
    { kind: "text", text: c.on ? "×" : "+", at: c.at, size: ZONE_CHIP_GLYPH_PX, color: c.on ? COLORS.chipGlyph : ring, align: "center", rotation: 0, font: CHROME_FONT },
  ];
}

/** WebGL's kind order within a layer (polygon, segment, arc, disc), texts last; a stable sort keeps each kind's order. */
const KIND_RANK: Record<Primitive["kind"], number> = { polygon: 0, segment: 1, arc: 2, disc: 3, text: 4 };
function byKind(ps: readonly Primitive[]): Primitive[] {
  return [...ps].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

function handle(p: Point, inner: string): Primitive[] {
  return [
    { kind: "disc", center: p, radius: { px: 5 }, color: COLORS.wallSelected },
    { kind: "disc", center: p, radius: { px: 3.5 }, color: inner },
  ];
}

/**
 * The rotation grip's arrow: a 3 px open arc of 270°, counter-clockwise from the top round to the right, open
 * towards the upper right, and a filled arrowhead at its end pointing on along it (into the gap), about 3 px long.
 */
function rotateArrow(at: Point, zoom: number): Primitive[] {
  const to = 2 * Math.PI;
  const radial = { x: Math.cos(to), y: Math.sin(to) };
  const tangent = perpLeft(radial); // counter-clockwise, the way the arc runs
  const end = add(at, scale(radial, 3 / zoom));
  const base = sub(end, scale(tangent, 1 / zoom));
  const wing = scale(radial, 1.75 / zoom);
  return [
    { kind: "arc", center: at, radius: 3 / zoom, from: Math.PI / 2, to, width: { px: 1.5 }, color: COLORS.wallSelected },
    { kind: "polygon", points: [add(end, scale(tangent, 2 / zoom)), add(base, wing), sub(base, wing)], holes: [], color: COLORS.wallSelected },
  ];
}

/** A square of half-side `half` (metres) centred on `at`, its sides along `normal` and across it. */
function square(at: Point, normal: Point, half: number, color: string): Primitive {
  const n = scale(normal, half);
  const t = perpLeft(n);
  return { kind: "polygon", points: [add(at, add(n, t)), add(at, sub(t, n)), sub(at, add(n, t)), add(at, sub(n, t))], holes: [], color };
}
