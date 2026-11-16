import { describe, expect, it } from "vitest";
import { cutName, sheetDrawings, sheetsOf, type Command, type Document } from "@fm/domain";
import { LOFT_ROOM_LOFT, clearRoomDoc, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The right panel's settings and the framing drag (sheetset.15, .17, .24; AC-04, AC-05, AC-06): each a command through the
// ordinary history, one undo step, with the note and its shortcuts worked out from the same test as the list's.

const FIRST = "auto/0";
const SECOND = "auto/1";
const NIGHT = "n/s0";
const addNight: Command = { type: "addState", opId: "n", name: "Night" };

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
function rowOf(shell: FakeShell, id = FIRST) {
  const row = sheets(shell).sheets.find((s) => s.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}
function stored(shell: FakeShell, id = FIRST) {
  const sheet = sheetsOf(shell.doc()).find((s) => s.id === id);
  if (!sheet) throw new Error(`no sheet ${id}`);
  return sheet;
}
const firstLayoutId = (doc: Document): string => {
  const id = sheetDrawings(sheetsOf(doc)[0] ?? fail())[0]?.layout;
  return id ?? fail();
};
function fail(): never {
  throw new Error("no sheet");
}
/** One step: it undoes in one, and the document goes back to just what it was. */
function expectOneStep(shell: FakeShell, act: () => void): void {
  const before = shell.doc();
  act();
  expect(shell.doc()).not.toEqual(before);
  shell.key("z", { meta: true });
  expect(shell.doc()).toEqual(before);
  shell.key("z", { meta: true, shift: true });
  expect(shell.doc()).not.toEqual(before);
  shell.key("z", { meta: true });
}
const setPaper = (shell: FakeShell, paper: string): void => shell.ui({ type: "setSheetSetting", key: "paper", value: paper });
const setGeneral = (shell: FakeShell, scale: string): void => shell.ui({ type: "setSheetSetting", key: "generalScale", value: scale });
const setScale = (shell: FakeShell, scale: number | null, id = FIRST): void => shell.ui({ type: "setSheet", id, fields: { scale } });
const dayNight = (): Document => withCommands(roomDoc(), addNight);
// The clear floor plus two whole walls: 7.2 m wide, as in AC-06.
const sevenMetres = (): Document => clearRoomDoc(6.8, 2.8, "r");

describe("a sheet's settings are commands (AC-03)", () => {
  it("a sheet's layout, level, finishes and scale are commands, each one undo step", () => {
    const shell = opened(withCommands(loftRoomDoc(), addNight));
    expectOneStep(shell, () => shell.ui({ type: "setSheetDrawing", id: FIRST, layout: NIGHT, deck: null }));
    expectOneStep(shell, () => shell.ui({ type: "setSheetDrawing", id: FIRST, layout: firstLayoutId(shell.doc()), deck: LOFT_ROOM_LOFT }));
    expectOneStep(shell, () => shell.ui({ type: "setSheet", id: FIRST, fields: { finishes: false } }));
    expectOneStep(shell, () => setScale(shell, 20));
    shell.ui({ type: "setSheetDrawing", id: FIRST, layout: NIGHT, deck: LOFT_ROOM_LOFT });
    expect(sheetDrawings(stored(shell))).toEqual([{ layout: NIGHT, deck: LOFT_ROOM_LOFT }]);
  });

  it("a row carries what the panel shows", () => {
    const shell = opened(dayNight());
    expect(rowOf(shell)).toMatchObject({ drawing: { layout: firstLayoutId(shell.doc()), deck: null }, split: "auto", finishes: true, text: "", size: "normal", centred: true });
    shell.ui({ type: "setSheet", id: SECOND, fields: { finishes: false, cx: 0.5 } });
    expect(rowOf(shell, SECOND)).toMatchObject({ drawing: { layout: NIGHT, deck: null }, finishes: false, centred: false });
  });

  it("a report has no drawing to choose and no scale to pick", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "addSheet", kind: "report" });
    const report = sheets(shell).sheets.find((s) => s.kind === "report");
    expect(report).toMatchObject({ drawing: null, scales: [], shortcuts: null, partOfPlan: false });
  });

  it("the panel lists every layout, in order", () => {
    const shell = opened(withCommands(dayNight(), { type: "renameState", stateId: NIGHT, name: "Guests" }));
    expect(sheets(shell).layouts.map((l) => l.name)).toHaveLength(2);
    expect(sheets(shell).layouts[1]).toEqual({ id: NIGHT, name: "Guests" });
  });

  it("a title is a rename: one step, and cut to what a name holds", () => {
    const shell = opened(roomDoc());
    expectOneStep(shell, () => shell.ui({ type: "renameSheet", id: FIRST, title: "Bedroom detail" }));
    const long = "x".repeat(5000);
    shell.ui({ type: "renameSheet", id: FIRST, title: long });
    expect(stored(shell).title).toBe(cutName(long));
    expect(stored(shell).title.length).toBeLessThan(long.length);
  });

  it("a blank title keeps the one it had: a row with no name can't be told from another", () => {
    const shell = opened(roomDoc());
    const before = shell.doc();
    shell.ui({ type: "renameSheet", id: FIRST, title: "   " });
    expect(shell.doc()).toBe(before);
    expect(shell.view().canUndo).toBe(false);
  });

  it("a title that names its drawing follows a change of layout or level; one of the user's own stays", () => {
    const shell = opened(withCommands(loftRoomDoc(), addNight));
    const { title: day } = stored(shell);
    shell.ui({ type: "setSheetDrawing", id: FIRST, layout: NIGHT, deck: null });
    expect(stored(shell).title).toBe("Night");
    shell.ui({ type: "setSheetDrawing", id: FIRST, layout: NIGHT, deck: LOFT_ROOM_LOFT });
    expect(stored(shell).title).toContain("Night · ");
    shell.key("z", { meta: true });
    shell.key("z", { meta: true });
    expect(stored(shell).title).toBe(day); // undone in the same step

    shell.ui({ type: "renameSheet", id: FIRST, title: "Bedroom detail" });
    shell.ui({ type: "setSheetDrawing", id: FIRST, layout: NIGHT, deck: null });
    expect(stored(shell).title).toBe("Bedroom detail");
  });
});

