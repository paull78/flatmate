import { describe, expect, it } from "vitest";
import { cutName, sheetDrawings, sheetsOf, type Command, type Document } from "@fm/domain";
import { clearRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The sheet list's actions (sheetset.13, .14; AC-02, AC-03): each is a command through the ordinary history, and the
// selection is this viewer's, never stored.

const opened = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
};
function sheets(shell: FakeShell) {
  const v = shell.view().sheetsView;
  if (!v) throw new Error("the view isn't open");
  return v;
}
const ids = (shell: FakeShell): string[] => sheets(shell).sheets.map((s) => s.id);
const stored = (shell: FakeShell, id: string) => {
  const sheet = sheetsOf(shell.doc()).find((s) => s.id === id);
  if (!sheet) throw new Error(`no sheet ${id}`);
  return sheet;
};
const MAX_NAME_CHARS = cutName("x".repeat(500)).length;
const NIGHT = "n/s0";
const GUESTS = "g/s0";
const addLayout = (opId: string, name: string): Command => ({ type: "addState", opId, name });
const dayNight = (): Document => withCommands(roomDoc(), addLayout("n", "Night"));
const threeLayouts = (): Document => withCommands(dayNight(), addLayout("g", "Guests"));
const LOFT = "loft/k0";
const withFurnishedLoft = (doc: Document): Document =>
  withCommands(
    doc,
    { type: "setCeiling", height: 3.5 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2 }, w: 2.4, d: 2.4 },
  );
const bedOnLoft = (state: string): Command => ({ type: "placeObject", deck: LOFT, opId: "bed", state, object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 2.5, y: 2 } });

describe("selection is this viewer's", () => {
  it("starts on the first sheet, and selecting isn't an edit", () => {
    const shell = opened(dayNight());
    expect(sheets(shell).selected).toBe("auto/0");
    shell.ui({ type: "selectSheet", id: "auto/1" });
    expect(sheets(shell).selected).toBe("auto/1");
    expect(shell.view().canUndo).toBe(false);
    expect(ids(shell)).toEqual(["auto/0", "auto/1"]); // still the automatic list: a selection writes nothing
  });

  it("falls to the first sheet when its own has gone, as when an undo takes it", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "addSheet", kind: "plan" });
    const added = sheets(shell).selected;
    expect(added).not.toBe("auto/0");
    shell.ui({ type: "undo" });
    expect(sheets(shell).selected).toBe("auto/0");
  });

  it("stays when the view closes, and goes with the drawing, as the next one's IDs can be the same", () => {
    const r = FakeRemote.open(dayNight());
    r.shell.ui({ type: "openExport" });
    r.shell.ui({ type: "selectSheet", id: "auto/1" });
    r.shell.ui({ type: "closeExport" });
    r.shell.ui({ type: "openExport" });
    expect(sheets(r.shell).selected).toBe("auto/1");
    r.shell.ui({ type: "showProjectList" });
    r.shell.ui({ type: "openProject", id: "p1" });
    r.snapshot();
    r.shell.ui({ type: "openExport" });
    expect(sheets(r.shell).selected).toBe("auto/0");
  });
});

