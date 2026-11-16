import { highSide, distance, sectionLabel, shown, type Document } from "@fm/domain";
import { SECTION_BAND } from "../view3d/section-cut";
import { sectionPicture } from "../view3d/section-picture";
import { LOOK_LONG_SIDE, type LookPicture } from "./look";
import { LOOK_STYLE } from "./plan-style";

// Claude's section (AC-11): the strip's picture for a named layout, title included, its long side LOOK_LONG_SIDE look
// pixels. sectionBounds' room is metres, for a sheet that prints its own title; text here is look pixels, so the room is too.

/** Look pixels around the cut and its bands: `above` takes the title, `right` the heights' line and widest value, "+10.00". */
const ROOM = { left: 16, right: 84, below: 8, above: 30 };

/** A section of `doc` in the layout `layout`, or a refusal naming the letter or layout that doesn't exist. */
export function lookSection(doc: Document, letter: string, layout: string): LookPicture | { refused: string } {
  const section = Object.hasOwn(doc.sections, letter) ? doc.sections[letter] : undefined;
  if (!section) return { refused: `No section has the id ${letter}` };
  const state = Object.hasOwn(doc.states, layout) ? doc.states[layout] : undefined;
  if (!state) return { refused: `No layout state has the id ${layout}` };
  const length = distance(section.a, section.b);
  const [bottom, top] = [-SECTION_BAND, highSide(doc) + SECTION_BAND]; // the highest ceiling under a slope (roofs.14)
  const zoom = Math.min((LOOK_LONG_SIDE - ROOM.left - ROOM.right) / length, (LOOK_LONG_SIDE - ROOM.below - ROOM.above) / (top - bottom));
  const { primitives, title } = sectionPicture(doc, section, layout, LOOK_STYLE, zoom);
  return {
    primitives: [...primitives, title],
    frame: { min: { x: -ROOM.left / zoom, y: bottom - ROOM.below / zoom }, max: { x: length + ROOM.right / zoom, y: top + ROOM.above / zoom }, zoom, background: "#ffffff" },
    caption: `${sectionLabel(section.id)} · ${state.name} · ${section.side === 1 ? "a" : "b"} on the left · ${shown(length)} m wide · y up from the floor · ${(1 / zoom).toPrecision(3)} m per look pixel`,
  };
}
