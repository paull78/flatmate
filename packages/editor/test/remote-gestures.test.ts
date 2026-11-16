import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { jointAt, pointOf, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import type { FakeShell } from "./fake-shell";

function selectKind(shell: FakeShell): string {
  const t = shell.state.tool;
  return t.name === "select" ? t.state.kind : t.name;
}

/** Press the room's top-right corner and move past the threshold: a drag in progress. */
function dragging(): FakeRemote {
  const r = FakeRemote.open(roomDoc());
  r.shell.moveTo({ x: 6, y: 4 });
  r.shell.down({ x: 6, y: 4 });
  r.shell.moveTo({ x: 6, y: 4.4 });
  return r;
}

describe("gestures and remote changes (spec: tools)", () => {
  it("a remote write to the dragged joint cancels the drag; releasing commits nothing", () => {
    const r = dragging();
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    expect(selectKind(r.shell)).toBe("moving");
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.2 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up({ x: 6, y: 4.4 });
    expect(r.submits()).toEqual([]);
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.2 });
  });

  it("an unrelated remote move reruns the drag on the new document", () => {
    const r = dragging();
    const origin = jointAt(r.doc, { x: 0, y: 0 });
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    r.remote({ type: "moveJoints", moves: [{ jointId: origin, to: { x: -0.4, y: 0 } }] });
    const t = r.shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.baseDoc, origin)).toEqual({ x: -0.4, y: 0 });
    // The rerun preview is computed on the new document from the same cursor.
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.attempt.doc, origin)).toEqual({ x: -0.4, y: 0 });
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.attempt.doc, corner)).toEqual({ x: 6, y: 4.4 });
    r.shell.moveTo({ x: 6, y: 4.6 });
    r.shell.up({ x: 6, y: 4.6 });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(r.shell.doc(), origin)).toEqual({ x: -0.4, y: 0 });
  });

  it("any remote topology change cancels the drag", () => {
    const r = dragging();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a snapshot cancels the drag", () => {
    const r = dragging();
    r.snapshot();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a dropped connection cancels the drag, and no new drag starts while offline", () => {
    const r = dragging();
    r.disconnect();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    r.shell.moveTo({ x: 6, y: 4 });
    r.shell.down({ x: 6, y: 4 });
    r.shell.moveTo({ x: 6, y: 4.6 });
    expect(selectKind(r.shell)).not.toBe("moving");
    r.shell.up({ x: 6, y: 4.6 });
    expect(r.submits()).toEqual([]);
  });

  it("a resize being typed is cancelled when its wall's fixed endpoint changes remotely", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const fixed = jointAt(r.doc, { x: 6, y: 0 });
    // Phase 5 enters this state from the helper dimension; set it directly to test the spec: tools rule on its own.
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: fixed, to: { x: 6.4, y: 0 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a resize being typed survives a remote move that does not touch its wall", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const farCorner = jointAt(r.doc, { x: 0, y: 4 });
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: farCorner, to: { x: -0.4, y: 4 } }] });
    expect(selectKind(r.shell)).toBe("editingHelper");
  });

  it("a chain piece being typed is cancelled when an opening on its wall is added or moved remotely (its pieces renumber)", () => {
    const base = roomDoc();
    const right = wallBetween(base, { x: 6, y: 0 }, { x: 6, y: 4 });
    const r = FakeRemote.open(withCommands(base, { type: "addOpening", opId: "x", wall: right, kind: "swing", offset: 1.1 }));
    const typing = { name: "select" as const, state: { kind: "editingHelper" as const, wallId: right, piece: 2, value: "1" } };
    r.shell.state = { ...r.shell.state, tool: typing };
    r.remote({ type: "addOpening", opId: "y", wall: right, kind: "window", offset: 2.5 });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.state = { ...r.shell.state, tool: typing };
    r.remote({ type: "moveOpening", openingId: "x/d0", offset: 0.5 });
    expect(selectKind(r.shell)).toBe("idle");
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveOpening", openingId: "x/d0", offset: 0.6 });
    expect(selectKind(r.shell)).toBe("editingHelper"); // the total does not depend on the openings
  });

  describe("a chain piece and a deleted opening (tidy C5, AC-09, AC-10)", () => {
    /** The right wall with door x (0.5, 0.80) and window y (2.5, 1.00): pieces gap, x, gap, y, gap. */
    function doorAndWindow(): { r: FakeRemote; right: string } {
      const base = roomDoc();
      const right = wallBetween(base, { x: 6, y: 0 }, { x: 6, y: 4 });
      const doc = withCommands(
        base,
        { type: "addOpening", opId: "x", wall: right, kind: "swing", offset: 0.5 },
        { type: "addOpening", opId: "y", wall: right, kind: "window", offset: 2.5 },
      );
      return { r: FakeRemote.open(doc), right };
    }
    const width = (r: FakeRemote, id: string): number | undefined => r.shell.doc().openings[id]?.width;

    it("a piece being typed is cancelled when an opening on its wall is deleted remotely; Enter applies nothing", () => {
      const { r, right } = doorAndWindow();
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, piece: 1, value: "0.9" } } };
      const sent = r.submits().length;
      r.remote({ type: "deleteEntities", ids: [{ table: "openings", id: "x/d0" }] });
      expect(selectKind(r.shell)).toBe("idle");
      expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
      r.shell.key("Enter");
      expect(r.submits().length).toBe(sent);
      expect(width(r, "y/d0")).toBe(1);
    });

    it("an opening deleted on another wall also cancels a piece being typed (the accepted over-cancel)", () => {
      const { r, right } = doorAndWindow();
      const left = wallBetween(r.doc, { x: 0, y: 0 }, { x: 0, y: 4 });
      r.remote({ type: "addOpening", opId: "z", wall: left, kind: "window", offset: 1 });
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, piece: 1, value: "0.9" } } };
      r.remote({ type: "deleteEntities", ids: [{ table: "openings", id: "z/d0" }] });
      expect(selectKind(r.shell)).toBe("idle");
    });

    it("an opening added or moved on another wall leaves a piece being typed alone: only a delete counts", () => {
      const { r, right } = doorAndWindow();
      const left = wallBetween(r.doc, { x: 0, y: 0 }, { x: 0, y: 4 });
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, piece: 1, value: "0.9" } } };
      r.remote({ type: "addOpening", opId: "z", wall: left, kind: "window", offset: 1 });
      expect(selectKind(r.shell)).toBe("editingHelper");
      r.remote({ type: "moveOpening", openingId: "z/d0", offset: 1.5 });
      expect(selectKind(r.shell)).toBe("editingHelper");
    });

    it("an own rejection leaves the wall's total being typed alone", () => {
      const { r, right } = doorAndWindow();
      r.shell.command({ type: "setProjectField", key: "client", value: "Rossi" }); // in flight
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.3" } } };
      r.reject();
      expect(selectKind(r.shell)).toBe("editingHelper");
    });

    it("the wall's total being typed survives a remote opening delete on its wall, and applies", () => {
      const { r, right } = doorAndWindow();
      const top = jointAt(r.doc, { x: 6, y: 4 });
      // 3.6 clear keeps window y (2.5 to 3.5 along the wall) inside it.
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.6" } } };
      r.remote({ type: "deleteEntities", ids: [{ table: "openings", id: "x/d0" }] });
      expect(selectKind(r.shell)).toBe("editingHelper");
      r.shell.key("Enter");
      const moved = pointOf(r.shell.doc(), top);
      expect(moved.x).toBe(6);
      expect(moved.y).toBeGreaterThan(3.75); // 3.80 on the centre line, corrected for the sloping top wall (tidy.45)
      expect(moved.y).toBeLessThan(3.8);
    });

    it("a piece being typed ends when the user's own change is rejected; Enter applies nothing", () => {
      const { r, right } = doorAndWindow();
      r.shell.command({ type: "deleteEntities", ids: [{ table: "openings", id: "x/d0" }] }); // in flight
      r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, piece: 1, value: "" } } };
      r.shell.type("0.6");
      r.reject(); // the door comes back
      expect(selectKind(r.shell)).toBe("idle");
      const sent = r.submits().length;
      r.shell.key("Enter");
      expect(r.submits().length).toBe(sent);
      expect(width(r, "x/d0")).toBe(0.8);
      expect(width(r, "y/d0")).toBe(1);
    });
  });

  it("a snapshot cancels a resize being typed", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.snapshot();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });
});

