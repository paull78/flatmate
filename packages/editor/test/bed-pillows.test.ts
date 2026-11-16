import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The pillow rule (furnish.06, AC-08) wherever a bed is drawn: the canvas, the PDF sheet and the SVG download. Each
// pillow is a rounded rectangle with four corner arcs, and nothing else in these drawings draws an arc but the sheet.

const arcs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "arc").length;

const withBed = (kind: string, config: string, w: number): Document => withCommands(
  roomDoc(),
  { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind }, at: { x: 3, y: 3.9 }, config },
  { type: "setObjectSize", objectId: "b/o0", w, d: {} },
);

/** The arcs of a download in `format`: every PDF page's, or the SVG plan's. */
function downloadArcs(doc: Document, format: "pdf" | "svg"): number {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  if (!content || content.kind !== format) throw new Error(`no ${format} download`);
  switch (content.kind) {
    case "pdf":
      return content.pages.reduce((n, page) => n + arcs(page.primitives), 0);
    case "svg":
      return arcs(content.primitives);
    default:
      throw new Error("unexpected content");
  }
}

const KINDS: [string, string][] = [["bed", "standard"], ["murphyBed", "down"], ["sofaBed", "bed"]];
const WIDTHS: [number, number][] = [[1.29, 4], [1.2996, 8], [1.3, 8]];

describe("pillows on the canvas and in the exports (furnish.06, AC-08)", () => {
  it("on the canvas, in the PDF and in the SVG a 1.29 m bed draws one pillow and 1.2996 m and 1.30 m two (AC-08)", () => {
    const bare = { pdf: downloadArcs(roomDoc(), "pdf"), svg: downloadArcs(roomDoc(), "svg") };
    for (const [kind, config] of KINDS) {
      for (const [w, expected] of WIDTHS) {
        const doc = withBed(kind, config, w);
        const label = `${kind} ${config} ${w}`;
        const objects = FakeShell.withDocument(doc).scene().layers.find((l) => l.name === "objects")?.primitives ?? [];
        expect(arcs(objects), `${label} canvas`).toBe(expected);
        expect(downloadArcs(doc, "pdf") - bare.pdf, `${label} pdf`).toBe(expected);
        expect(downloadArcs(doc, "svg") - bare.svg, `${label} svg`).toBe(expected);
      }
    }
  });
});
