import { ceilingHeight, distance, highSide, roofBox, roofOf, roofPlanes, sectionLabel, shown, signedArea, type Document, type Section } from "@fm/domain";
import type { Bounds } from "../view/picture";
import type { PlanStyle } from "../view/plan-style";
import type { Primitive } from "../view/scene-types";
import { view3dItems } from "./items";
import { sectionBeyond } from "./section-beyond";
import { clipRing, lineInside, SECTION_BAND, sectionCut, sectionFrame, stripSides, type SectionFrame, type SectionRoof } from "./section-cut";
import { ceilingAt, sectionPlanes } from "./section-roof";
import { roofEdge } from "../view/roof-layer";
import type { DeckItem, Ring } from "./types";
import { uniqueSorted } from "./wall-faces";

// A section's picture (AC-05 to AC-08), from the document alone, for one layout: on screen, on paper and for Claude. In
// metres with x along the line and y up; sizes in drawing units, as a plan's picture, so `zoom` turns them into metres.
//
//         A–A · Day                    the title: returned apart, as a sheet prints its own band name
//       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
//       ██               ██ ── +2.50   the ceiling's band, above the ceiling
//       ██               ██
//       ██      ▒▒▒      ██
//       ██      ▒▒▒      ██ ── ±0.00   the floor's band, below 0.00
//       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

/** The picture's text and shapes in drawing order, and its title. */
export type SectionPicture = { primitives: readonly Primitive[]; title: Extract<Primitive, { kind: "text" }> };

/**
 * m past the line's ends and the bands, for sectionBounds: room for the heights, not the title, which a sheet leaves out.
 * The widest height, "+10.00", reaches 11.4 mm past the line on paper: inside these metres from 1:100, and at 1:200 past
 * them but inside a sheet's 5 mm inset.
 */
const ROOM = { left: 0.1, right: 1.3, below: 0.1, above: 0.1 };
const NO_SELECTION: ReadonlySet<string> = new Set();

/** Whether the plane passes through a deck, or any of it lies in the strip. */
function seesDeck(frame: SectionFrame, depth: number | null, deck: DeckItem): boolean {
  const sides = stripSides(frame, depth);
  return deck.fills.some((f) => lineInside(frame, [f.ring, ...f.holes]).length > 0 || Math.abs(signedArea(sides.reduce<Ring>((ring, keep) => clipRing(ring, keep), f.ring))) > 1e-9);
}

/** A height as the side of the picture shows it. */
const heightText = (z: number): string => (z === 0 ? "±0.00" : `+${shown(z)}`);

/** A plain line at each height and its value past it; values too close for their text stack upward, lines stay true. */
function heights(zs: readonly number[], length: number, style: PlanStyle, zoom: number): Primitive[] {
  const { heightGap, heightLength, heightLine, heightSize, heightText: ink, heightTextGap, heightWidth } = style.section;
  const x0 = length + heightGap / zoom;
  const x1 = x0 + heightLength / zoom;
  let last = Number.NEGATIVE_INFINITY;
  return zs.flatMap((z): Primitive[] => {
    const y = Math.max(z, last + heightSize / zoom);
    last = y;
    return [
      { kind: "segment", a: { x: x0, y: z }, b: { x: x1, y: z }, width: { px: heightWidth }, color: heightLine, cap: "butt" },
      { kind: "text", text: heightText(z), at: { x: x1 + heightTextGap / zoom, y }, size: heightSize, color: ink, align: "left", rotation: 0, font: style.font },
    ];
  });
}

/**
 * The section of `doc` in `layout`: what lies past the cut, far to near, then the cut, the two bands and the heights, with
 * the title apart. `zoom` is drawing units per metre: screen pixels on the canvas, paper millimetres in an export.
 */
export function sectionPicture(doc: Document, section: Section, layout: string, style: PlanStyle, zoom: number): SectionPicture {
  const frame = sectionFrame(section);
  const items = view3dItems(doc, layout, null, NO_SELECTION, true); // walls beyond in their finishes, in every style (surfaces step 13)
  const ceiling = ceilingHeight(doc);
  const roof = sectionRoofOf(doc, frame); // under a slope (roofs.14)
  const onLine = roof ? ceilingsInside(doc, frame, roof) : [ceiling];
  const tops = items.flatMap((item) => (item.item === "deck" && seesDeck(frame, section.depth, item) ? [item.top] : []));
  const { titleColor, titleGap, titleSize } = style.section;
  return {
    primitives: [...sectionBeyond(frame, section.depth, items, style, roof?.planes ?? null, zoom), ...sectionCut(frame, items, ceiling, style, roof), ...heights(uniqueSorted([0, ...tops, ...onLine].map((v) => Math.round(v * 1000) / 1000)), frame.length, style, zoom)],
    title: {
      kind: "text",
      text: `${sectionLabel(section.id)} · ${doc.states[layout]?.name ?? layout}`,
      at: { x: 0, y: highSide(doc) + SECTION_BAND + (titleGap + titleSize / 2) / zoom },
      size: titleSize,
      color: titleColor,
      align: "left",
      rotation: 0,
      font: style.font,
      style: "bold",
    },
  };
}

/**
 * The ceiling's heights the line meets inside the walls' box: at each stretch's ends and where it crosses a gable's ridge
 * (the eaves and the ridge across a gable, the low and high walls along a shed), not past the walls, where the slope runs on.
 */
function ceilingsInside(doc: Document, frame: SectionFrame, roof: SectionRoof): number[] {
  const box = roofBox(doc);
  if (!box) return [];
  const rect = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
  const [p, q] = roof.planes;
  const ridge = p && q && Math.abs(p.b - q.b) > 1e-12 ? [(q.a - p.a) / (p.b - q.b)] : [];
  return lineInside(frame, [rect]).flatMap(([lo, hi]) => [lo, hi, ...ridge.filter((x) => x > lo && x < hi)].map((x) => ceilingAt(roof.planes, x)));
}

/** The ceiling's planes in the section's frame and the stretches of the line under the roof, or null under a flat ceiling. */
function sectionRoofOf(doc: Document, frame: SectionFrame): SectionRoof | null {
  if (roofOf(doc).shape === "flat") return null;
  const edge = roofEdge(doc);
  return edge.length === 0 ? null : { planes: sectionPlanes(frame, roofPlanes(doc)), stretches: lineInside(frame, [edge]) };
}

/** What a section's picture takes up without its title, in metres, in any layout, so panes of one section align. */
export function sectionBounds(doc: Document, section: Section): Bounds {
  return {
    min: { x: -ROOM.left, y: -SECTION_BAND - ROOM.below },
    max: { x: distance(section.a, section.b) + ROOM.right, y: highSide(doc) + SECTION_BAND + ROOM.above }, // the highest ceiling (roofs.14)
  };
}