describe("add makes a sheet after the selected one and selects it", () => {
  it("a plan is the viewed layout at the floor, named after it", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "setActiveState", id: NIGHT });
    shell.ui({ type: "selectSheet", id: "auto/0" });
    shell.ui({ type: "addSheet", kind: "plan" });
    const v = sheets(shell);
    expect(ids(shell)[1]).toBe(v.selected); // after the selected one, not at the end
    expect(v.sheets).toHaveLength(4);
    const sheet = stored(shell, v.selected ?? "");
    expect(sheet.kind).toBe("plan");
    expect(sheet.title).toBe("Night");
    expect(sheetDrawings(sheet)).toEqual([{ layout: NIGHT, deck: null }]);
  });

  it("a plan stays at the floor when a loft is in view", () => {
    const shell = opened(withCommands(withFurnishedLoft(roomDoc())));
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.ui({ type: "addSheet", kind: "plan" });
    expect(sheetDrawings(stored(shell, sheets(shell).selected ?? ""))).toEqual([{ layout: "s0", deck: null }]);
  });

  it("a compare sheet shows the first two layouts", () => {
    const shell = opened(threeLayouts());
    expect(sheets(shell).canCompare).toBe(true);
    shell.ui({ type: "addSheet", kind: "compare" });
    const sheet = stored(shell, sheets(shell).selected ?? "");
    expect(sheet.kind).toBe("compare");
    expect(sheetDrawings(sheet)).toEqual([{ layout: "s0", deck: null }, { layout: NIGHT, deck: null }]);
    expect(sheet.title).toBe("Layout and Night");
  });

  it("with one layout, compare is offered off and can't be added", () => {
    const shell = opened(roomDoc());
    expect(sheets(shell).canCompare).toBe(false);
    shell.ui({ type: "addSheet", kind: "compare" });
    expect(ids(shell)).toEqual(["auto/0"]);
    expect(shell.view().canUndo).toBe(false);
  });

  describe("a new cover or compare opens whole (sheetset.65)", () => {
    const wide = (): Document => withCommands(clearRoomDoc(7, 2.5, "r"), addLayout("n", "Night"));
    const at = (doc: Document, paper: string, scale: string): FakeShell => {
      const shell = opened(doc);
      shell.ui({ type: "setSheetSetting", key: "paper", value: paper });
      shell.ui({ type: "setSheetSetting", key: "generalScale", value: scale });
      return shell;
    };
    const added = (shell: FakeShell) => {
      const id = sheets(shell).selected ?? "";
      const row = sheets(shell).sheets.find((s) => s.id === id);
      if (!row) throw new Error("no selected row");
      return { row, sheet: stored(shell, id) };
    };

    it("a cover General would cut takes the largest scale holding it whole", () => {
      const shell = at(wide(), "A4", "50"); // 7.2 m at 1:50 is 144 mm, past a cover's frame; 1:75 holds it
      shell.ui({ type: "addSheet", kind: "cover" });
      const { row, sheet } = added(shell);
      expect(sheet.scale).toBe(75);
      expect(row.ownScale).toBe(true);
      expect(row.partOfPlan).toBe(false);
    });

    it("a compare General would cut does too", () => {
      const shell = at(wide(), "A3", "20");
      shell.ui({ type: "addSheet", kind: "compare" });
      const { row, sheet } = added(shell);
      expect(sheet.scale).not.toBeNull();
      expect(row.partOfPlan).toBe(false);
    });

    it("the scale it takes is the largest that fits: one step larger cuts it", () => {
      const shell = at(wide(), "A4", "50");
      shell.ui({ type: "addSheet", kind: "cover" });
      const { row } = added(shell);
      expect(row.scales.find((s) => s.scale === 50)?.nofit).toBe(true);
      expect(row.scales.find((s) => s.scale === 75)?.nofit).toBe(false);
    });

    it("a cover General shows whole follows General", () => {
      const shell = at(wide(), "A4", "100");
      shell.ui({ type: "addSheet", kind: "cover" });
      const { row, sheet } = added(shell);
      expect(sheet.scale).toBeNull();
      expect(row.ownScale).toBe(false);
    });

    it("a plan sheet follows General even when it cuts the plan", () => {
      const shell = at(wide(), "A4", "20");
      shell.ui({ type: "addSheet", kind: "plan" });
      const { row, sheet } = added(shell);
      expect(sheet.scale).toBeNull();
      expect(row.partOfPlan).toBe(true);
    });

    it("with no scale holding it whole it follows General", () => {
      const shell = at(clearRoomDoc(120, 2.5, "r"), "A4", "50");
      shell.ui({ type: "addSheet", kind: "cover" });
      expect(added(shell).sheet.scale).toBeNull();
    });

    it("adding it is still one undo step", () => {
      const shell = at(wide(), "A4", "50");
      const before = ids(shell).length;
      shell.ui({ type: "addSheet", kind: "cover" });
      expect(ids(shell)).toHaveLength(before + 1);
      shell.ui({ type: "undo" });
      expect(ids(shell)).toHaveLength(before);
    });
  });

  it("a new cover goes first whichever sheet is selected, and undoes as one step (sheetset.70)", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "selectSheet", id: "auto/1" });
    shell.ui({ type: "addSheet", kind: "cover" });
    const [first, ...rest] = sheets(shell).sheets;
    expect(first?.kind).toBe("cover");
    expect(first?.number).toBe(1);
    expect(sheets(shell).selected).toBe(first?.id);
    expect(rest.map((r) => r.kind)).toEqual(["plan", "plan"]);
    shell.ui({ type: "undo" });
    expect(sheets(shell).sheets.map((r) => r.kind)).toEqual(["plan", "plan"]);
  });

  it("other kinds still go below the selected one", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "selectSheet", id: "auto/0" });
    shell.ui({ type: "addSheet", kind: "report" });
    expect(sheets(shell).sheets.map((r) => r.kind)).toEqual(["plan", "report", "plan"]);
  });

  it("a cover shows the first layout", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "setActiveState", id: NIGHT });
    shell.ui({ type: "addSheet", kind: "cover" });
    const sheet = stored(shell, sheets(shell).selected ?? "");
    expect(sheet.kind).toBe("cover");
    expect(sheetDrawings(sheet)).toEqual([{ layout: "s0", deck: null }]);
    expect(sheet.title).toBe("Layout cover");
  });

  it("a new cover's name differs from its plan's, so the index doesn't read twice", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "addSheet", kind: "cover" });
    const titles = sheets(shell).sheets.map((s) => s.title);
    expect(titles).toHaveLength(new Set(titles).size);
    expect(titles).toContain("Layout cover");
    expect(titles).toContain("Layout");
  });

  it("a cover's name follows its layout; a typed one stays", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "addSheet", kind: "cover" });
    const id = sheets(shell).selected ?? "";
    shell.ui({ type: "setSheetDrawing", id, layout: NIGHT, deck: null });
    expect(stored(shell, id).title).toBe("Night cover");
    shell.ui({ type: "renameSheet", id, title: "Front page" });
    shell.ui({ type: "setSheetDrawing", id, layout: "s0", deck: null });
    expect(stored(shell, id).title).toBe("Front page");
  });

  it("a long layout name still gives a name within the limit", () => {
    const long = "L".repeat(MAX_NAME_CHARS);
    const shell = opened(withCommands(roomDoc(), { type: "renameState", stateId: "s0", name: long }));
    shell.ui({ type: "addSheet", kind: "cover" });
    expect(stored(shell, sheets(shell).selected ?? "").title.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
  });

  it("a report has a title and starter text, and no drawing", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "addSheet", kind: "report" });
    const sheet = stored(shell, sheets(shell).selected ?? "");
    expect(sheet.kind).toBe("report");
    expect(sheet.title).toBe("Project report");
    expect(sheet.text).toBe("# Title\n\n## Heading\n\nWrite here.");
    expect(sheetDrawings(sheet)).toEqual([]);
  });
});