describe("General follows the set; an own scale doesn't (AC-04)", () => {
  it("General follows the set; an own scale doesn't: changing the general scale moves only following sheets", () => {
    const shell = opened(dayNight());
    setScale(shell, 20);
    setGeneral(shell, "100");
    expect(rowOf(shell, FIRST)).toMatchObject({ scale: 20, ownScale: true });
    expect(rowOf(shell, SECOND)).toMatchObject({ scale: 100, ownScale: false });
    setGeneral(shell, "200");
    expect(rowOf(shell, FIRST).scale).toBe(20);
    expect(rowOf(shell, SECOND).scale).toBe(200);
    setScale(shell, null); // General again
    expect(stored(shell).scale).toBeNull();
    expect(rowOf(shell, FIRST)).toMatchObject({ scale: 200, ownScale: false });
  });
});

describe("Level (AC-05)", () => {
  it("Level lists the floor and every loft", () => {
    const shell = opened(loftRoomDoc());
    const [floor, loft, ...rest] = sheets(shell).levels;
    expect(floor).toEqual({ deck: null, label: "Floor" });
    expect(loft?.deck).toBe(LOFT_ROOM_LOFT);
    expect(loft?.label).toMatch(/\+\d\.\d\d$/); // its height, as the level strip shows it
    expect(rest).toEqual([]);
    expect(rowOf(shell).drawing?.deck).toBeNull();
    shell.ui({ type: "setSheetDrawing", id: FIRST, layout: firstLayoutId(shell.doc()), deck: LOFT_ROOM_LOFT });
    expect(rowOf(shell).drawing?.deck).toBe(LOFT_ROOM_LOFT);
  });

  it("a house with no loft lists the floor alone", () => {
    expect(sheets(opened(roomDoc())).levels).toEqual([{ deck: null, label: "Floor" }]);
  });
});

describe("the scale grid (AC-04, AC-06)", () => {
  const dots = (shell: FakeShell): Record<string, boolean> => Object.fromEntries(rowOf(shell).scales.map((c) => [c.label, c.nofit]));

  it("the scale grid marks those where the whole plan doesn't fit, and picking one is allowed", () => {
    const shell = opened(roomDoc()); // 6.2 m on A4: a frame of 207 mm inside its inset, so 1:50 is the first to hold it
    expect(rowOf(shell).scales.map((c) => [c.scale, c.label])).toEqual([[null, "General"], [20, "1:20"], [25, "1:25"], [50, "1:50"], [75, "1:75"], [100, "1:100"], [200, "1:200"]]);
    expect(dots(shell)).toEqual({ General: false, "1:20": true, "1:25": true, "1:50": false, "1:75": false, "1:100": false, "1:200": false });
    setScale(shell, 20);
    expect(stored(shell).scale).toBe(20);
    expect(rowOf(shell).partOfPlan).toBe(true);
    expect(sheets(shell).canSave).toBe(true);
  });

  it("a dot is what picking that scale and centring would show, on any paper", () => {
    for (const paper of ["A4", "A3", "Letter"]) {
      const shell = opened(sevenMetres());
      setPaper(shell, paper);
      for (const { scale, nofit } of rowOf(shell).scales) {
        const probe = opened(sevenMetres());
        setPaper(probe, paper);
        setScale(probe, scale);
        expect(rowOf(probe).partOfPlan, `${paper} 1:${scale}`).toBe(nofit);
      }
    }
  });

  it("a dot is about the scale, not where the sheet is framed", () => {
    const shell = opened(roomDoc());
    const before = dots(shell);
    shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 4 } });
    expect(dots(shell)).toEqual(before);
  });

  it("General carries a dot when the general scale doesn't hold it", () => {
    const shell = opened(roomDoc());
    setGeneral(shell, "20");
    expect(dots(shell)["General"]).toBe(true);
  });
});

