import { describe, expect, it } from "vitest";
import { execute, type Command, type Document } from "@fm/domain";
import { refusalText } from "../src/toast-text";
import { LOFT_ROOM_LOFT, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Column refusals in plain words (ux-polish.36, pillars.39): a person reads "this column" and "a wall", never IDs.

const doc = withCommands(roomDoc(), { type: "placeColumn", opId: "c", at: { x: 2, y: 2 }, width: 0.3, depth: 0.3 });

function toast(cmd: Command): string {
  const r = execute(doc, cmd);
  if (r.ok) throw new Error("expected a refusal");
  return refusalText(r.error, doc, cmd);
}

describe("column toasts", () => {
  it("a column touching a wall", () => {
    expect(toast({ type: "setColumn", wallId: "c/w0", at: { x: 0.25, y: 2 } })).toBe("This column touches a wall");
  });

  it("a size out of range keeps the numbers", () => {
    expect(toast({ type: "setColumn", wallId: "c/w0", width: 2.01 })).toBe("Column width 2.01 m is outside 0.10–2.00 m");
  });

  it("a wall command on a column", () => {
    expect(toast({ type: "setWallThickness", wallId: "c/w0", thickness: 0.4 })).toBe("A column can't be edited as a wall; edit its position, width and depth");
  });

  it("no ID in any column toast", () => {
    for (const cmd of [
      { type: "setColumn", wallId: "c/w0", at: { x: 0.25, y: 2 } },
      { type: "setColumn", wallId: "c/w0", depth: 0.05 },
      { type: "moveJoints", moves: [{ jointId: "c/j0", to: { x: 1, y: 1 } }] },
    ] satisfies Command[]) expect(toast(cmd)).not.toMatch(/c\/|w0|j0/);
  });

  it("a column dropped over a door: \"A column can't cover a door\"", () => {
    const room = roomDoc();
    const south = Object.values(room.walls).find((w) => room.joints[w.a]?.y === 0 && room.joints[w.b]?.y === 0);
    if (!south) throw new Error("no south wall");
    const doored = withCommands(room, { type: "addOpening", opId: "d", wall: south.id, kind: "swing", offset: 1, width: 0.8 });
    const cmd: Command = { type: "placeColumn", opId: "k", at: { x: 1.4, y: 0 }, width: 0.3, depth: 0.3 };
    const r = execute(doored, cmd);
    if (r.ok) throw new Error("expected a refusal");
    expect(refusalText(r.error, doored, cmd)).toBe("A column can't cover a door");
  });

  describe("a column in a wall's line", () => {
    const room = roomDoc();
    const south = Object.values(room.walls).find((w) => room.joints[w.a]?.y === 0 && room.joints[w.b]?.y === 0);
    if (!south) throw new Error("no south wall");
    const doored = withCommands(
      room,
      { type: "addOpening", opId: "d", wall: south.id, kind: "swing", offset: 1, width: 0.8 },
      { type: "placeColumn", opId: "k", at: { x: 3, y: 0 }, width: 0.3, depth: 0.3 },
    );
    const refusal = (cmd: Command): string => {
      const r = execute(doored, cmd);
      if (r.ok) throw new Error("expected a refusal");
      return refusalText(r.error, doored, cmd);
    };

    it("slid over a door: \"A column can't cover a door\"", () => {
      expect(refusal({ type: "setColumn", wallId: "k/w0", at: { x: 1.5, y: 0 } })).toBe("A column can't cover a door");
    });

    it("turned: it turns with its wall", () => {
      expect(refusal({ type: "setColumn", wallId: "k/w0", rotation: 45 })).toBe("A column in a wall's line turns with its wall");
    });

    it("a half deleted alone: the column would have a wall at one end only", () => {
      expect(refusal({ type: "deleteEntities", ids: [{ table: "walls", id: "k/w1" }] })).toBe("This column has a wall at one end only; a column stands free or in a wall's line");
    });
  });
});

describe("base and top refusals in plain words (pillars.50 a)", () => {
  // loftRoomDoc: ceiling 3.05, the Loft at 2.15 (underside 2.03) over x 1.3–3.7, y 1.4–3.8; a post under it and one on it.
  const posts = (): Document => withCommands(loftRoomDoc(),
    { type: "placeColumn", opId: "u", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: LOFT_ROOM_LOFT },
    { type: "placeColumn", opId: "o", at: { x: 3.5, y: 3 }, width: 0.2, depth: 0.2, base: LOFT_ROOM_LOFT });
  const LOCK = "A column stands on Loft; move it first"; // the first row by ID: the post on it

  it("the deck lock: resizing the loft in its Properties toasts the deck's name and no row ID", () => {
    const shell = FakeShell.withDocument(posts());
    shell.click({ x: 2, y: 3 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT_ROOM_LOFT }]);
    shell.ui({ type: "setField", fieldId: "width", value: "2.3" });
    expect(shell.view().toast).toBe(LOCK);
  });

  it("the deck lock: dragging the loft toasts the same plain words", () => {
    const shell = FakeShell.withDocument(posts());
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.click({ x: 2, y: 3 });
    shell.drag({ x: 2, y: 3 }, { x: 2.5, y: 3 });
    expect(shell.doc().decks[LOFT_ROOM_LOFT]?.at).toEqual({ x: 2.5, y: 2.6 });
    expect(shell.view().toast).toBe(LOCK);
  });

  it("a post on the loft raised through the ceiling: \"A column reaches 4.15 m; the ceiling is 3.05 m\"", () => {
    const cmd: Command = { type: "setColumn", wallId: "o/w0", top: 2 };
    const before = posts();
    const r = execute(before, cmd);
    if (r.ok) throw new Error("expected a refusal");
    expect(refusalText(r.error, before, cmd)).toBe("A column reaches 4.15 m; the ceiling is 3.05 m");
  });

  it("a post under the loft moved past its edge: \"A column reaches past Loft's edge\"", () => {
    const cmd: Command = { type: "setColumn", wallId: "u/w0", at: { x: 2.4, y: 1.42 } };
    const before = posts();
    const r = execute(before, cmd);
    if (r.ok) throw new Error("expected a refusal");
    expect(refusalText(r.error, before, cmd)).toBe("A column reaches past Loft's edge");
  });
});