describe("duplicate and delete", () => {
  const full: Command = { type: "addSheet", opId: "a", after: null, kind: "plan", drawings: [{ layout: NIGHT, deck: null }], inPdf: false, title: "Bedroom detail", scale: 20, split: "stacked", cx: 1.5, cy: -2, finishes: false, text: "", size: "large" };

  it('copies every field right after its source, titled "… copy", and selects it', () => {
    const shell = opened(withCommands(dayNight(), full));
    shell.ui({ type: "duplicateSheet", id: "a/t0" });
    const list = ids(shell);
    const copyId = list[list.indexOf("a/t0") + 1] ?? "";
    expect(sheets(shell).selected).toBe(copyId);
    const copy = stored(shell, copyId);
    expect(copy).toEqual({ ...stored(shell, "a/t0"), id: copyId, order: copy.order, title: "Bedroom detail copy" });
  });

  it("a report's copy keeps its text", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "addSheet", kind: "report" });
    const first = sheets(shell).selected ?? "";
    shell.ui({ type: "duplicateSheet", id: first });
    expect(stored(shell, sheets(shell).selected ?? "").text).toBe(stored(shell, first).text);
  });

  it("a title at the limit still copies", () => {
    const long = "x".repeat(200);
    const shell = opened(withCommands(dayNight(), { ...full, title: long }));
    const count = ids(shell).length;
    shell.ui({ type: "duplicateSheet", id: "a/t0" });
    expect(ids(shell)).toHaveLength(count + 1);
    expect(shell.view().toast).toBeNull();
  });

  it("delete selects the next, or the one before at the end", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "selectSheet", id: "auto/1" });
    shell.ui({ type: "deleteSheet", id: "auto/1" });
    expect(sheets(shell).selected).toBe("auto/2");
    shell.ui({ type: "deleteSheet", id: "auto/2" });
    expect(sheets(shell).selected).toBe("auto/0");
  });

  it("deleting another sheet leaves the selection", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "selectSheet", id: "auto/1" });
    shell.ui({ type: "deleteSheet", id: "auto/2" });
    expect(sheets(shell).selected).toBe("auto/1");
  });

  it("the last sheet stays, with the refusal in words", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "deleteSheet", id: "auto/0" });
    expect(ids(shell)).toEqual(["auto/0"]);
    expect(shell.view().toast).toBe("A project keeps at least one sheet");
  });
});

