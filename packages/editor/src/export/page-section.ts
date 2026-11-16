import type { Document, Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import { presentationStyle } from "../view/plan-style";
import type { Primitive } from "../view/scene-types";
import { sectionPicture } from "../view3d/section-picture";
import { panesPage, type PaneSplit } from "./page-compare";
import type { PageParts } from "./page-plan";
import type { Rect } from "./paper";
import { toPage } from "./to-page";

// A Section sheet's page (spec "On paper", section.10): one section for 1 to 4 layouts in a compare sheet's panes, at one
// scale and one framing, so they stay comparable. A pane's band names its layout and the page's tag the sheet, so the
// picture's own title stays out (sheetset.19). In paper millimetres, y up.

export type SectionOnPage = { section: Section; panes: readonly { layout: string; name: string }[]; split: PaneSplit; title: string; scale: number; framing: Point };

/** The section in one layout on paper, with `framing`, in metres along the cut and up, at `box`'s centre, for the page to clip to it. */
export function sectionInBox(doc: Document, section: Section, layout: string, at: { scale: number; framing: Point }, box: Rect): Primitive[] {
  const k = 1000 / at.scale; // paper millimetres per metre
  const dx = box.x + box.w / 2 - at.framing.x * k;
  const dy = box.y + box.h / 2 - at.framing.y * k;
  return sectionPicture(doc, section, layout, presentationStyle(doc), k).primitives.map((p) => toPage(p, k, dx, dy));
}

export function sectionPage(doc: Document, parts: PageParts, c: SectionOnPage, titleBlock: readonly Primitive[]): ExportPage {
  return panesPage(doc, parts, c, titleBlock, (pane, box) => sectionInBox(doc, c.section, pane.layout, c, box));
}
