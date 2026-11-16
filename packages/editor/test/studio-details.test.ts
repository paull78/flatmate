import { describe, expect, it } from "vitest";
import { PROJECT_FIELDS, emptyDocument, rectangleRoom, sheetSetAccent, validateDocument, type Command, type Document } from "@fm/domain";
import { helveticaWidth } from "../src/export/helvetica";
import { MARGIN_MM, columnMm } from "../src/export/paper";
import { sheetPages, type SheetPage } from "../src/export/sheet";
import { PRESENTATION_STYLE, planPicture, presentationStyle } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeHost, FakeShell } from "./fake-shell";

// Studio details, the date of issue and the accent (sheetset.18, .21; AC-13): stored in the project, so every client
// prints the same. None of them is a title block field, so a project without them prints as it did.
//
//   +----------------+
//   | Studio name    |  accent
//   | address        |
//   | contact        |
//   |----------------|
//   | Project name   |
//   | fields, rooms  |

const CUSTOM = "#0a7d55";
const field = (key: string, value: string): Command => ({ type: "setProjectField", key, value });
const STUDIO: Command[] = [field("studioName", "Atelier Bruni"), field("studioAddress", "Via Roma 1, Milano"), field("studioContact", "ciao@bruni.example")];
const accent = (value: string): Command => field("accent", value);

function hostOn(today: string): FakeHost {
  const h = new FakeHost();
  h.today = () => today;
  return h;
}
const pages = (doc: Document, today = "2026-10-13"): SheetPage[] => sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host: hostOn(today), finishes: true }).pages;
const firstPage = (doc: Document, today?: string): SheetPage => {
  const [page] = pages(doc, today);
  if (!page) throw new Error("no page");
  return page;
};
type Text = Extract<Primitive, { kind: "text" }>;
const texts = (page: SheetPage): Text[] => page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
const words = (page: SheetPage): string[] => texts(page).map((t) => t.text);
const columnLeft = (page: SheetPage): number => page.widthMm - MARGIN_MM - columnMm("A4");
const inColumn = (page: SheetPage): Text[] => texts(page).filter((t) => t.at.x >= columnLeft(page));
const textOf = (page: SheetPage, text: string): Text => {
  const found = texts(page).find((t) => t.text === text);
  if (!found) throw new Error(`no "${text}" in ${words(page).join(" | ")}`);
  return found;
};
const opened = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  return shell;
};
const view = (shell: FakeShell) => {
  const v = shell.view().sheetsView;
  if (!v) throw new Error("the view isn't open");
  return v;
};
const savedPages = (shell: FakeShell): readonly SheetPage[] => {
  shell.ui({ type: "download", format: "pdf" });
  const save = shell.effectsOf("saveFile").at(-1);
  if (save?.content.kind !== "pdf") throw new Error("not a pdf");
  return save.content.pages;
};
const NIGHT: Command = { type: "addState", opId: "n", name: "Night" };
const labelled = (): Document => withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 2, y: 2 }, name: "Studio", finish: null });