describe("In PDF ticks, and numbers follow", () => {
  it("the first edit materialises the automatic list, so a new layout then adds no sheet", () => {
    const shell = opened(dayNight());
    shell.command(addLayout("g", "Guests"));
    expect(ids(shell)).toEqual(["auto/0", "auto/1", "auto/2"]); // automatic: it follows the layouts
    shell.ui({ type: "tickSheet", id: "auto/0", on: false });
    expect(sheets(shell).sheets.map((s) => [s.inPdf, s.number])).toEqual([[false, null], [true, 1], [true, 2]]);
    shell.command(addLayout("h", "Holidays"));
    expect(ids(shell)).toEqual(["auto/0", "auto/1", "auto/2"]);
  });

  it("the tick doesn't select", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "selectSheet", id: "auto/1" });
    shell.ui({ type: "tickSheet", id: "auto/0", on: false });
    expect(sheets(shell).selected).toBe("auto/1");
  });
});

describe("move by index", () => {
  it("puts a sheet at its place in the list, and numbers follow", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "moveSheet", id: "auto/2", index: 0 });
    expect(ids(shell)).toEqual(["auto/2", "auto/0", "auto/1"]);
    expect(sheets(shell).sheets.map((s) => s.number)).toEqual([1, 2, 3]);
    shell.ui({ type: "moveSheet", id: "auto/2", index: 1 }); // Alt + Down: one place on
    expect(ids(shell)).toEqual(["auto/0", "auto/2", "auto/1"]);
  });

  it("the selection stays on the same sheet", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "selectSheet", id: "auto/2" });
    shell.ui({ type: "moveSheet", id: "auto/2", index: 0 });
    expect(sheets(shell).selected).toBe("auto/2");
  });

  it("a place outside the list is refused, and the same place changes nothing", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "moveSheet", id: "auto/0", index: 0 });
    expect(shell.view().canUndo).toBe(false);
    shell.ui({ type: "moveSheet", id: "auto/0", index: 5 });
    expect(ids(shell)).toEqual(["auto/0", "auto/1"]);
    expect(shell.view().toast).toBe("That place isn't in the list");
  });
});

describe("each is one undo step", () => {
  const steps: [string, (shell: FakeShell) => void][] = [
    ["add", (s) => s.ui({ type: "addSheet", kind: "plan" })],
    ["duplicate", (s) => s.ui({ type: "duplicateSheet", id: "auto/0" })],
    ["delete", (s) => s.ui({ type: "deleteSheet", id: "auto/0" })],
    ["move", (s) => s.ui({ type: "moveSheet", id: "auto/1", index: 0 })],
    ["tick", (s) => s.ui({ type: "tickSheet", id: "auto/0", on: false })],
    ["None", (s) => s.ui({ type: "tickAllSheets", on: false })],
  ];
  const summary = (shell: FakeShell) => sheets(shell).sheets.map((s) => [s.id, s.inPdf]);

  it.each(steps)("%s", (_name, act) => {
    const shell = opened(dayNight());
    const before = summary(shell);
    act(shell);
    const after = summary(shell);
    expect(after).not.toEqual(before);
    shell.ui({ type: "undo" });
    expect(summary(shell)).toEqual(before);
    expect(shell.view().canUndo).toBe(false); // one step: nothing else to undo, so the list is automatic again
    shell.ui({ type: "redo" });
    expect(summary(shell)).toEqual(after);
  });
});

