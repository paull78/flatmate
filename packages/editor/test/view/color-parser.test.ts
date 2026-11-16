import { describe, expect, it } from "vitest";
import { COLOR_PATTERN, colorChannels } from "../../src/view/colors";
import { COLORS } from "../../src/view/colors";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../../src/view/picture";
import { LOOK_RULER } from "../../src/view/look-rulers";
import { STYLE_3D } from "../../src/view3d/style";
import { DEFAULT_ME_COLOR } from "../../src/state";
import { sheetPages } from "../../src/export/sheet";
import { FakeHost, FakeShell } from "../fake-shell";
import { roomDoc, withCommands, wallBetween } from "../builders";
import { drawDivider, drawRoom, labelRooms, resizeRightWall } from "../scenarios/try-it-steps";

// One colour parser (render.12, AC-09): colours stay hex strings under a hard constraint, and colorChannels is the
// only function that reads them.

/** Every string in `value` that starts with "#", however deep. */
function hexStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.startsWith("#")) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) hexStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) hexStrings(v, out);
  }
  return out;
}

describe("colorChannels (render.12)", () => {
  it("reads #rrggbb as opaque and #rrggbbaa with its alpha, byte / 255", () => {
    expect(colorChannels("#ff8000")).toEqual([1, 128 / 255, 0, 1]);
    expect(colorChannels("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(colorChannels("#2563eb99")).toEqual([0x25 / 255, 0x63 / 255, 0xeb / 255, 0x99 / 255]);
  });

  it("returns magenta for anything the constraint refuses", () => {
    for (const bad of ["#fff", "red", "#FF8000", "#ff80001", "", "#gg8000"]) expect(colorChannels(bad), bad).toEqual([1, 0, 1, 1]);
  });
});

describe("the colour constraint (render.12)", () => {
  it("every colour constant and style colour is lowercase #rrggbb or #rrggbbaa", () => {
    const sources = { COLORS, CANVAS_STYLE, PRESENTATION_STYLE, LOOK_STYLE, LOOK_RULER, STYLE_3D, DEFAULT_ME_COLOR };
    for (const [name, source] of Object.entries(sources)) {
      const found = hexStrings(source);
      expect(found.length, name).toBeGreaterThan(0);
      for (const c of found) expect(c, `${name}: ${c}`).toMatch(COLOR_PATTERN);
    }
  });

  it("every primitive of the sample scene and of a sheet meets it", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    labelRooms(shell);
    resizeRightWall(shell);
    const colours = shell.scene().layers.flatMap((l) => l.primitives.map((p) => p.color));
    const doc = withCommands(
      roomDoc(),
      { type: "labelZone", id: "L1", at: { x: 4, y: 2 }, name: "Studio", finish: null },
      { type: "addOpening", opId: "d", wall: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    );
    const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: new FakeHost(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    colours.push(...page.primitives.map((p) => p.color));
    expect(colours.length).toBeGreaterThan(50);
    for (const c of colours) expect(c).toMatch(COLOR_PATTERN);
  });
});

describe("the dash rule (render.05)", () => {
  it("every dash in the styles and the sample scene is two positive finite numbers", () => {
    const dashes = [CANVAS_STYLE, PRESENTATION_STYLE, LOOK_STYLE].flatMap((s) => [s.aboveDash, s.deck.dash, s.mark.dash]);
    const shell = FakeShell.local();
    drawRoom(shell);
    shell.key("v");
    shell.down({ x: -1, y: -1 });
    shell.moveTo({ x: 3, y: 3 }); // the Select tool's dashed box
    for (const l of shell.scene().layers) for (const p of l.primitives) if (p.kind === "segment" && p.dash) dashes.push(p.dash);
    expect(dashes.length).toBeGreaterThan(6);
    for (const [on, off] of dashes) {
      expect(Number.isFinite(on) && on > 0).toBe(true);
      expect(Number.isFinite(off) && off > 0).toBe(true);
    }
  });
});