describe("details print in the column, for all clients (AC-13)", () => {
  it("a second client's page prints what the first stored", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.ui({ type: "openExport" });
    for (const command of STUDIO) r.remote(command);
    const shown = view(r.shell).sheets[0]?.pages()[0];
    if (!shown) throw new Error("no page");
    const printed = words(shown);
    for (const value of ["Atelier Bruni", "Via Roma 1, Milano", "ciao@bruni.example"]) expect(printed).toContain(value);
  });

  it("the same document and date print the same pages, whoever saves them", () => {
    const doc = withCommands(roomDoc(), ...STUDIO, field("issueDate", "1 May 2026"), accent(CUSTOM));
    expect(pages(doc, "2026-10-13")).toEqual(pages(doc, "2031-01-01"));
  });

  it("sit in the top box, above the project name", () => {
    const page = firstPage(withCommands(roomDoc(), ...STUDIO));
    const ys = ["Atelier Bruni", "Via Roma 1, Milano", "ciao@bruni.example", "Flat"].map((t) => textOf(page, t).at.y);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    expect(textOf(page, "Atelier Bruni").at.x).toBeGreaterThanOrEqual(columnLeft(page));
  });

  it("no studio details: nothing above the project name, and a date of issue moves nothing", () => {
    const page = firstPage(roomDoc());
    expect(textOf(page, "Flat").at.y).toBeCloseTo(page.heightMm - MARGIN_MM - 3 - (5.5 * 1.3) / 2, 9);
    expect(firstPage(withCommands(roomDoc(), field("issueDate", "2026-10-13")))).toEqual(page);
  });

  it("a long one ends in … and stays in the column", () => {
    const long = "A studio with a very long name that goes on and on and on, past where it fits".slice(0, 80);
    const page = firstPage(withCommands(roomDoc(), field("studioName", long), field("studioAddress", long), field("studioContact", long)));
    const right = page.widthMm - MARGIN_MM;
    const details = inColumn(page).filter((t) => long.startsWith(t.text.replace(/…$/, "")) || long.includes(t.text.replace(/…$/, "")));
    expect(details.length).toBeGreaterThanOrEqual(3);
    for (const t of details) expect(t.at.x + helveticaWidth(t.text, t.size)).toBeLessThanOrEqual(right);
    expect(details.some((t) => t.text.endsWith("…"))).toBe(true);
  });

  it("a column they fill takes the rooms table away and the status notes it; the page still saves", () => {
    const fields = PROJECT_FIELDS.map((f) => field(f.key, "Field value long enough to wrap ".repeat(3).slice(0, f.maxLength)));
    const long = "Studio detail long enough to wrap over two lines, cut with an ellipsis at the end".slice(0, 80);
    const rooms: Command[] = [...Array(5).keys()].flatMap((i): Command[] => [
      ...(i > 0 ? [{ type: "addWall", opId: `d${i}`, from: { at: { x: i, y: 0 } }, to: { at: { x: i, y: 1 } } } satisfies Command] : []),
      { type: "labelZone", id: `L${i}`, at: { x: i + 0.5, y: 0.5 }, name: `R${i}`, finish: null },
    ]);
    const bare = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 5, 1, "row"), ...rooms, ...fields);
    const filled = withCommands(bare, field("studioName", long), field("studioAddress", long), field("studioContact", long));
    const set = (doc: Document) => sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host: hostOn("2026-10-13"), finishes: true });
    expect(set(bare).columnFull).toBe(false);
    expect(set(filled).columnFull).toBe(true);
    expect(set(filled).pages).toHaveLength(1);
    expect(view(opened(filled)).note).toMatch(/^Title block too full for A4/);
    expect(words(set(filled).pages[0] ?? firstPage(filled))).not.toContain("ROOM");
  });

  it("a character the PDF can't show warns, as the other fields do", () => {
    expect(view(opened(withCommands(roomDoc(), field("studioName", "工作室")))).warning).toMatch(/characters the PDF can't show/);
  });

  it("are typed in Project in Properties, undone like its other fields, and aren't title block fields", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const ids = (shell.view().projectFields ?? []).map((f) => f.id);
    for (const id of ["project.studioName", "project.studioAddress", "project.studioContact", "project.issueDate"]) expect(ids).toContain(id);
    shell.ui({ type: "setField", fieldId: "project.studioName", value: "Atelier Bruni" });
    expect(shell.doc().projectFields["studioName"]?.value).toBe("Atelier Bruni");
    expect(PROJECT_FIELDS).toHaveLength(9);
    expect(PROJECT_FIELDS.map((f) => f.key)).not.toContain("studioName");
    const printed = words(firstPage(shell.doc()));
    expect(printed.filter((t) => /studio name|STUDIO/.test(t))).toEqual([]); // no label: a letterhead, not a form
  });

  it("Project's date of issue says what a blank prints", () => {
    const fields = FakeShell.withDocument(roomDoc()).view().projectFields ?? [];
    expect(fields.find((f) => f.id === "project.issueDate")?.placeholder).toBe("Today");
    expect(fields.find((f) => f.id === "project.studioName")?.placeholder).toBeUndefined();
  });
});

describe("the date of issue (AC-13)", () => {
  it("a typed date prints as typed; blank prints today's", () => {
    const blank = firstPage(roomDoc(), "2026-10-13");
    expect(words(blank)).toContain("2026-10-13");
    const typed = firstPage(withCommands(roomDoc(), field("issueDate", "14 sept. 2026, rev B")), "2026-10-13");
    expect(words(typed)).toContain("14 sept. 2026, rev B");
    expect(words(typed)).not.toContain("2026-10-13");
  });

  it("clearing it goes back to today's", () => {
    const doc = withCommands(roomDoc(), field("issueDate", "1 May 2026"), field("issueDate", ""));
    expect(words(firstPage(doc, "2026-10-13"))).toContain("2026-10-13");
  });

  it("a date too long for its line ends in … and never reaches the paper's name", () => {
    const long = "the fourteenth day of September in the year two thousand and twenty-six".slice(0, 80);
    const page = firstPage(withCommands(roomDoc(), field("issueDate", long)));
    const paper = textOf(page, "A4");
    const date = texts(page).find((t) => t.at.y === paper.at.y && t !== paper);
    if (!date) throw new Error("no date");
    expect(date.text.endsWith("…")).toBe(true);
    expect(date.at.x - helveticaWidth(date.text, date.size)).toBeGreaterThan(paper.at.x + helveticaWidth("A4", paper.size));
  });
});