describe("the offers of what has no sheet", () => {
  it("no rows: nothing is offered, whatever the layouts", () => {
    expect(sheets(opened(threeLayouts())).missing).toEqual([]);
    const loft = withCommands(withFurnishedLoft(roomDoc()), bedOnLoft("s0"));
    expect(sheets(opened(loft)).missing).toEqual([]);
  });

  it('rows and a new layout: "Night" is offered, and Add adds it after the selected one', () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "tickSheet", id: "auto/0", on: false });
    expect(sheets(shell).missing).toEqual([]);
    shell.command(addLayout("n", "Night"));
    expect(sheets(shell).missing).toEqual([{ layout: NIGHT, deck: null, title: "Night" }]);
    shell.ui({ type: "addMissingSheet", layout: NIGHT, deck: null });
    const v = sheets(shell);
    expect(v.missing).toEqual([]);
    expect(ids(shell)).toHaveLength(2);
    const sheet = stored(shell, v.selected ?? "");
    expect(sheet.title).toBe("Night");
    expect(sheetDrawings(sheet)).toEqual([{ layout: NIGHT, deck: null }]);
    shell.ui({ type: "undo" });
    expect(sheets(shell).missing).toEqual([{ layout: NIGHT, deck: null, title: "Night" }]);
  });

  it("a loft with its own pieces is offered at its level, one without isn't", () => {
    const shell = opened(withFurnishedLoft(roomDoc()));
    shell.ui({ type: "tickSheet", id: "auto/0", on: false });
    expect(sheets(shell).missing).toEqual([]); // a bare loft
    shell.command(bedOnLoft("s0"));
    const [offer] = sheets(shell).missing;
    expect(offer?.deck).toBe(LOFT);
    expect(offer?.title).toContain("Layout · ");
    shell.ui({ type: "addMissingSheet", layout: "s0", deck: LOFT });
    expect(sheets(shell).missing).toEqual([]);
  });

  it("a compare sheet showing a layout counts as its sheet", () => {
    const shell = opened(dayNight());
    shell.ui({ type: "deleteSheet", id: "auto/1" });
    expect(sheets(shell).missing.map((m) => m.title)).toEqual(["Night"]);
    shell.ui({ type: "addSheet", kind: "compare" });
    expect(sheets(shell).missing).toEqual([]);
  });

  it("deleting the last sheet of a layout offers it again", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "deleteSheet", id: "auto/1" });
    expect(sheets(shell).missing.map((m) => m.layout)).toEqual([NIGHT]);
    expect(sheets(shell).missing.map((m) => m.layout)).not.toContain(GUESTS);
  });
});

describe("All and None", () => {
  it("are one command each, and None leaves Save PDF disabled", () => {
    const shell = opened(threeLayouts());
    shell.ui({ type: "tickSheet", id: "auto/1", on: false });
    shell.ui({ type: "tickAllSheets", on: false });
    expect(sheets(shell).sheets.map((s) => s.inPdf)).toEqual([false, false, false]);
    expect(sheets(shell).canSave).toBe(false);
    expect(sheets(shell).saveReason).toBe("Tick a sheet to save a PDF");
    shell.ui({ type: "tickAllSheets", on: true });
    expect(sheets(shell).sheets.map((s) => s.inPdf)).toEqual([true, true, true]);
    expect(sheets(shell).canSave).toBe(true);
    shell.ui({ type: "undo" });
    expect(sheets(shell).canSave).toBe(false);
    shell.ui({ type: "undo" });
    expect(sheets(shell).sheets.map((s) => s.inPdf)).toEqual([true, false, true]); // None took one step
  });
});
