import { describe, expect, it } from "vitest";
import { assertNever, deepEqual, err, isRecord, ok, unwrap, type Result } from "../src/util";

describe("Result", () => {
  it("ok and err build the two branches", () => {
    const good: Result<number, string> = ok(3);
    const bad: Result<number, string> = err("nope");
    expect(good).toEqual({ ok: true, value: 3 });
    expect(bad).toEqual({ ok: false, error: "nope" });
  });

  it("unwrap returns the value or throws with the serialized error", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(err({ kind: "tooShort" }))).toThrow('{"kind":"tooShort"}');
  });
});

describe("assertNever", () => {
  it("throws when reached at runtime", () => {
    type Shape = { kind: "a" } | { kind: "b" };
    const describeShape = (s: Shape): string => {
      switch (s.kind) {
        case "a":
          return "A";
        case "b":
          return "B";
        default:
          return assertNever(s);
      }
    };
    expect(describeShape({ kind: "b" })).toBe("B");
    expect(() => assertNever(JSON.parse('"surprise"') as never)).toThrow('Unexpected: "surprise"');
  });
});

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("deepEqual", () => {
  it("compares nested JSON values structurally", () => {
    expect(deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("detects differences in values, keys, lengths and kinds", () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