describe("doors and windows on a wall on a deck or on a column (AC-08)", () => {
  // A wall on the loft (x 1.3–3.7, y 1.4–3.8) along y 2.6, and a free column on the floor.
  const before = withCommands(loftRoomDoc(),
    { type: "addWall", opId: "k", from: { at: { x: 1.6, y: 2.6 } }, to: { at: { x: 3.4, y: 2.6 } }, base: LOFT_ROOM_LOFT },
    { type: "placeColumn", opId: "c", at: { x: 4.5, y: 1 }, width: 0.3, depth: 0.3 });
  const toastOf = (cmd: Command): string => {
    const r = execute(before, cmd);
    if (r.ok) throw new Error("expected a refusal");
    return refusalText(r.error, before, cmd);
  };

  it("a window on the loft's 0.90 m wall: \"An opening must be at least 0.30 m tall\"; a door there fits (sills.03)", () => {
    expect(toastOf({ type: "addOpening", opId: "d", wall: "k/w0", kind: "window", offset: 0.2 })).toBe("An opening must be at least 0.30 m tall");
    expect(execute(before, { type: "addOpening", opId: "d", wall: "k/w0", kind: "swing", offset: 0.2 }).ok).toBe(true);
  });

  it("a window on a column: \"Doors and windows can't go on a column\"", () => {
    expect(toastOf({ type: "addOpening", opId: "d", wall: "c/w0", kind: "window", offset: 0, width: 0.3 })).toBe("Doors and windows can't go on a column");
  });
});
