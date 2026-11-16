import { describe, expect, it } from "vitest";
import { SURROUNDINGS_VALUES, type Command, type Document } from "@fm/domain";
import { sheetPages } from "../src/export/sheet";
import { roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// Surroundings is saved with the project and printed nowhere (surroundings.05). Existing export tests can't see this, as
// their documents have no row.

const field = (key: string, value: string): Command => ({ type: "setProjectField", key, value });
const drawing = { layout: "s0", deck: null };
const SET: Command[] = [
  { type: "addSheet", opId: "c", after: null, kind: "cover", title: "Cover", drawings: [drawing] },
  { type: "addSheet", opId: "p", after: null, kind: "plan", title: "Plan", drawings: [drawing] },
  { type: "addSheet", opId: "r", after: null, kind: "report", title: "Report", drawings: [], text: "# Title\n\nStored." },
];
const bare = (): Document => withCommands(roomDoc(), ...SET);

function printed(doc: Document) {
  const host = new FakeHost();
  host.today = () => "2026-11-05";
  return sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host, finishes: true });
}
function status(doc: Document) {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  const view = shell.view().sheetsView;
  if (!view) throw new Error("the view isn't open");
  return { warning: view.warning, note: view.note };
}

describe("surroundings print nothing (surroundings.05)", () => {
  it("a title block, a cover and a report are equal with and without the row", () => {
    const without = printed(bare());
    expect(without.pages.length).toBeGreaterThanOrEqual(3);
    for (const { value } of SURROUNDINGS_VALUES) expect(printed(withCommands(bare(), field("surroundings", value))), value).toEqual(without);
  });

  it("this comparison sees a title block field, so it would see a printed row", () => {
    expect(printed(withCommands(bare(), field("client", "Rossi"))).pages).not.toEqual(printed(bare()).pages);
  });

  it("the sheets view's warning and note don't change with the row", () => {
    const without = status(bare());
    for (const { value } of SURROUNDINGS_VALUES) expect(status(withCommands(bare(), field("surroundings", value))), value).toEqual(without);
  });
});
