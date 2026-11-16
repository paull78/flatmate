import { describe, expect, it } from "vitest";
import { cutHeight } from "@fm/domain";
import { planView } from "../../src/levels";
import { floorView } from "../../src/view/plan-view";
import { roomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// The plan view (levels.16): the layout and level a plan picture is drawn for, resolved once. The viewed level's
// scenarios are in viewed-level.test.ts.

describe("the plan view", () => {
  it("floorView's cut is cutHeight's, and planView follows the active layout", () => {
    const low = withCommands(roomDoc(), { type: "setCeiling", height: 2.2 });
    for (const doc of [roomDoc(), low]) {
      const view = floorView(doc, "s0");
      expect(view.cut).toBe(cutHeight(doc));
      expect(view.level).toEqual({ height: 0, deckIds: [], cut: cutHeight(doc), name: "Floor" });
      expect(view.layout).toBe("s0");
    }
    expect(floorView(low, null).cut).toBe(1.1); // half the 2.20 ceiling, not the 1.20 default

    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addState", opId: "n", name: "Night" }));
    const first = planView(shell.state);
    expect(first?.layout).toBe("s0");
    expect(planView(shell.state)).toBe(first); // the same object while nothing changes, so memoised layers are reused
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(planView(shell.state)?.layout).toBe("n/s0");
    expect(planView({ ...shell.state, document: null })).toBeNull(); // no document, no plan
  });
});
