import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap } from "@fm/domain";
import { wallFields } from "../src/properties/wall";
import { roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// Step 21 (straight.11): a wall off both axes by more than 0 and at most 1° shows its angle in Properties, read-only.

const angleOf = (fields: ReturnType<typeof wallFields>) => ("fields" in fields ? fields.fields.find((f) => f.id === "angle") : undefined);

describe("the Angle readout", () => {
  it("the kinked house's slanted top piece shows 0.35° (AC-16)", () => {
    const field = angleOf(wallFields(kinkedHouseDoc(), "w372a"));
    expect(field).toMatchObject({ label: "Angle", value: "0.35°", readOnly: true });
  });

  it("an axis wall and a 30° wall show none", () => {
    expect(angleOf(wallFields(roomDoc(), wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 })))).toBeUndefined();
    const slanted = unwrap(execute(emptyDocument(), { type: "addWall", opId: "s", from: { at: { x: 0, y: 0 } }, to: { at: { x: 3, y: 3 * Math.tan(Math.PI / 6) } } })).doc;
    expect(angleOf(wallFields(slanted, "s/w0"))).toBeUndefined();
  });

  it("a slant under a hundredth of a degree reads 'less than 0.01°'", () => {
    const tiny = unwrap(execute(emptyDocument(), { type: "addWall", opId: "t", from: { at: { x: 0, y: 0 } }, to: { at: { x: 8, y: 0.0005 } } })).doc;
    expect(angleOf(wallFields(tiny, "t/w0"))?.value).toBe("less than 0.01°");
  });

  it("Straighten shows on any piece of a side that isn't on one line, and puts the whole side on it (straight.43)", () => {
    const shell = FakeShell.withDocument(kinkedHouseDoc());
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: "wdb4fb" } }); // a straight piece of the kinked top side
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields.find((f) => f.id === "straighten")).toMatchObject({ value: "Straighten", action: true, readOnly: false });
    shell.ui({ type: "setField", fieldId: "straighten", value: "" });
    const ys = ["afdba", "372a", "c9b9", "db4f", "afdbb"].map((j) => shell.doc().joints[j]?.y);
    expect(new Set(ys).size).toBe(1);
    expect(shell.state.undo.past).toHaveLength(1);
    const after = shell.view().properties;
    expect(after.kind === "wall" && after.fields.some((f) => f.id === "straighten" || f.id === "angle")).toBe(false);
  });

  it("a wall on a straight side shows no Straighten", () => {
    const wall = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    const f = wallFields(roomDoc(), wall);
    expect("fields" in f && f.fields.some((x) => x.id === "straighten")).toBe(false);
  });
});
