import { highSide, distance, isValidId, sectionLabel, sectionsOf, type Document, type EntityRef, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import { SECTION_BAND } from "../view3d/section-cut";
import { sectionPicture } from "../view3d/section-picture";
import { toPage } from "../export/to-page";
import { memoLast } from "./memo";
import { CANVAS_STYLE } from "./plan-style";
import type { SectionStrip } from "./view-model-types";

// The section's frame under the plan (spec "The strip", section.04, .11, .45): this viewer's section, kept apart from
// the selection. A page in CSS pixels at the frame's size, drawn through Canvas2D like a sheet's: the same object until
// the document, the section, the layout or the size changes, so a drag or a pan never redraws it.
//
//   ┌────────────────────────────────────────────────┐
//   │ A–A · Day                          [A–A][B–B] × │   the title bar, drawn by the shell like every frame's
//   ├────────────────────────────────────────────────┤
//   │        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓── +2.50        │
//   │        █                       █                 │   the picture, as large as it fits, centred with its heights
//   │        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓── ±0.00        │
//   └────────────────────────────────────────────────┘

/** CSS pixels around the cut and its bands: fixed, as text doesn't scale with the picture. `right` takes the heights' line and value. */
const ROOM = { left: 16, right: 76, below: 8, above: 8 };
/** A floor for the scale, for a viewport still too narrow for its margins. */
const MIN_SCALE = 1;

/** The selected section: it's always selected alone. */
const selectedSection = (selection: readonly EntityRef[]): string | null => (selection[0]?.table === "sections" ? selection[0].id : null);

/**
 * The strip's section after an event: selecting a section switches to it, and only a change of selection does, so a
 * closed strip stays closed under a section still selected. A section gone from the document closes it, as does no document.
 */
export function stripAfter(current: string | null, before: readonly EntityRef[], after: readonly EntityRef[], doc: Document | null): string | null {
  if (doc === null) return null;
  const picked = selectedSection(after);
  if (picked !== null && picked !== selectedSection(before)) return picked;
  return current !== null && isValidId(current) && doc.sections[current] ? current : null;
}

function stripPage(doc: Document, section: Section, layout: string, { w, h }: { w: number; h: number }): ExportPage {
  const across = highSide(doc) + 2 * SECTION_BAND; // the highest ceiling under a slope (roofs.14)
  const length = distance(section.a, section.b);
  const k = Math.max(MIN_SCALE, Math.min((w - ROOM.left - ROOM.right) / length, (h - ROOM.above - ROOM.below) / across));
  const origin: Point = { x: Math.max(ROOM.left, (w - length * k - ROOM.right) / 2), y: Math.max(ROOM.below, (h - across * k) / 2) + SECTION_BAND * k };
  const { primitives } = sectionPicture(doc, section, layout, CANVAS_STYLE, k);
  return { widthMm: w, heightMm: h, primitives: primitives.map((p) => toPage(p, k, origin.x, origin.y)) };
}

const stripView = memoLast((doc: Document, section: Section, layout: string): SectionStrip => {
  let last: { w: number; h: number; page: ExportPage } | null = null;
  return {
    section: section.id,
    label: sectionLabel(section.id),
    layout: doc.states[layout]?.name ?? layout,
    letters: sectionsOf(doc).map((s) => ({ section: s.id, label: sectionLabel(s.id) })),
    page: ({ w, h }) => {
      if (last === null || last.w !== w || last.h !== h) last = { w, h, page: stripPage(doc, section, layout, { w, h }) }; // built when drawn: the ViewModel runs on every event
      return last.page;
    },
  };
});

/** The strip the view shows, or null when closed. */
export function sectionStripView(doc: Document | null, section: string | null, layout: string | null): SectionStrip | null {
  const row = doc && section !== null ? doc.sections[section] : undefined;
  return doc && row && layout !== null ? stripView(doc, row, layout) : null;
}