describe("the note and its shortcuts (AC-06)", () => {
  it("the note appears and goes with the test: A4, 1:20 shows it", () => {
    const shell = opened(sevenMetres());
    setPaper(shell, "A3");
    setScale(shell, 25);
    expect(rowOf(shell)).toMatchObject({ partOfPlan: false, shortcuts: null }); // AC-06's plan at 1:25 on A3
    setPaper(shell, "A4");
    setScale(shell, 20);
    expect(rowOf(shell)).toMatchObject({ partOfPlan: true, shortcuts: { centre: false, fit: 50, paper: "A2" } }); // 360 mm: A3's 315 doesn't hold it
    setScale(shell, 50);
    expect(rowOf(shell)).toMatchObject({ partOfPlan: false, shortcuts: null });
  });

  it('a framing past the edge shows it, with "Centre it" only when centring fixes it', () => {
    const shell = opened(sevenMetres());
    setPaper(shell, "A3");
    setScale(shell, 25);
    shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 3 } });
    expect(rowOf(shell)).toMatchObject({ partOfPlan: true, shortcuts: { centre: true, fit: null, paper: null } });
    setScale(shell, 20); // centring no longer fixes it
    expect(rowOf(shell).shortcuts).toEqual({ centre: false, fit: 25, paper: "A2" });
    setScale(shell, 25);
    shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 0, cy: 0 } });
    expect(rowOf(shell)).toMatchObject({ partOfPlan: false, shortcuts: null });
  });

  it('"Fit the whole plan" sets the sheet\'s scale and centres, one undo step', () => {
    const shell = opened(sevenMetres());
    shell.ui({ type: "setSheet", id: FIRST, fields: { scale: 20, cx: 1, cy: 0.5 } });
    const fit = rowOf(shell).shortcuts?.fit;
    expect(fit).toBe(50);
    expectOneStep(shell, () => shell.ui({ type: "setSheet", id: FIRST, fields: { scale: fit ?? null, cx: 0, cy: 0 } }));
    shell.ui({ type: "setSheet", id: FIRST, fields: { scale: fit ?? null, cx: 0, cy: 0 } });
    expect(rowOf(shell)).toMatchObject({ partOfPlan: false, scale: 50, centred: true });
  });

  it('"Use A2" sets the set\'s paper, one undo step', () => {
    const shell = opened(sevenMetres());
    setScale(shell, 20);
    expectOneStep(shell, () => setPaper(shell, "A2"));
    setPaper(shell, "A2");
    expect(sheets(shell).paper).toBe("A2");
    expect(rowOf(shell)).toMatchObject({ partOfPlan: false, scale: 20 });
  });

  it("offers no scale when none holds it, and no paper past the largest", () => {
    const shell = opened(clearRoomDoc(60, 40, "r")); // 60 m at 1:200 is 301 mm: too wide for A4, not for A3
    setScale(shell, 200);
    expect(rowOf(shell).shortcuts).toEqual({ centre: false, fit: null, paper: "A3" });
    setPaper(shell, "A1");
    setScale(shell, 20); // 3 m of paper
    expect(rowOf(shell).shortcuts).toEqual({ centre: false, fit: 100, paper: null });
  });

  it("the next paper up goes by size: A4 is up from a Letter, and a Letter isn't up from an A4", () => {
    const wide = opened(clearRoomDoc(3.6, 1, "r")); // 4 m at 1:20 is 200 mm: A4's 207 holds it, a Letter's 189 doesn't
    setPaper(wide, "Letter");
    setScale(wide, 20);
    expect(rowOf(wide).shortcuts?.paper).toBe("A4");
    const square = opened(clearRoomDoc(3.3, 3.3, "r")); // 185 mm square: a Letter's 189 × 185.9 holds it, A4's 207 × 180 doesn't
    setPaper(square, "A4");
    setScale(square, 20);
    expect(rowOf(square).shortcuts?.paper).toBe("A3");
  });

  it("Save PDF stays enabled with a note showing", () => {
    const shell = opened(roomDoc());
    setScale(shell, 20);
    expect(rowOf(shell).partOfPlan).toBe(true);
    expect(sheets(shell)).toMatchObject({ canSave: true, saveReason: null });
    shell.ui({ type: "download", format: "pdf" });
    expect(shell.effectsOf("saveFile")).toHaveLength(1);
  });
});

