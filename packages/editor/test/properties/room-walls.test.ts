import { describe, expect, it } from "vitest";
import { execute, motifDefaults, roomWallsOf, unwrap, type Command, type Document } from "@fm/domain";
import { zoneFieldCommand, zoneFields } from "../../src/properties/zone";
import type { Field } from "../../src/view/view-model-types";
import { labelledDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// A room's Walls and Lower rows (surfaces step 09, inherit step 05, AC-06): in the Room section under Floor, they set the
// room's walls default on its label (inherit.01); every side facing the room shows it but the custom ones, which the
// note counts. A second label in the room says where they're set.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const fieldsOf = (doc: Document, label = "L1"): Field[] => {
  const p = zoneFields(doc, label, "s0");
  return p.kind === "zone" ? p.fields : [];
};
const byId = (doc: Document, id: string, label = "L1"): Field | undefined => fieldsOf(doc, label).find((f) => f.id === id);
const white = { ...motifDefaults("plain"), colour: "#f2f0eb" };
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const subway = motifDefaults("subwayTiles");

describe("a room's Walls and Lower rows (inherit step 05, AC-06)", () => {
  it("sit in the Room section under Floor, as compact rows, with no Walls section", () => {
    const fields = fieldsOf(labelledDoc());
    const ids = fields.map((f) => f.id);
    expect(ids.indexOf("row:walls.finish")).toBeGreaterThan(ids.indexOf("row:floor"));
    expect(ids.indexOf("row:walls.lower.motif")).toBeGreaterThan(ids.indexOf("row:walls.finish"));
    expect(new Set(fields.map((f) => f.section))).toEqual(new Set(["Room"]));
    expect(byId(labelledDoc(), "row:walls.finish")?.label).toBe("Walls");
    expect(byId(labelledDoc(), "row:walls.finish")?.value).toBe("None");
  });

  it("picking Plain sends setRoomWallFinishes, stored on the label; the row then reads it", () => {
    const cmd = zoneFieldCommand(labelledDoc(), "L1", "walls.finish", "plain");
    expect(cmd).toEqual({ type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: motifDefaults("plain") });
    const doc = ok(labelledDoc(), cmd as Command);
    expect(roomWallsOf(doc.zoneLabels.L1!)?.finish).toEqual(motifDefaults("plain"));
    expect(byId(doc, "walls.finish")?.value).toBe("plain");
  });

  it("Lower sends the band at 1.20, its summary says so, and Height edits it", () => {
    const cmd = zoneFieldCommand(labelledDoc(), "L1", "walls.lower.motif", "subwayTiles");
    expect(cmd).toEqual({ type: "setRoomWallFinishes", labelId: "L1", part: "lower", finish: subway, height: 1.2 });
    const doc = ok(labelledDoc(), cmd as Command);
    expect(byId(doc, "row:walls.lower.motif")?.value).toMatch(/to 1\.20 m$/);
    expect(zoneFieldCommand(doc, "L1", "walls.lower.height", "0.9")).toEqual({ type: "setRoomWallFinishes", labelId: "L1", part: "lower", finish: subway, height: 0.9 });
  });

  it("the note counts the custom sides facing the room", () => {
    const doc0 = ok(labelledDoc(), { type: "renameZone", id: "L1", name: "Bath" });
    expect(byId(doc0, "walls.note")?.value).toBe("Every side facing Bath shows these");
    const wall = Object.keys(doc0.walls).find((id) => {
      const w = doc0.walls[id];
      return w && doc0.joints[w.a]?.x === 0 && doc0.joints[w.b]?.x === 0;
    }) ?? "";
    const custom = ok(doc0, { type: "setWallSide", wallId: wall, side: "left", finish: navy, lower: null }, { type: "setWallSide", wallId: wall, side: "right", finish: navy, lower: null });
    expect(byId(custom, "walls.note")?.value).toBe("Every side facing Bath shows these, but 1 custom"); // the outside one isn't Bath's
  });

  it("is one undo step through the shell, and a custom side keeps its finish", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    shell.ui({ type: "setField", fieldId: "walls.finish", value: "plain" });
    shell.ui({ type: "setField", fieldId: "walls.hex", value: "#f2f0eb" });
    expect(roomWallsOf(shell.doc().zoneLabels.L1!)?.finish).toEqual(white);
    shell.key("z", { ctrl: true });
    expect(roomWallsOf(shell.doc().zoneLabels.L1!)?.finish).toEqual(motifDefaults("plain"));
  });

  it("a second label in the room says where the walls are set", () => {
    const doc = labelledDoc(); // labelZone refuses a second label, so it is written directly, as a merge can leave one
    const two: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, L3: { id: "L3", at: { x: 1, y: 1 }, name: "Nook", finish: null } } };
    const owner = byId(two, "row:walls.finish", "L1") ? "L1" : "L3";
    const other = owner === "L1" ? "L3" : "L1";
    expect(byId(two, "walls", other)?.value).toMatch(/^Set on /);
    expect(byId(two, "row:walls.finish", other)).toBeUndefined();
  });
});
