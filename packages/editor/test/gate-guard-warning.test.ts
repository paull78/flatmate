import { describe, expect, it } from "vitest";
import { levelOf, type Command, type Document } from "@fm/domain";
import { floorView, viewAt, type PlanView } from "../src/view/plan-view";
import { warningCount, warningMarks, warningRows } from "../src/view/warnings";
import { cabinDoc, withCommands } from "./builders";

// The final gate's AC-01 gaps: the row, the mark and the count agree at the floor and at the loft's own level, in every
// layout, and show nothing at another loft's level or once set back; 0.76 m doesn't warn and 0.77 m does. The cabin's
// loft (2.15) has one open edge, x 2.10, y 0.10–2.90.

const LOFT = "loft/k0";
const none: Command = { type: "setDeck", deckId: LOFT, guard: "none" };
const night: Command = { type: "addState", opId: "n", name: "Night" };
const otherLoft: Command = { type: "addDeck", opId: "m", preset: "loft", at: { x: 3.2, y: 1.5 }, w: 1, d: 1, top: 1.5 };
const atFloor = (doc: Document, layout: string): PlanView => floorView(doc, layout);
const atDeck = (doc: Document, layout: string, deck: string): PlanView => viewAt(layout, levelOf(doc, deck));
/** What the viewer sees: the rows' words, the "!" marks on the plan, and the count by the layout tabs. */
const seen = (doc: Document, view: PlanView) => ({
  rows: warningRows(doc, view).map((r) => r.text),
  marks: warningMarks(doc, view, 80).flatMap((p) => (p.kind === "text" ? [p.at] : [])),
  count: warningCount(doc, view),
});
const MID = { x: expect.closeTo(2.1, 6), y: expect.closeTo(1.5, 6) };

describe("a loft set to None: its row, mark and count (AC-01)", () => {
  it("agree at the floor and at its own level, in every layout; none at another loft's level, or once set back", () => {
    const doc = withCommands(cabinDoc(), night, otherLoft, none);
    for (const layout of ["s0", "n/s0"]) {
      for (const view of [atFloor(doc, layout), atDeck(doc, layout, LOFT)]) {
        expect(seen(doc, view), `${layout} at ${view.level.deckIds.join() || "the floor"}`).toEqual({ rows: ["No guard on Loft's right side"], marks: [MID], count: 1 });
      }
      expect(seen(doc, atDeck(doc, layout, "m/k0"))).toEqual({ rows: [], marks: [], count: 0 });
    }
    const back = withCommands(doc, { type: "setDeck", deckId: LOFT, guard: "railing" });
    for (const view of [atFloor(back, "s0"), atDeck(back, "s0", LOFT), atFloor(back, "n/s0"), atDeck(back, "n/s0", LOFT)]) {
      expect(seen(back, view)).toEqual({ rows: [], marks: [], count: 0 });
    }
  });
});

describe("the threshold (AC-01)", () => {
  it("a platform set to None at 0.76 m doesn't warn, and at 0.77 m does", () => {
    const platform = withCommands(cabinDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1 });
    const at = (top: number) => {
      const doc = withCommands(platform, { type: "setDeck", deckId: "p/k0", top });
      expect(doc.decks["p/k0"]?.guardFront.kind).toBe("none");
      const { rows, marks, count } = seen(doc, atFloor(doc, "s0"));
      return { rows, marks: marks.length, count };
    };
    expect(at(0.76)).toEqual({ rows: [], marks: 0, count: 0 });
    expect(at(0.77)).toEqual({ rows: ["No guard on Platform's lower side", "No guard on Platform's right side", "No guard on Platform's upper side", "No guard on Platform's left side"], marks: 4, count: 4 }); // one per open side (edges.04)
  });
});
