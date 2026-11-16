import { describe, expect, it } from "vitest";
import { emptyStored, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { PROJECT_FIELDS, SET_FIELDS, STUDIO_FIELDS, SURROUNDINGS_VALUES, projectFieldOf, sheetSetNorth, sheetSetPaper, sheetSetScale, surroundingsOf } from "../src/project-fields";
import { MIGRATIONS, deserialize, serialize, upgradeStored } from "../src/serialize";
import { validateDocument } from "../src/validate";

// Project fields (sheet.02, .03, .05; AC-01, AC-03, AC-04): a fixed list of title block fields, one row per set field.

const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const set = (doc: Document, key: string, value: string): Document => unwrap(run(doc, { type: "setProjectField", key, value })).doc;
const reason = (doc: Document, key: string, value: string): string | null => {
  const r = run(doc, { type: "setProjectField", key, value });
  return r.ok ? null : r.error.message;
};

describe("PROJECT_FIELDS (sheet.03)", () => {
  it("lists the fields in the spec's order with their labels", () => {
    expect(PROJECT_FIELDS.map((f) => [f.key, f.label])).toEqual([
      ["subtitle", "Subtitle"],
      ["address", "Address"],
      ["client", "Client"],
      ["number", "Project number"],
      ["phase", "Phase"],
      ["revision", "Revision"],
      ["revisionDate", "Revision date"],
      ["author", "Author"],
      ["notes", "Notes"],
    ]);
  });

  it("notes is the only multi-line field, with 500 characters; the others hold 80", () => {
    expect(PROJECT_FIELDS.filter((f) => f.multiline).map((f) => f.key)).toEqual(["notes"]);
    expect(PROJECT_FIELDS.map((f) => f.maxLength)).toEqual([80, 80, 80, 80, 80, 80, 80, 80, 500]);
    expect(projectFieldOf("client")?.label).toBe("Client");
    expect(projectFieldOf("colour")).toBeNull();
    expect(projectFieldOf("constructor")).toBeNull();
  });
});

describe("the sheet set's settings (sheetset.21)", () => {
  it("are stored through setProjectField, apart from the title block's list", () => {
    expect(PROJECT_FIELDS).toHaveLength(9);
    expect(PROJECT_FIELDS.map((f) => f.key)).not.toContain("paper");
    const doc = set(set(emptyDocument(), "paper", "A3"), "generalScale", "75");
    expect(sheetSetPaper(doc)).toBe("A3");
    expect(sheetSetScale(doc)).toBe(75);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("read A4 and Fit with no rows", () => {
    expect(sheetSetPaper(emptyDocument())).toBe("A4");
    expect(sheetSetScale(emptyDocument())).toBe("fit");
    expect(set(set(emptyDocument(), "paper", "A3"), "paper", "").projectFields).toEqual({});
  });

  it("refuse a value off their list", () => {
    expect(reason(emptyDocument(), "paper", "B5")).toBe("Paper must be A4, A3, A2, A1 or Letter");
    for (const scale of ["37", "fit", "1:50", "50.0"]) expect(reason(emptyDocument(), "generalScale", scale)).toBe("Scale must be 1:20, 1:25, 1:50, 1:75, 1:100 or 1:200");
  });

  it("a stored value off the list fails validation", () => {
    const bad: Document = { ...emptyDocument(), projectFields: { paper: { id: "paper", value: "B5" } } };
    expect(validateDocument(bad).ok).toBe(false);
  });

  it("north is whole degrees from 0 to 359, or absent, as a string on the wire (library.17)", () => {
    expect(sheetSetNorth(emptyDocument())).toBeNull();
    expect(sheetSetNorth(set(emptyDocument(), "north", "0"))).toBe(0);
    expect(sheetSetNorth(set(emptyDocument(), "north", "359"))).toBe(359);
    expect(set(set(emptyDocument(), "north", "45"), "north", "").projectFields).toEqual({});
    for (const angle of ["360", "1.5", "x", "-1", "045", "1e2", " 5"]) expect(reason(emptyDocument(), "north", angle)).toBe("North must be a whole number of degrees from 0 to 359");
    expect(validateDocument(set(emptyDocument(), "north", "45")).ok).toBe(true);
  });

  it("a stored north off the list fails validation, and is never printed as a title block field", () => {
    const bad: Document = { ...emptyDocument(), projectFields: { north: { id: "north", value: "360" } } };
    expect(validateDocument(bad).ok).toBe(false);
    expect(PROJECT_FIELDS.map((f) => f.key)).not.toContain("north");
  });
});

describe("surroundings (surroundings.05, .15; AC-04, AC-09)", () => {
  const REASON = "Surroundings must be interior, outside, wheels or grid; empty means None";
  const stored = (value: string): Document => ({ ...emptyDocument(), projectFields: { surroundings: { id: "surroundings", value } } });

  it("is one of the set's settings, so neither the title block's list nor Properties' holds it", () => {
    expect(SET_FIELDS.map((f) => f.key)).toContain("surroundings");
    expect([...PROJECT_FIELDS, ...STUDIO_FIELDS].map((f) => f.key)).not.toContain("surroundings");
    expect(SURROUNDINGS_VALUES.map((s) => [s.value, s.label])).toEqual([
      ["interior", "Interior"],
      ["outside", "Outside"],
      ["wheels", "On wheels"],
      ["grid", "Grid"],
    ]);
  });

  it("surroundingsOf gives null with no row and each value with its row", () => {
    expect(surroundingsOf(emptyDocument())).toBeNull();
    for (const { value } of SURROUNDINGS_VALUES) {
      const doc = set(emptyDocument(), "surroundings", value);
      expect(surroundingsOf(doc)).toBe(value);
      expect(validateDocument(doc).ok).toBe(true);
    }
    expect(surroundingsOf(stored("none"))).toBeNull();
  });

  it("a value off the list is refused with a reason, none included", () => {
    for (const value of ["none", "None", "Outside", " outside", "wheels ", "on wheels", "constructor", "x".repeat(80)]) {
      expect(reason(emptyDocument(), "surroundings", value), value).toBe(REASON);
      expect(validateDocument(stored(value)).ok, value).toBe(false);
    }
    const r = validateDocument(stored("none"));
    expect(r.ok ? [] : r.error.map((v) => [v.invariant, v.message])).toEqual([["I14", REASON]]);
  });

  it("empty clears the row", () => {
    const outside = set(emptyDocument(), "surroundings", "outside");
    const r = unwrap(run(outside, { type: "setProjectField", key: "surroundings", value: "" }));
    expect(r.doc.projectFields).toEqual({});
    expect(surroundingsOf(r.doc)).toBeNull();
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(outside);
  });

  it("empty on a project with no row is no edit", () => {
    const doc = emptyDocument();
    const r = unwrap(run(doc, { type: "setProjectField", key: "surroundings", value: "" }));
    expect(r.doc).toBe(doc);
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.deletes).toEqual([]);
  });

  it("an existing project with no row loads unchanged and reads as None", () => {
    const row = { client: { id: "client", value: "Rossi" } };
    const back = deserialize(JSON.parse(JSON.stringify(serialize({ ...emptyDocument(), projectFields: row }))));
    expect(back.ok && back.value.projectFields).toEqual(row);
    expect(back.ok && surroundingsOf(back.value)).toBeNull();
    const old = { ...emptyStored(), states: { s0: { id: "s0", name: "Layout", order: 0 } }, projectFields: row };
    expect(upgradeStored(old)).toEqual(old);
  });
});

describe("setProjectField (AC-01, AC-04)", () => {
  it("sets, replaces and clears a field; the same value changes nothing", () => {
    const a = set(emptyDocument(), "client", "Rossi");
    expect(a.projectFields).toEqual({ client: { id: "client", value: "Rossi" } });
    const b = set(a, "client", "Bianchi");
    expect(b.projectFields.client?.value).toBe("Bianchi");
    const c = set(b, "client", "");
    expect(c.projectFields).toEqual({});
    const same = unwrap(run(b, { type: "setProjectField", key: "client", value: "Bianchi" }));
    expect(same.doc).toBe(b);
    expect(same.patch.puts).toEqual([]);
    expect(unwrap(run(emptyDocument(), { type: "setProjectField", key: "client", value: "" })).patch.puts).toEqual([]);
  });

  it("depends only on its own row, so different fields never conflict (sheet.02)", () => {
    const r = unwrap(run(emptyDocument(), { type: "setProjectField", key: "address", value: "Via Roma 12" }));
    expect(r.patch.dependencies).toEqual([{ table: "projectFields", id: "address" }]);
  });

  it("a set and a clear undo exactly through the inverse patch", () => {
    const before = set(emptyDocument(), "client", "Rossi");
    for (const value of ["Bianchi", ""]) {
      const r = unwrap(run(before, { type: "setProjectField", key: "client", value }));
      expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(before);
    }
  });

  it("refuses unknown keys", () => {
    expect(reason(emptyDocument(), "colour", "red")).toBe("Unknown project field colour");
    expect(reason(emptyDocument(), "constructor", "x")).toBe("Unknown project field constructor");
  });

  it("refuses values over the field's length, naming the field", () => {
    const doc = emptyDocument();
    expect(reason(doc, "client", "x".repeat(81))).toBe("Client is longer than 80 characters");
    expect(reason(doc, "client", "x".repeat(80))).toBeNull();
    expect(reason(doc, "notes", "x".repeat(501))).toBe("Notes is longer than 500 characters");
    expect(reason(doc, "notes", "x".repeat(500))).toBeNull();
  });

  it("allows line breaks only in notes", () => {
    expect(reason(emptyDocument(), "client", "a\nb")).toBe("Client must be one line");
    expect(reason(emptyDocument(), "address", "a\r\nb")).toBe("Address must be one line");
    expect(reason(emptyDocument(), "notes", "a\nb")).toBeNull();
  });
});

describe("I14", () => {
  const withRow = (id: string, value: string): Document => ({ ...emptyDocument(), projectFields: { [id]: { id, value } } });
  const invariants = (doc: Document): string[] => {
    const r = validateDocument(doc);
    return r.ok ? [] : r.error.map((v) => v.invariant);
  };

  it("refuses an unknown key, an empty value, a long value and a line break outside notes", () => {
    expect(invariants(withRow("client", "Rossi"))).toEqual([]);
    expect(invariants(withRow("colour", "red"))).toEqual(["I14"]);
    expect(invariants(withRow("client", ""))).toEqual(["I14"]);
    expect(invariants(withRow("client", "x".repeat(81)))).toEqual(["I14"]);
    expect(invariants(withRow("client", "a\nb"))).toEqual(["I14"]);
    expect(invariants(withRow("notes", "a\nb"))).toEqual([]);
  });
});

describe("a project field value that is not a string (tidy C8, AC-18)", () => {
  // Untyped input, as a JSON command or a stored row would bring it: JSON.parse gives values the types can't see.
  const untyped = (value: string): Command => JSON.parse(`{"type":"setProjectField","key":"client","value":${value}}`);

  it("setProjectField refuses it as invalid input, naming the field", () => {
    const doc = set(emptyDocument(), "client", "Rossi");
    for (const value of ["5", "{}", "[]", "true"]) {
      const r = run(doc, untyped(value));
      expect(r.ok).toBe(false);
      if (!r.ok) expect([r.error.kind, r.error.message]).toEqual(["invalidInput", "Client must be text"]);
    }
  });

  it("a document holding one fails validateDocument, at the shape check (I8)", () => {
    const doc: Document = JSON.parse(JSON.stringify({ ...emptyDocument(), projectFields: { client: { id: "client", value: 5 } } }));
    const r = validateDocument(doc);
    expect(r.ok ? [] : r.error.map((v) => v.invariant)).toEqual(["I8"]);
  });

  it("an empty string still clears the field", () => {
    const doc = set(emptyDocument(), "client", "Rossi");
    expect(set(doc, "client", "").projectFields["client"]).toBeUndefined();
  });
});

describe("files and stored documents (AC-03)", () => {
  it("a version 3 file without projectFields opens with an empty table", () => {
    const json: Record<string, unknown> = { ...serialize(emptyDocument()), version: 3 };
    delete json.projectFields;
    const r = deserialize(json);
    expect(r.ok && r.value.projectFields).toEqual({});
  });

  it("saves version 4 with or without fields set (sheet.31) and reads the fields back", () => {
    expect(serialize(emptyDocument()).version).toBe(4);
    const json = serialize(set(emptyDocument(), "client", "Rossi"));
    expect(json.version).toBe(4);
    const back = deserialize(JSON.parse(JSON.stringify(json)));
    expect(back.ok && back.value.projectFields).toEqual({ client: { id: "client", value: "Rossi" } });
  });

  it("the 3 → 4 migration adds the table when missing and keeps one that exists; running it twice changes nothing", () => {
    const migrate = MIGRATIONS.find((m) => m.from === 3)?.migrate;
    if (!migrate) throw new Error("no 3 → 4 migration");
    const once = migrate({ joints: {} });
    expect(once).toEqual({ joints: {}, projectFields: {} });
    expect(migrate(once)).toEqual(once);
    const kept = { projectFields: { client: { id: "client", value: "Rossi" } } };
    expect(migrate(kept)).toEqual(kept);
  });

  it("upgradeStored keeps a stored document's fields (server data, spec: domain)", () => {
    const stored = { ...emptyStored(), states: { s0: { id: "s0", name: "Layout", order: 0 } }, projectFields: { client: { id: "client", value: "Rossi" } } };
    expect(upgradeStored(stored)).toEqual(stored);
  });
});
