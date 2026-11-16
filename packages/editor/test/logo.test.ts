import { describe, expect, it } from "vitest";
import { LOGO_ID, PAPER_NAMES, PROJECT_FIELDS, STUDIO_FIELDS, sheetsOf, type Command, type Document, type PaperName } from "@fm/domain";
import { coverParts } from "../src/export/page-cover";
import { MARGIN_MM, columnMm } from "../src/export/paper";
import { pagesOf, sheetFacts, sheetPages, sheetSet, type SheetPage } from "../src/export/sheet";
import type { UnderlayImport } from "../src/ports/events";
import { UNDERLAY_REFUSALS } from "../src/underlay";
import { clearRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeHost, FakeShell } from "./fake-shell";

// The studio's logo on paper (sheetset.18, .21; AC-13): in the column's top box and on the cover, as a page image, the
// same bytes on every page of the file. A wide and a tall picture, so a swapped width and height shows.

const JPEG = "/9j/4AAQSkZJRgABAQ";
const set = (width = 600, height = 200, data = JPEG): Command => ({ type: "setLogo", data, width, height });
const studio: Command = { type: "setProjectField", key: "studioName", value: "Atelier Bruni" };
const coverSheet: Command = { type: "addSheet", opId: "c", after: null, kind: "cover", title: "Cover", drawings: [{ layout: "s0", deck: null }] };
const reportSheet: Command = { type: "addSheet", opId: "r", after: null, kind: "report", title: "Report", drawings: [], text: "Words ".repeat(3000) };
const compareSheet: Command[] = [{ type: "addState", opId: "n", name: "Night" }, { type: "addSheet", opId: "co", after: null, kind: "compare", title: "Compare", drawings: [{ layout: "s0", deck: null }, { layout: "n/s0", deck: null }] }];

function host(): FakeHost {
  const h = new FakeHost();
  h.today = () => "2026-10-13";
  return h;
}
const pages = (doc: Document, paper: PaperName = "A4"): SheetPage[] => sheetPages(doc, { projectName: "Flat", paper, scale: 50, host: host(), finishes: true }).pages;
const first = (doc: Document, paper: PaperName = "A4"): SheetPage => {
  const [page] = pages(doc, paper);
  if (!page) throw new Error("no page");
  return page;
};
const texts = (page: SheetPage) => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const atText = (page: SheetPage, value: string) => {
  const t = texts(page).find((p) => p.text === value);
  if (!t) throw new Error(`no ${value}`);
  return t;
};
const imageOf = (page: SheetPage) => {
  const [image, ...more] = page.images ?? [];
  expect(more).toEqual([]);
  if (!image) throw new Error("no image");
  return image;
};

