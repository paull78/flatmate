import { describe, expect, it } from "vitest";
import { trailerOf } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { clearRoomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Properties' Trailer section (trailer.03; AC-02): with nothing selected and Surroundings On wheels, Hitch, Axles and
// Tongue box after Ceiling; each sends setProjectField and undoes in one step.

const onWheels = (w = 7, d = 2.5) => withCommands(clearRoomDoc(w, d, "c"), { type: "setProjectField", key: "surroundings", value: "wheels" });
const fields = (s: FakeShell): Field[] => s.view().trailer ?? [];
const byId = (s: FakeShell, id: string): Field | undefined => fields(s).find((f) => f.id === id);
const set = (s: FakeShell, fieldId: string, value: string): void => void s.ui({ type: "setField", fieldId, value });

describe("the Trailer section", () => {
  it("shows only on wheels: Hitch, Axles, Tongue box, in that order", () => {
    expect(FakeShell.withDocument(clearRoomDoc(7, 2.5, "c")).view().trailer).toBeNull();
    const outside = withCommands(clearRoomDoc(7, 2.5, "c"), { type: "setProjectField", key: "surroundings", value: "outside" });
    expect(FakeShell.withDocument(outside).view().trailer).toBeNull();
    const s = FakeShell.withDocument(onWheels());
    expect(fields(s).map((f) => [f.id, f.label, f.value])).toEqual([["trailer.hitch", "Hitch", "high"], ["trailer.axles", "Axles", "2"], ["trailer.tongueBox", "Tongue box", "off"]]);
    expect(byId(s, "trailer.axles")?.options).toEqual([{ value: "2", label: "Two" }, { value: "3", label: "Three" }]);
    expect(byId(s, "trailer.tongueBox")?.options).toEqual([{ value: "off", label: "Off" }, { value: "on", label: "On" }]);
  });

  it("names the hitch's ends as the plan shows them", () => {
    expect(byId(FakeShell.withDocument(onWheels()), "trailer.hitch")?.options).toEqual([{ value: "low", label: "Left" }, { value: "high", label: "Right" }]);
    expect(byId(FakeShell.withDocument(onWheels(2.5, 7)), "trailer.hitch")?.options).toEqual([{ value: "low", label: "Lower" }, { value: "high", label: "Upper" }]);
  });

  it("each field sets the project's trailer, and one undo takes it back", () => {
    const s = FakeShell.withDocument(onWheels());
    set(s, "trailer.hitch", "low");
    set(s, "trailer.axles", "3");
    set(s, "trailer.tongueBox", "on");
    expect(trailerOf(s.doc())).toEqual({ hitch: "low", axles: 3, tongueBox: true });
    s.ui({ type: "undo" });
    expect(trailerOf(s.doc()).tongueBox).toBe(false);
    set(s, "trailer.tongueBox", "on");
    set(s, "trailer.tongueBox", "off");
    expect(s.doc().projectFields["tongueBox"]).toBeUndefined();
  });

  it("is hidden with something selected, as the Project section is", () => {
    const s = FakeShell.withDocument(onWheels());
    s.click({ x: 3.5, y: 0 }); // the lower wall
    expect(s.view().properties.kind).toBe("wall");
    expect(s.view().trailer).toBeNull();
  });
});