describe("framing by drag (AC-05)", () => {
  // Page pixels at a screen zoom, as the desk draws them at 2 px per mm: the shell's half of a press, move and release.
  const release = (shell: FakeShell, px: { x: number; y: number }, zoom: number): void => {
    const pxPerMm = 2 * zoom;
    shell.ui({ type: "frameSheet", id: FIRST, dxMm: px.x / pxPerMm, dyMm: -px.y / pxPerMm }); // a screen's y runs down, a page's up
  };

  it("a drag commits once, on release, in metres, one undo step", () => {
    const shell = opened(roomDoc());
    setScale(shell, 20);
    expectOneStep(shell, () => release(shell, { x: 100, y: 0 }, 1));
    release(shell, { x: 100, y: 0 }, 1);
    expect([stored(shell).cx, stored(shell).cy]).toEqual([-1, 0]); // 50 mm on paper at 1:20; the plan moved right, so its centre lies left
    expect(rowOf(shell).centred).toBe(false);
  });

  it.each([
    [20, 1, -1],
    [100, 5, -5],
  ])("at 1:%i a 50 mm drag is %f m, at every screen zoom", (scale, metres, cx) => {
    for (const zoom of [0.5, 0.75, 1, 1.33, 2]) {
      const shell = opened(roomDoc());
      setScale(shell, scale);
      release(shell, { x: 100 * zoom, y: 0 }, zoom); // the same 50 mm of paper is more pixels at a larger zoom
      expect(stored(shell).cx).toBeCloseTo(cx, 6);
      expect(Math.abs(stored(shell).cx)).toBeCloseTo(metres, 6);
    }
  });

  it("a drag down moves the plan down, so the centre goes up", () => {
    const shell = opened(roomDoc());
    setScale(shell, 100);
    release(shell, { x: 0, y: 20 }, 1);
    expect(stored(shell).cy).toBeCloseTo(1, 6);
  });

  it("it goes on from where the sheet was framed", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheet", id: FIRST, fields: { scale: 100, cx: 0.25 } });
    release(shell, { x: 20, y: 0 }, 1);
    expect(stored(shell).cx).toBeCloseTo(-0.75, 6);
  });

  it("a sheet following the general scale measures at that scale", () => {
    const shell = opened(roomDoc());
    setGeneral(shell, "75");
    release(shell, { x: 40, y: 0 }, 1); // 20 mm
    expect(stored(shell).cx).toBeCloseTo(-1.5, 6);
    setGeneral(shell, "");
    release(shell, { x: 40, y: 0 }, 1); // Fit, 1:50
    expect(stored(shell).cx).toBeCloseTo(-2.5, 6);
  });

  it("stores the millimetre, so a screen's fractions don't reach the file", () => {
    const shell = opened(roomDoc());
    setScale(shell, 75);
    release(shell, { x: 1, y: 1 }, 1.33);
    expect(stored(shell).cx * 1000).toBe(Math.round(stored(shell).cx * 1000));
    expect(stored(shell).cy * 1000).toBe(Math.round(stored(shell).cy * 1000));
  });

  it("the framing survives a scale change", () => {
    const shell = opened(roomDoc());
    setScale(shell, 20);
    release(shell, { x: 100, y: 0 }, 1);
    setScale(shell, 100);
    expect(stored(shell).cx).toBe(-1);
  });

  it("a drag that ends where it began is no edit", () => {
    const shell = opened(roomDoc());
    const before = shell.doc();
    release(shell, { x: 0, y: 0 }, 1);
    expect(shell.doc()).toBe(before);
    expect(shell.view().canUndo).toBe(false);
  });

  it("a sheet that's gone is no edit and no crash", () => {
    const shell = opened(roomDoc());
    const before = shell.doc();
    shell.ui({ type: "frameSheet", id: "gone", dxMm: 5, dyMm: 5 });
    expect(shell.doc()).toBe(before);
  });

  it("Centre resets the framing", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 1.5, cy: -0.5 } });
    expect(rowOf(shell)).toMatchObject({ centred: false, partOfPlan: false });
    expectOneStep(shell, () => shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 0, cy: 0 } }));
    shell.ui({ type: "setSheet", id: FIRST, fields: { cx: 0, cy: 0 } });
    expect([stored(shell).cx, stored(shell).cy]).toEqual([0, 0]);
    expect(rowOf(shell).centred).toBe(true);
  });

  it("selection and zoom aren't stored: selecting isn't undone", () => {
    const shell = opened(dayNight());
    release(shell, { x: 40, y: 0 }, 1);
    shell.ui({ type: "selectSheet", id: SECOND });
    shell.key("z", { meta: true });
    expect(sheets(shell).selected).toBe(SECOND);
  });
});
