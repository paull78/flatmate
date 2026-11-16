import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { sheetPages } from "../src/export/sheet";
import { CANVAS_STYLE, PRESENTATION_STYLE, planPicture } from "../src/view/picture";
import { COLORS } from "../src/view/colors";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { floorView } from "../src/view/plan-view";

// The accent ink (sheet.11, .16; AC-11): one fixed colour in the presentation style for room tags and the sheet
// number; walls, furniture and openings stay black and grey; the canvas does not change.

const ACCENT = "#b3261e";

function furnished(): Document {
  const doc = roomDoc();
  return withCommands(
    doc,
    { type: "labelZone", id: "L1", at: { x: 4, y: 2 }, name: "Studio", finish: null },
    { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3.85 } },
  );
}

describe("the accent ink (AC-11)", () => {
  it("is the colour picked from the mockup", () => {
    expect(PRESENTATION_STYLE.accent).toBe(ACCENT);
  });

  it("every room tag text in the presentation picture is the accent", () => {
    const tags = planPicture(furnished(), floorView(furnished(), "s0"), PRESENTATION_STYLE, 20, true).tags.filter((p) => p.kind === "text");
    expect(tags.length).toBeGreaterThanOrEqual(3); // name, size, area
    for (const t of tags) expect(t.color).toBe(ACCENT);
  });

  it("no wall, furniture or opening primitive is the accent", () => {
    const p = planPicture(furnished(), floorView(furnished(), "s0"), PRESENTATION_STYLE, 20, true);
    for (const prim of [...p.walls, ...p.objects, ...p.openings]) expect(prim.color).not.toBe(ACCENT);
  });

  it("the sheet number is the accent; the rest of the column is not", () => {
    const h = new FakeHost();
    h.today = () => "2026-10-13";
    const doc = withCommands(furnished(), { type: "addState", opId: "n", name: "Night" });
    const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: h, finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    const texts = page.primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
    expect(texts.find((t) => t.text === "Sheet 01 / 02")?.color).toBe(ACCENT);
    const column = page.widthMm - 10 - 60;
    const accentInColumn = texts.filter((t) => t.at.x >= column && t.color === ACCENT).map((t) => t.text);
    expect(accentInColumn).toEqual(["Sheet 01 / 02"]);
  });

  it("the canvas tags keep the canvas colours", () => {
    const shell = FakeShell.withDocument(furnished());
    const tags = shell.scene().layers.find((l) => l.name === "tags")?.primitives ?? [];
    const colors = new Set(tags.flatMap((p) => (p.kind === "text" ? [p.color] : [])));
    expect(colors.has(ACCENT)).toBe(false);
    expect([...colors].length).toBeGreaterThan(0);
    expect([...colors].every((c) => c === COLORS.text || c === COLORS.textMuted)).toBe(true);
    expect(CANVAS_STYLE.tag.text).toBe(COLORS.text);
  });

  it("the SVG download's room tags carry the accent (sheet.13)", () => {
    const shell = FakeShell.withDocument(furnished());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "svg" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "svg") throw new Error("no SVG");
    const texts = save.content.primitives.flatMap((p) => (p.kind === "text" ? [p.color] : []));
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(new Set(texts)).toEqual(new Set([ACCENT]));
  });
});
