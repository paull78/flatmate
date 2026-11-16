import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { OPENING_KINDS, OPENING_KIND_IDS, type OpeningKind } from "../src/kinds";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { rectDoc, withOpening } from "./helpers";

// The kinds table held to the openkinds spec (AC-14): its Defaults and flips, Widths and Clearances tables, copied
// here by hand so a row that drifts from the spec fails. Each kind added to the table must be added here too.
type Row = (typeof OPENING_KINDS)[OpeningKind];
const SPEC: Record<OpeningKind, Omit<Row, "noun">> = {
  swing: { label: "Swing door", group: "doors", sideLabel: "Side", hingeLabel: "Hinge", glass: "glazed", clearance: "square", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 2, default: 0.8 } },
  double: { label: "Double door", group: "doors", sideLabel: "Side", hingeLabel: null, glass: "glazed", clearance: "twoSquares", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.8, max: 2.4, default: 1.2 } },
  sliding: { label: "Sliding door", group: "doors", sideLabel: "Side", hingeLabel: "Parks at", glass: "glazed", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "far", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 2, default: 0.8 } },
  pocket: { label: "Pocket door", group: "doors", sideLabel: null, hingeLabel: "Pocket at", glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "far", pocket: true, walkThrough: true, dressings: false, width: { min: 0.5, max: 1.2, default: 0.8 } },
  folding: { label: "Folding door", group: "doors", sideLabel: "Side", hingeLabel: "Stacks at", glass: "never", clearance: "strip", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 3, default: 0.9 } },
  slidingGlass: { label: "Sliding glass door", group: "doors", sideLabel: null, hingeLabel: null, glass: "always", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 1, max: 4, default: 2.4 } },
  window: { label: "Fixed window", group: "windows", sideLabel: null, hingeLabel: null, glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.3, max: 3, default: 1 } },
  casement: { label: "Casement window", group: "windows", sideLabel: "Side", hingeLabel: "Hinge", glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.3, max: 1.2, default: 0.6 } },
  twoLeaf: { label: "Two-leaf window", group: "windows", sideLabel: "Side", hingeLabel: null, glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.6, max: 2.4, default: 1.2 } },
  passage: { label: "Open passage", group: "doorways", sideLabel: null, hingeLabel: null, glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: false, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 3, default: 0.9 } },
  curtain: { label: "Curtain", group: "doorways", sideLabel: "Hangs on", hingeLabel: null, glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: false, hingeAt: "near", pocket: false, walkThrough: false, dressings: false, width: { min: 0.5, max: 3, default: 0.8 } },
};

describe("OPENING_KINDS against the spec (AC-14)", () => {
  it("lists exactly the spec's kinds", () => {
    expect([...OPENING_KIND_IDS].sort()).toEqual(Object.keys(SPEC).sort());
  });

  it.each(OPENING_KIND_IDS)("%s matches the spec's row", (kind) => {
    expect(OPENING_KINDS[kind]).toEqual({ ...SPEC[kind], noun: OPENING_KINDS[kind].noun });
  });

  it("groups come in the picker's order: doors, windows, doorways, each kind once", () => {
    const order = ["doors", "windows", "doorways"];
    const groups = OPENING_KIND_IDS.map((k) => order.indexOf(OPENING_KINDS[k].group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });
});

describe("Fixed window (openkinds.11)", () => {
  it("is labelled Fixed window, keeps the noun Window, and its width refusal names the label", () => {
    expect(OPENING_KINDS.window.label).toBe("Fixed window");
    expect(OPENING_KINDS.window.noun).toBe("Window");
    const r = execute(rectDoc(0, 0, 6, 4), { type: "addOpening", opId: "w", wall: "W1", kind: "window", offset: 0.5, width: 4 });
    expect(r.ok ? "" : r.error.message).toBe("Fixed window width must be between 0.30 and 3.00 m");
  });
});

describe("saved projects with today's three kinds (AC-13)", () => {
  it("load as they were saved and stay valid", () => {
    let doc = withOpening(rectDoc(0, 0, 6, 4), { id: "s", wall: "W1", offset: 0.5, kind: "swing", side: "right", hinge: "b", glazed: true });
    doc = withOpening(doc, { id: "l", wall: "W1", offset: 3, kind: "sliding", hinge: "b" });
    doc = withOpening(doc, { id: "w", wall: "W2", offset: 1, kind: "window", width: 1.2 });
    expect(validateDocument(doc).ok).toBe(true);
    const loaded = deserialize(serialize(doc));
    expect(loaded.ok ? loaded.value.openings : null).toEqual(doc.openings);
  });
});
