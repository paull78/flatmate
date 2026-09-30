import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, MIGRATIONS, deserialize, migrateJson, serialize } from "../src/serialize";
import { docOf, rectDoc } from "./helpers";

describe("serialize / deserialize", () => {
  it("round-trips a document with the minimum version", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall" } } };
    const json = serialize(doc);
    expect(json.format).toBe("flatmate");
    expect(json.version).toBe(1);
    expect(deserialize(JSON.parse(JSON.stringify(json)))).toEqual({ ok: true, value: doc });
  });

  it("rejects other formats, unknown and newer versions with readable errors", () => {
    expect(deserialize({ format: "dwg" })).toMatchObject({ ok: false, error: { kind: "format", message: "Not a Flatmate drawing" } });
    expect(deserialize({ format: "flatmate", version: 0 })).toMatchObject({ ok: false, error: { message: "Unknown file version" } });
    const newer = deserialize({ format: "flatmate", version: CURRENT_VERSION + 1, joints: {}, walls: {}, zoneLabels: {} });
    expect(newer).toMatchObject({ ok: false, error: { kind: "format" } });
    expect(newer.ok ? "" : newer.error.message).toContain("newer");
  });

  it("rejects malformed and invalid content", () => {
    expect(deserialize({ format: "flatmate", version: 1, joints: [], walls: {}, zoneLabels: {} })).toMatchObject({ ok: false });
    const invalid = serialize(docOf({ joints: [["A", 0, 0], ["B", 0.001, 0]], walls: [["W", "A", "B"]] }));
    expect(deserialize(invalid)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("rejects IDs that name Object.prototype members", () => {
    const inherited = { format: "flatmate", version: 1, joints: { J1: { id: "J1", x: 0, y: 0 } }, walls: { W: { id: "W", a: "constructor", b: "J1" } }, zoneLabels: {} };
    expect(deserialize(inherited)).toMatchObject({ ok: false, error: { kind: "format" } });
    // JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead.
    const proto: unknown = JSON.parse(
      '{"format":"flatmate","version":1,"joints":{"A":{"id":"A","x":0,"y":0},"B":{"id":"B","x":1,"y":0},' +
        '"__proto__":{"id":"__proto__","x":5,"y":5}},"walls":{"W":{"id":"W","a":"A","b":"B"}},"zoneLabels":{}}',
    );
    expect(deserialize(proto)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("drops unknown top-level fields and rejects unknown entity fields", () => {
    const json = { format: "flatmate", version: 1, extra: 1, joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 1, y: 0 } }, walls: { W: { id: "W", a: "A", b: "B" } }, zoneLabels: {} };
    expect(deserialize(json)).toEqual({ ok: true, value: docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] }) });
    const withEntityField = { ...json, joints: { ...json.joints, A: { id: "A", x: 0, y: 0, z: 9 } } };
    expect(deserialize(withEntityField)).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry A" } });
  });

  it("applies version-gated JSON migrations in order", () => {
    const migrations = [
      { from: 1, migrate: (j: Record<string, unknown>) => ({ ...j, step1: true }) },
      { from: 2, migrate: (j: Record<string, unknown>) => ({ ...j, step2: true }) },
    ];
    expect(migrateJson({ v: 1 }, 1, 3, migrations)).toEqual({ ok: true, value: { v: 1, step1: true, step2: true } });
    expect(migrateJson({}, 1, 3, [])).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("the shipped migration list is read-only (type test; checked by pnpm typecheck)", () => {
    const mutate = (): void => {
      // @ts-expect-error MIGRATIONS is read-only
      MIGRATIONS.push({ from: 1, migrate: (j: Record<string, unknown>) => j });
    };
    expect(mutate).toBeTypeOf("function");
    expect(migrateJson({ v: 1 }, 1, 1, MIGRATIONS)).toEqual({ ok: true, value: { v: 1 } });
  });
});
