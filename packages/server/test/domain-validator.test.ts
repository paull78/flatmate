import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, toStored } from "@fm/domain";
import { emptyStored, unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";

describe("domainValidator", () => {
  it("accepts a valid room built through the domain API", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    expect(domainValidator.validate(toStored(doc))).toEqual({ ok: true });
  });

  it("reports crossing walls as I5 violations", () => {
    const doc = emptyStored();
    doc.joints = {
      j1: { id: "j1", x: 0, y: 0 },
      j2: { id: "j2", x: 2, y: 2 },
      j3: { id: "j3", x: 0, y: 2 },
      j4: { id: "j4", x: 2, y: 0 },
    };
    doc.walls = { w1: { id: "w1", a: "j1", b: "j2" }, w2: { id: "w2", a: "j3", b: "j4" } };
    const result = domainValidator.validate(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.startsWith("I5"))).toBe(true);
  });

  it("reports malformed entities", () => {
    const doc = emptyStored();
    doc.joints = { j1: { id: "j1", x: "zero", y: 0 } };
    expect(domainValidator.validate(doc).ok).toBe(false);
  });
});