describe("it sits in the column's top box, and the column's stacks make room", () => {
  it("no logo, no image, and the page doesn't name one", () => {
    expect(first(roomDoc())).not.toHaveProperty("images");
  });

  it("at the column's top left, in the JPEG's own bytes", () => {
    const page = first(withCommands(roomDoc(), set()));
    const { rect, jpeg } = imageOf(page);
    expect(jpeg).toBe(JPEG);
    const left = page.widthMm - MARGIN_MM - columnMm("A4");
    expect(rect.x).toBeCloseTo(left + 4, 6);
    expect(rect.y + rect.h).toBeCloseTo(page.heightMm - MARGIN_MM - 3, 6);
  });

  it.each([
    ["wide", 600, 200, 30, 10],
    ["very wide, held by the column's width", 600, 60, 52, 5.2],
    ["tall", 100, 600, 10 / 6, 10],
    ["square", 300, 300, 10, 10],
    ["small: pixels don't matter, the box does", 10, 5, 20, 10],
  ])("%s keeps its shape", (_, width, height, w, h) => {
    const { rect } = imageOf(first(withCommands(roomDoc(), set(width, height))));
    expect(rect.w).toBeCloseTo(w, 6);
    expect(rect.h).toBeCloseTo(h, 6);
  });

  it("the project's name moves down by what it takes, and the foot stays", () => {
    const without = first(roomDoc());
    const withLogo = first(withCommands(roomDoc(), set()));
    expect(atText(without, "Flat").at.y - atText(withLogo, "Flat").at.y).toBeCloseTo(10 + 3 + 5, 6); // the gap and rule the letterhead brings
    expect(atText(withLogo, "Flat").at.y).toBeLessThan(imageOf(withLogo).rect.y);
    expect(atText(withLogo, "A4").at.y).toBeCloseTo(atText(without, "A4").at.y, 9);
  });

  it("the studio's name sits under it, not on it", () => {
    const page = first(withCommands(roomDoc(), studio, set()));
    const name = atText(page, "Atelier Bruni");
    expect(name.at.y + name.size / 2).toBeLessThan(imageOf(page).rect.y);
    const without = first(withCommands(roomDoc(), studio));
    expect(atText(without, "Atelier Bruni").at.y - name.at.y).toBeCloseTo(10 + 1.5, 6);
  });

  it("it stays inside the column on every paper, either way up", () => {
    for (const paper of PAPER_NAMES) {
      for (const logo of [set(600, 60), set(60, 600)]) {
        const page = first(withCommands(roomDoc(), logo), paper);
        const { rect } = imageOf(page);
        const left = page.widthMm - MARGIN_MM - columnMm(paper);
        expect(rect.x).toBeGreaterThanOrEqual(left);
        expect(rect.x + rect.w).toBeLessThanOrEqual(left + columnMm(paper) - 4 + 1e-9);
        expect(rect.y + rect.h).toBeLessThanOrEqual(page.heightMm - MARGIN_MM);
      }
    }
  });

  it("a logo can tip a full column into dropping its rooms table, and the status says so", () => {
    const wide = withCommands(clearRoomDoc(12, 4, "wide"), { type: "labelZone", id: "L", at: { x: 1, y: 1 }, name: "Room", finish: null }); // landscape, so the column is its shortest
    const opts = { projectName: "A project name long enough to wrap ".repeat(3), paper: "A4" as const, scale: 50, host: host(), finishes: true };
    const filled = (count: number): Document => withCommands(wide, ...[...PROJECT_FIELDS, ...STUDIO_FIELDS].slice(0, count).map((f): Command => ({ type: "setProjectField", key: f.key, value: "Field value long enough to wrap ".repeat(20).slice(0, f.maxLength) })));
    const counts = Array.from({ length: PROJECT_FIELDS.length + STUDIO_FIELDS.length + 1 }, (_, i) => i);
    const tipped = counts.find((n) => !sheetSet(filled(n), opts).columnFull && sheetSet(withCommands(filled(n), set(300, 300)), opts).columnFull);
    expect(tipped).toEqual(expect.any(Number));
  });

  it("on every page with a column: plan, compare, and each of a report's", () => {
    const doc = withCommands(roomDoc(), ...compareSheet, reportSheet, set());
    const all = pages(doc);
    expect(all.length).toBeGreaterThan(3); // the report takes more than a page
    for (const page of all) expect(imageOf(page).jpeg).toBe(JPEG);
  });

  it("the PNG's plan alone never has one", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), set()));
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "png" });
    const pictures = shell.effectsOf("rasterise");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.page).not.toHaveProperty("images");
  });
});

describe("on the cover too", () => {
  const cover = (...more: Command[]): SheetPage => {
    const page = pages(withCommands(roomDoc(), coverSheet, ...more)).find((p) => texts(p).some((t) => t.text === "DRAWINGS"));
    if (!page) throw new Error("no cover");
    return page;
  };

  it("no logo, no image", () => {
    expect(cover()).not.toHaveProperty("images");
  });

  it("in the tint, at its top, with what's below moved down by it", () => {
    const page = cover(set());
    const { rect, jpeg } = imageOf(page);
    expect(jpeg).toBe(JPEG);
    const { column } = coverParts({ w: page.widthMm, h: page.heightMm });
    expect(rect.x).toBeGreaterThan(column.x);
    expect(rect.x + rect.w).toBeLessThan(column.x + column.w);
    expect(rect.y + rect.h).toBeLessThan(column.y + column.h);
    const label = atText(page, "DRAWINGS");
    expect(label.at.y + label.size / 2).toBeLessThan(rect.y);
    expect(atText(cover(), "DRAWINGS").at.y - label.at.y).toBeCloseTo(rect.h + 3, 6);
    expect(rect.h).toBeCloseTo(16, 6);
  });

  it("the index still fits above the foot, and no text leaves the page", () => {
    const page = cover(set(), studio);
    const lowest = Math.min(...texts(page).map((t) => t.at.y));
    expect(lowest).toBeGreaterThan(0);
    const index = atText(page, "SHEET INDEX");
    expect(index.at.y).toBeLessThan(imageOf(page).rect.y);
  });

  it("a very wide one is held by the column's width", () => {
    const page = cover(set(600, 30));
    const { rect } = imageOf(page);
    const { column } = coverParts({ w: page.widthMm, h: page.heightMm });
    expect(rect.w).toBeLessThanOrEqual(column.w);
    expect(rect.h / rect.w).toBeCloseTo(30 / 600, 6);
  });
});

