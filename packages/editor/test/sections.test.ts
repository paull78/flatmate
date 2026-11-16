import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { entityExists } from "../src/state";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A section's row through the shell (section.09): a command, one undo step each.

const add: Command = { type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1 };
const A = { table: "sections", id: "A" } as const;

describe("a section's row in the editor", () => {
  it("exists once added, and not once deleted", () => {
    const doc = withCommands(roomDoc(), add);
    expect(entityExists(doc, A)).toBe(true);
    expect(entityExists(withCommands(doc, { type: "deleteEntities", ids: [A] }), A)).toBe(false);
  });

  it("adding and deleting are one undo step each, and undo brings the letter back", () => {
    const shell = FakeShell.local();
    shell.send({ type: "command", command: add });
    const row = shell.doc().sections["A"];
    expect(row?.side).toBe(1);
    shell.send({ type: "command", command: { type: "deleteEntities", ids: [A] } });
    expect(shell.doc().sections).toEqual({});
    shell.ui({ type: "undo" });
    expect(shell.doc().sections["A"]).toEqual(row);
    shell.ui({ type: "undo" });
    expect(shell.doc().sections).toEqual({});
  });
});
