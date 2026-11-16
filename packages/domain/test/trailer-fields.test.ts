import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { hitchName, trailerOf } from "../src/trailer";
import { validateDocument } from "../src/validate";

// The trailer's settings (trailer.02 to .05; AC-02): three project fields beside Surroundings, read as one typed value
// with today's trailer as the default.

const set = (doc: Document, key: string, value: string): Document => unwrap(execute(doc, { type: "setProjectField", key, value })).doc;
const reason = (key: string, value: string): string | null => {
  const r = execute(emptyDocument(), { type: "setProjectField", key, value });
  return r.ok ? null : r.error.message;
};

describe("trailerOf", () => {
  it("a project that never chose reads the high end, two axles and no tongue box", () => {
    expect(trailerOf(emptyDocument())).toEqual({ hitch: "high", axles: 2, tongueBox: false });
  });

  it("reads each field's value", () => {
    const doc = set(set(set(emptyDocument(), "trailerHitch", "low"), "trailerAxles", "3"), "tongueBox", "on");
    expect(trailerOf(doc)).toEqual({ hitch: "low", axles: 3, tongueBox: true });
    expect(validateDocument(doc).ok).toBe(true);
  });
});

describe("the fields' values", () => {
  it("each field takes its values and refuses others with a reason", () => {
    expect(reason("trailerHitch", "high")).toBeNull();
    expect(reason("trailerHitch", "left")).toBe("Hitch must be low or high; empty means high");
    expect(reason("trailerAxles", "2")).toBeNull();
    expect(reason("trailerAxles", "4")).toBe("Axles must be 2 or 3; empty means 2");
    expect(reason("trailerAxles", "three")).toBe("Axles must be 2 or 3; empty means 2");
    expect(reason("tongueBox", "on")).toBeNull();
    expect(reason("tongueBox", "yes")).toBe("Tongue box must be on, or empty for none");
  });

  it("empty clears a field back to its default, and one undo puts the old value back", () => {
    const three = set(emptyDocument(), "trailerAxles", "3");
    const r = unwrap(execute(three, { type: "setProjectField", key: "trailerAxles", value: "" }));
    expect(trailerOf(r.doc).axles).toBe(2);
    expect(trailerOf(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).axles).toBe(3);
  });
});

describe("hitchName", () => {
  it("names the end as the plan shows it", () => {
    expect(hitchName("low", true)).toBe("Left");
    expect(hitchName("high", true)).toBe("Right");
    expect(hitchName("low", false)).toBe("Lower");
    expect(hitchName("high", false)).toBe("Upper");
  });
});
