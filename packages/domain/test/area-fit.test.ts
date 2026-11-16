import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { freeFloor } from "../src/queries/free-floor";
import { zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// AC-01 in the domain (areas.01): an area is a label only. Drawn over a sofa, it changes no fit, warning, free floor or room.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

describe("an area changes nothing else", () => {
  it("leaves validation, warnings, free floor and the room's area as they were", () => {
    const before = run(rectDoc(0, 0, 6, 4), { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 3, y: 2 }, deck: null });
    const after = run(before, { type: "addArea", opId: "k", at: { x: 3, y: 2 }, w: 3, d: 2, name: "Living" });
    expect(validateDocument(after)).toEqual(validateDocument(before));
    expect(clearanceWarnings(after, "s0")).toEqual(clearanceWarnings(before, "s0"));
    expect([...freeFloor(after, "s0")]).toEqual([...freeFloor(before, "s0")]);
    expect(zones(after).map((z) => z.area)).toEqual(zones(before).map((z) => z.area));
  });
});