describe("kept pages and what doesn't read it", () => {
  it("a document's pages stay one object, and a new logo draws new ones", () => {
    const doc = withCommands(roomDoc(), set());
    const opts = { projectName: "Flat", paper: "A4" as const, scale: 50, host: host(), finishes: true };
    const [sheet] = sheetsOf(doc);
    if (!sheet) throw new Error("no sheet");
    const kept = pagesOf(doc, sheet, sheetSet(doc, opts));
    expect(pagesOf(doc, sheet, sheetSet(doc, opts))).toBe(kept);
    const [page] = kept;
    if (!page) throw new Error("no page");
    const again = withCommands(doc, set(100, 400));
    expect(imageOf(first(again)).rect.h).toBeCloseTo(10, 6);
    expect(imageOf(page).rect.w).not.toBeCloseTo(imageOf(first(again)).rect.w, 3);
  });

  it("what a sheet prints for a reader with no pages doesn't change", () => {
    const doc = withCommands(roomDoc(), coverSheet);
    expect(sheetFacts(withCommands(doc, set()))).toEqual(sheetFacts(doc));
  });
});

describe("choosing one (AC-13)", () => {
  const picture = (width: number, height: number, data = JPEG): UnderlayImport => ({ ok: true, data, width, height });
  const opened = (): FakeShell => FakeShell.withDocument(roomDoc());

  it("a chosen picture is the row, one undo step, and Remove is another", () => {
    const shell = opened();
    expect(shell.view().logo).toEqual({ present: false, canEdit: true });
    shell.ui({ type: "importLogo", result: picture(600, 200) });
    expect(shell.doc().logos).toEqual({ [LOGO_ID]: { id: LOGO_ID, data: JPEG, width: 600, height: 200 } });
    expect(shell.view().logo).toEqual({ present: true, canEdit: true });
    shell.ui({ type: "removeLogo" });
    expect(shell.doc().logos).toEqual({});
    shell.ui({ type: "undo" });
    expect(Object.keys(shell.doc().logos)).toEqual([LOGO_ID]);
    shell.ui({ type: "undo" });
    expect(shell.doc().logos).toEqual({});
    shell.ui({ type: "redo" });
    expect(Object.keys(shell.doc().logos)).toEqual([LOGO_ID]);
  });

  it("the plan and the underlay's section stay as they were", () => {
    const shell = opened();
    const camera = shell.state.camera;
    shell.ui({ type: "importLogo", result: picture(600, 200) });
    expect(shell.state.camera).toBe(camera);
    expect(shell.doc().underlays).toEqual({});
    expect(shell.view().underlay?.present).toBe(false);
  });

  it.each(["unsupported", "unreadable", "tooLarge"] as const)("a refusal, %s, reads as the underlay's and changes nothing", (reason) => {
    const shell = opened();
    shell.ui({ type: "importLogo", result: { ok: false, reason } });
    expect(shell.view().toast).toBe(UNDERLAY_REFUSALS[reason]);
    expect(shell.doc().logos).toEqual({});
  });

  it("what the domain refuses is a toast in its words", () => {
    const shell = opened();
    shell.ui({ type: "importLogo", result: picture(600, 200, "iVBORw0KGgo") });
    expect(shell.view().toast).toBe("The logo picture can't be stored");
    expect(shell.doc().logos).toEqual({});
  });

  it("with a selection it isn't offered, as Project isn't", () => {
    const shell = opened();
    const [wall] = Object.keys(shell.doc().walls);
    if (!wall) throw new Error("no wall");
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wall } });
    expect(shell.view().logo).toBeNull();
  });

  it("no view ever holds the bytes: React gets every one", () => {
    const shell = opened();
    shell.ui({ type: "importLogo", result: picture(600, 200) });
    expect(JSON.stringify(shell.view())).not.toContain(JPEG);
    shell.ui({ type: "openExport" });
    expect(JSON.stringify(shell.view())).not.toContain(JPEG);
  });

  it("a page in the sheets view shows it as soon as it's chosen", () => {
    const shell = opened();
    shell.ui({ type: "openExport" });
    const page = () => shell.view().sheetsView?.sheets[0]?.pages()[0];
    expect(page()).not.toHaveProperty("images");
    shell.ui({ type: "importLogo", result: picture(600, 200) });
    expect(page()?.images?.[0]?.jpeg).toBe(JPEG);
  });

  it("the put expects the row's version, so two people choosing at once clash", () => {
    const remote = FakeRemote.open(roomDoc());
    remote.shell.ui({ type: "importLogo", result: picture(600, 200) });
    const { patch, expect: expected } = remote.last();
    expect(patch.puts.map((p) => ({ table: p.table, id: p.entity.id }))).toEqual([{ table: "logos", id: LOGO_ID }]);
    expect(expected).toContainEqual(expect.objectContaining({ table: "logos", id: LOGO_ID }));
  });
});