describe("the accent colours the name, cover band and title rule (AC-13)", () => {
  const doc = (): Document => withCommands(labelled(), ...STUDIO, NIGHT, accent(CUSTOM));
  const colored = (page: SheetPage, color: string): Primitive[] => page.primitives.filter((p) => p.color === color);

  it("pages hold the custom hex in the studio's name, the sheet number, the title's rule and the room tags, and none of the old one", () => {
    const page = firstPage(doc());
    expect(textOf(page, "Atelier Bruni").color).toBe(CUSTOM);
    expect(textOf(page, "Sheet 01 / 02").color).toBe(CUSTOM);
    expect(textOf(page, "Studio").color).toBe(CUSTOM); // the room's tag
    const rules = page.primitives.filter((p) => p.kind === "segment" && p.color === CUSTOM && "px" in p.width && p.width.px === 0.5);
    expect(rules).toHaveLength(1);
    expect(colored(page, PRESENTATION_STYLE.accent)).toEqual([]);
  });

  it("a cover's band takes the custom hex, and none of the old one", () => {
    const cover: Command = { type: "addSheet", opId: "c", after: null, kind: "cover", title: "Cover", drawings: [{ layout: "s0", deck: null }] };
    const printed = pages(withCommands(doc(), cover)).at(-1);
    if (!printed) throw new Error("no cover");
    const band = colored(printed, CUSTOM).filter((p) => p.kind === "polygon" && p.points.every((q) => q.x <= 2.5));
    expect(band).toHaveLength(1);
    expect(colored(printed, PRESENTATION_STYLE.accent)).toEqual([]);
  });

  it("the column's other text keeps its ink", () => {
    const page = firstPage(doc());
    expect(inColumn(page).filter((t) => t.color === CUSTOM).map((t) => t.text)).toEqual(["Atelier Bruni", "Sheet 01 / 02"]);
  });

  it("a compare page follows too, the same on each of its pages", () => {
    const compare: Command = { type: "addSheet", opId: "c", after: null, kind: "compare", title: "Compare", drawings: [{ layout: "s0", deck: null }, { layout: "n/s0", deck: null }] };
    const all = pages(withCommands(doc(), compare));
    expect(all).toHaveLength(3);
    for (const page of all) {
      expect(colored(page, CUSTOM).length).toBeGreaterThan(0);
      expect(colored(page, PRESENTATION_STYLE.accent)).toEqual([]);
    }
  });

  it("a dimension and a deck's label follow", () => {
    const d = withCommands(doc(), { type: "addDimension", opId: "m", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 }, { type: "addDeck", opId: "p", preset: "platform", at: { x: 4, y: 2 }, w: 2, d: 1.4 });
    const page = firstPage(d);
    expect(colored(page, CUSTOM).length).toBeGreaterThan(colored(firstPage(doc()), CUSTOM).length + 1);
    expect(colored(page, PRESENTATION_STYLE.accent)).toEqual([]);
  });

  it("a saved SVG follows", () => {
    const shell = opened(doc());
    shell.ui({ type: "download", format: "svg" });
    const save = shell.effectsOf("saveFile").at(-1);
    if (save?.content.kind !== "svg") throw new Error("no SVG");
    const tags = save.content.primitives.flatMap((p) => (p.kind === "text" ? [p.color] : []));
    expect(tags.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tags)).toEqual(new Set([CUSTOM]));
  });

  it("unset, the set prints in brick red", () => {
    expect(sheetSetAccent(roomDoc())).toBeNull();
    expect(presentationStyle(roomDoc())).toBe(PRESENTATION_STYLE);
    expect(view(opened(roomDoc())).accent).toBe(PRESENTATION_STYLE.accent);
  });

  it("the view offers four swatches and holds what's stored, a custom colour included", () => {
    const shell = opened(roomDoc());
    expect(view(shell).accents.map((a) => a.value)).toEqual(["#b3261e", "#1d4ed8", "#0f766e", "#1d1d1f"]);
    shell.ui({ type: "setSheetSetting", key: "accent", value: CUSTOM });
    expect(view(shell).accent).toBe(CUSTOM);
  });

  it("the same doc and accent reuse the derived style object and its layers", () => {
    const d = doc();
    expect(presentationStyle(d)).toBe(presentationStyle(d));
    const other = withCommands(d, field("client", "Rossi")); // another document, the same accent
    expect(presentationStyle(other)).toBe(presentationStyle(d));
    const picture = () => planPicture(d, floorView(d, "s0"), presentationStyle(d), 20, true);
    const [a, b] = [picture(), picture()];
    expect(a.walls.length).toBeGreaterThan(0);
    expect(a.tags.length).toBeGreaterThan(0);
    expect(b.walls).toBe(a.walls);
    expect(b.tags).toBe(a.tags);
  });

  it("a new accent rebuilds the layers, since it's in the document and they key on it", () => {
    const d = doc();
    const next = withCommands(d, accent("#123456"));
    expect(presentationStyle(next)).not.toBe(presentationStyle(d));
    const before = planPicture(d, floorView(d, "s0"), presentationStyle(d), 20, true).tags;
    const after = planPicture(next, floorView(next, "s0"), presentationStyle(next), 20, true).tags;
    expect(after).not.toBe(before);
    expect(before.length).toBeGreaterThan(0);
    expect(new Set(after.map((p) => p.color))).toEqual(new Set(["#123456"]));
  });

  it("a kept page changes with the accent", () => {
    const shell = opened(withCommands(labelled(), ...STUDIO));
    const row = () => view(shell).sheets[0];
    expect(row()?.pages()[0]?.primitives.some((p) => p.color === CUSTOM)).toBe(false);
    shell.ui({ type: "setSheetSetting", key: "accent", value: CUSTOM });
    expect(row()?.pages()[0]?.primitives.some((p) => p.color === CUSTOM)).toBe(true);
    expect(savedPages(shell)[0]?.primitives.some((p) => p.color === CUSTOM)).toBe(true);
  });
});