// Drag dependencies come from the command's own result (arch-review R-06): a label the joint move pushes back into its
// room is a dependency, as in the domain; placement and opening drags keep the dependencies they had.
describe("drag dependencies are the command's (arch-review R-06, AC-14)", () => {
  const keys = (shell: FakeShell): string[] => {
    const t = shell.state.tool;
    return t.name === "select" && t.state.kind === "moving" ? t.state.attempt.dependencies.map((k) => `${k.table}/${k.id}`).sort() : [];
  };

  it("a joint drag that pushes a label is cancelled when another client renames that label", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 5.8, y: 3.8 }, name: "Corner", finish: null }));
    r.shell.moveTo({ x: 6, y: 4 });
    r.shell.down({ x: 6, y: 4 });
    r.shell.moveTo({ x: 5, y: 4 }); // the right wall slants in: the label falls outside and is pushed back inside
    expect(selectKind(r.shell)).toBe("moving");
    expect(keys(r.shell)).toContain("zoneLabels/L1");
    r.remote({ type: "renameZone", id: "L1", name: "Nook" });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a placement drag depends on its placement, object and state; an opening drag on its opening, wall and the wall's joints", () => {
    const room = roomDoc();
    const bottom = wallBetween(room, { x: 0, y: 0 }, { x: 6, y: 0 });
    const doc = withCommands(
      room,
      { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.25 }, rotation: 0 },
      { type: "addOpening", opId: "d", wall: bottom, kind: "window", offset: 4 },
    );
    const objectDrag = FakeRemote.open(doc);
    objectDrag.shell.moveTo({ x: 3, y: 2 });
    objectDrag.shell.down({ x: 3, y: 2 });
    objectDrag.shell.moveTo({ x: 3.6, y: 2 });
    expect(keys(objectDrag.shell)).toEqual(["objects/b/o0", "placements/b/p0", "states/s0"]);

    const w = doc.walls[bottom];
    const openingDrag = FakeRemote.open(doc);
    openingDrag.shell.moveTo({ x: 4.5, y: 0 });
    openingDrag.shell.down({ x: 4.5, y: 0 });
    openingDrag.shell.moveTo({ x: 3.5, y: 0 });
    expect(keys(openingDrag.shell)).toEqual([`joints/${w?.a}`, `joints/${w?.b}`, "openings/d/d0", `walls/${bottom}`].sort());
  });

  it("a group drag submits one changeset writing every piece (AC-08)", () => {
    const r = groupSelected();
    r.shell.drag({ x: 2, y: 1.7 }, { x: 3, y: 1.7 });
    expect(r.submits()).toHaveLength(1);
    expect(r.last().patch.puts.map((p) => p.entity.id).sort()).toEqual(["a/p0", "b/p0"]);
  });

  it("a remote move of a piece of the dragged group cancels the drag", () => {
    const r = groupSelected();
    r.shell.moveTo({ x: 2, y: 1.7 });
    r.shell.down({ x: 2, y: 1.7 });
    r.shell.moveTo({ x: 2.6, y: 1.7 });
    expect(selectKind(r.shell)).toBe("moving");
    r.remote({ type: "movePlacement", placementId: "b/p0", at: { x: 3, y: 3 }, rotation: 0 });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up({ x: 2.6, y: 1.7 });
    expect(r.submits()).toEqual([]);
  });

  it("a group drag held in a wall from the start is cancelled by a remote move of any piece, not only the first", () => {
    const r = groupSelected();
    r.shell.moveTo({ x: 2, y: 1.7 });
    r.shell.down({ x: 2, y: 1.7 });
    r.shell.moveTo({ x: 5, y: 1.7 }); // b would cross the right wall: the first attempt is refused, the zero move's keys stay
    expect(selectKind(r.shell)).toBe("moving");
    r.remote({ type: "movePlacement", placementId: "b/p0", at: { x: 3, y: 3 }, rotation: 0 });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });
});

/** Shared mode: 0.6 m blocks anchored at (2, 2) and (3, 2), centred on (2, 1.7) and (3, 1.7), both selected. */
function groupSelected(): FakeRemote {
  const block = (opId: string, x: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind: "block" }, at: { x, y: 2 }, rotation: 0 });
  const r = FakeRemote.open(withCommands(roomDoc(), block("a", 2), block("b", 3)));
  r.shell.click({ x: 2, y: 1.7 });
  r.shell.click({ x: 3, y: 1.7 }, { shift: true });
  return r;
}
