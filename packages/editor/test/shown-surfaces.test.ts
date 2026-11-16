import { describe, expect, it } from "vitest";
import { collisionMessage, emptyDocument, rectangleRoom, zones } from "@fm/domain";
import { roomSizeText } from "../src/view/tags";
import type { ViewModel } from "../src/view/view-model";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// 2.675 m reads "2.68" on every surface (cleanup.13, AC-15). toFixed(2) reads the stored 2.67499… as "2.67". The level
// strip's chip is pinned in level-rows.test.ts ("Cut +2.68").

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);

describe("2.675 m reads 2.68 (AC-15)", () => {
  it("in Properties: a joint at x 2.675", () => {
    const doc = withCommands(emptyDocument(), { type: "addWall", opId: "w", from: { at: { x: 2.675, y: 0 } }, to: { at: { x: 2.675, y: 3 } } });
    const joint = Object.keys(doc.joints).find((id) => doc.joints[id]?.y === 0) ?? "";
    const shell = FakeShell.withDocument(doc);
    shell.state = { ...shell.state, selection: [{ table: "joints", id: joint }] };
    expect(fields(shell.view()).find((f) => f.id === "x")?.value).toBe("2.68");
  });

  it("in Properties: a joint at x 1.005, whose float sits under the half (1.00499…)", () => {
    const doc = withCommands(emptyDocument(), { type: "addWall", opId: "w", from: { at: { x: 1.005, y: 0 } }, to: { at: { x: 1.005, y: 3 } } });
    const joint = Object.keys(doc.joints).find((id) => doc.joints[id]?.y === 0) ?? "";
    const shell = FakeShell.withDocument(doc);
    shell.state = { ...shell.state, selection: [{ table: "joints", id: joint }] };
    expect(fields(shell.view()).find((f) => f.id === "x")?.value).toBe("1.01");
  });

  it("in a room tag's size line: a room 2.675 m across inside", () => {
    const doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 2.875, 3)); // 0.20 walls: 2.675 inside
    const [zone] = zones(doc);
    expect(roomSizeText(zone ?? null)).toBe("2.68 × 2.80 m");
  });

  it("in a height refusal's toast text", () => {
    expect(collisionMessage({ with: "ceiling", name: "Bed", config: null, top: 2.675, ceiling: 2.5, state: "Layout" })).toBe("Bed reaches 2.68 m in Layout; the ceiling is 2.50 m");
  });
});