describe("an invalid accent is refused (AC-13)", () => {
  it.each(["red", "#fff", "#GGGGGG", "#B3261E", "b3261e", "#b3261e ", "#b3261e00", "url(#x)", "#b3261\n"])("%j", (value) => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheetSetting", key: "accent", value });
    expect(shell.view().toast).toMatch(/^Accent must|^Accent must be one line/);
    expect(shell.doc().projectFields).toEqual({});
    expect(view(shell).accent).toBe(PRESENTATION_STYLE.accent);
  });

  it("a stored row with a bad accent is an invalid drawing, so a server refuses it", () => {
    const bad = { ...roomDoc(), projectFields: { accent: { id: "accent", value: "red" } } };
    const result = validateDocument(bad);
    expect(result.ok ? [] : result.error.map((v) => v.invariant)).toContain("I14");
  });
});

describe("undo restores each (AC-13)", () => {
  it.each([
    ["studioName", "Atelier Bruni"],
    ["studioAddress", "Via Roma 1"],
    ["studioContact", "ciao@bruni.example"],
    ["issueDate", "1 May 2026"],
  ])("%s, typed in Project", (key, value) => {
    const shell = opened(withCommands(roomDoc(), field(key, "before")));
    shell.ui({ type: "setField", fieldId: `project.${key}`, value });
    expect(shell.doc().projectFields[key]?.value).toBe(value);
    shell.ui({ type: "undo" });
    expect(shell.doc().projectFields[key]?.value).toBe("before");
    shell.ui({ type: "redo" });
    expect(shell.doc().projectFields[key]?.value).toBe(value);
  });

  it("the accent, one step each, back to unset", () => {
    const shell = opened(roomDoc());
    shell.ui({ type: "setSheetSetting", key: "accent", value: "#1d4ed8" });
    shell.ui({ type: "setSheetSetting", key: "accent", value: CUSTOM });
    expect(view(shell).accent).toBe(CUSTOM);
    shell.ui({ type: "undo" });
    expect(view(shell).accent).toBe("#1d4ed8");
    shell.ui({ type: "undo" });
    expect(view(shell).accent).toBe(PRESENTATION_STYLE.accent);
    expect(shell.doc().projectFields).toEqual({});
    shell.ui({ type: "redo" });
    shell.ui({ type: "redo" });
    expect(view(shell).accent).toBe(CUSTOM);
  });
});
