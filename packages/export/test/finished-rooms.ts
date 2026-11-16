import type { ExportContent } from "@fm/editor";
import { FakeShell, labelledDoc, withCommands, withoutSheetFinishes } from "@fm/editor/testing";

// Two finished rooms for the writers' finish tests (AC-12): labelledDoc's Room 1 (x 0.1–2.9) in planks and Room 2
// (x 3.1–5.9) in mosaic, each at the motif's defaults, written out here so the expected colours don't come from the code.

export const PLANKS = { fill: "#c8a27a", line: "#a48564" }; // the line: each channel × (1 − 0.4 × 45 %)
export const MOSAIC = { fill: "#a9c9d6", line: "#87a1ab" }; // × (1 − 0.4 × 50 %)

export function finishedRooms() {
  return withCommands(
    labelledDoc(),
    { type: "setFinish", id: "L1", finish: { motif: "planks", colour: PLANKS.fill, strength: 45, size: 0.2, angle: 0 } },
    { type: "setFinish", id: "L2", finish: { motif: "mosaic", colour: MOSAIC.fill, strength: 50, size: 0.025, angle: 0 } },
  );
}

/** The sheets view's download in `format`, with Finishes left at its default or set to `finishes`. */
export function download(format: "svg" | "pdf", finishes?: "with" | "without"): ExportContent {
  const off = finishes === "without" && format === "pdf"; // the PDF's finishes are each sheet's
  const shell = FakeShell.withDocument(off ? withoutSheetFinishes(finishedRooms()) : finishedRooms());
  shell.ui({ type: "openExport" });
  if (finishes !== undefined) shell.ui({ type: "setExport", field: "finishes", value: finishes });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  if (content?.kind !== format) throw new Error(`no ${format} download`);
  return content;
}
