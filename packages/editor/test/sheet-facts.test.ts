import { describe, expect, it } from "vitest";
import { sheetsOf, type Command, type Document } from "@fm/domain";
import { sheetFacts } from "../src/export/sheet";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// What each sheet prints, for a reader with no view (MCP): the same numbers, scales and notes as the sheets view's rows,
// from what the set works out, so Claude and a person read one answer.

const report = (id: string, text: string, inPdf = true): Command => ({ type: "addSheet", opId: id, after: null, kind: "report", title: id, drawings: [], text, inPdf });
const plan = (id: string, fields: Partial<Extract<Command, { type: "addSheet" }>> = {}): Command => ({ type: "addSheet", opId: id, after: null, kind: "plan", title: id, drawings: [{ layout: "s0", deck: null }], ...fields });
const LONG = Array.from({ length: 200 }, (_, i) => `${i} The plan fits a whole home into seven by two and a half metres.`).join("\n\n");

function viewRows(doc: Document) {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return (shell.view().sheetsView?.sheets ?? []).map((r) => ({ id: r.id, number: r.number, scale: r.scale, pages: r.pageCount, partOfPlan: r.partOfPlan }));
}

describe("sheetFacts", () => {
  it("agrees with the sheets view's rows, on every paper a test can change the answer with", () => {
    const docs = [
      roomDoc(),
      withCommands(roomDoc(), plan("a", { scale: 20 }), report("long", LONG), plan("b", { inPdf: false }), plan("c", { cx: 50, cy: 0, scale: 100 })),
      withCommands(roomDoc(), report("long", LONG), plan("a"), { type: "setProjectField", key: "paper", value: "A3" }, { type: "setProjectField", key: "generalScale", value: "50" }),
    ];
    for (const doc of docs) expect(sheetFacts(doc)).toEqual(viewRows(doc));
  });

  it("numbers count a report's pages, and a sheet not In PDF has none", () => {
    const facts = sheetFacts(withCommands(roomDoc(), report("long", LONG), plan("a"), plan("off", { inPdf: false })));
    const of = (id: string) => facts.find((f) => f.id === id);
    const long = of("long/t0");
    expect(long?.pages).toBeGreaterThan(1);
    expect(of("a/t0")?.number).toBe((long?.number ?? 0) + (long?.pages ?? 0));
    expect(of("off/t0")?.number).toBeNull();
  });

  it("a framing past the frame shows part of the plan, and a report has neither scale nor note", () => {
    const doc = withCommands(roomDoc(), plan("far", { cx: 500, cy: 0 }), report("r", "Text"));
    const of = (id: string) => sheetFacts(doc).find((f) => f.id === id);
    expect(of("far/t0")?.partOfPlan).toBe(true);
    expect(of(sheetsOf(doc)[0]?.id ?? "")?.partOfPlan).toBe(false);
    expect(of("r/t0")?.scale).toBeNull();
    expect(of("r/t0")?.partOfPlan).toBe(false);
  });
});
