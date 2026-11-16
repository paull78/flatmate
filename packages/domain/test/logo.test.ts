import { describe, expect, it } from "vitest";
import { LOGO_LONG_SIDE, MAX_LOGO_DATA_CHARS, MAX_MESSAGE_BYTES, emptyStored, parseStoredDocument, unwrap, validateChangeset, type EntityValue } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { MESSAGES, invariantsMessage, topologyMessage } from "../src/errors";
import { LOGO_ID, type Document, type Logo } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// The studio's logo (sheetset.18, .21; AC-13): one row under a fixed id, as the underlay's is (import.16), and not a
// project field, as those enter every MCP reply. Its bytes go into a PDF as they are, so unlike the underlay's it's read
// as far as its first bytes.

const room = rectDoc(0, 0, 3.2, 2);
const JPEG = "/9j/4AAQSkZJRg"; // a JPEG's first bytes in base64
const PNG = "iVBORw0KGgo";
const set: Extract<Command, { type: "setLogo" }> = { type: "setLogo", data: JPEG, width: 600, height: 200 };
const clear: Command = { type: "removeLogo" };
const withLogo = unwrap(execute(room, set)).doc;

function refusal(doc: Document, cmd: Command) {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : { kind: r.error.kind, message: r.error.message };
}
const withRow = (row: Logo, id = row.id): Document => ({ ...room, logos: { [id]: row } });
const violations = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => `${v.invariant}: ${v.message}`);
};

describe("set and clear, one undo step each", () => {
  it("setting writes the one row, and undoing it leaves no row", () => {
    const { doc, patch } = unwrap(execute(room, set));
    expect(doc.logos).toEqual({ [LOGO_ID]: { id: LOGO_ID, data: JPEG, width: 600, height: 200 } });
    expect(patch.puts.map((p) => [p.table, p.entity.id])).toEqual([["logos", LOGO_ID]]);
    expect(patch.deletes).toEqual([]);
    expect(patch.dependencies).toEqual([{ table: "logos", id: LOGO_ID }]);
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: room });
  });

  it("clearing deletes it, and undoing it brings it back", () => {
    const { doc, patch } = unwrap(execute(withLogo, clear));
    expect(doc.logos).toEqual({});
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([{ table: "logos", id: LOGO_ID }]);
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: withLogo });
  });

  it("a new logo replaces the old one in one step, and undo restores the old", () => {
    const { doc, patch } = unwrap(execute(withLogo, { ...set, data: `${JPEG}AAAA`, width: 100, height: 400 }));
    expect(Object.keys(doc.logos)).toEqual([LOGO_ID]);
    expect(doc.logos[LOGO_ID]?.width).toBe(100);
    expect(patch.puts).toHaveLength(1);
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: withLogo });
  });

  it("the same logo again writes nothing, so it adds no undo step", () => {
    const { patch } = unwrap(execute(withLogo, set));
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([]);
  });

  it("clearing with no logo is refused, as the underlay's Remove is", () => {
    expect(refusal(room, clear)).toEqual({ kind: "notFound", message: "Logo not found" });
  });

  it("the drawing's own rows are untouched either way", () => {
    expect(withLogo.walls).toBe(room.walls);
    expect(withLogo.projectFields).toBe(room.projectFields);
  });
});

describe("not a JPEG, or too large, is refused in the underlay's words", () => {
  const refused = (cmd: Command) => {
    const r = execute(room, cmd);
    if (r.ok) throw new Error("accepted");
    return { kind: r.error.kind, message: r.error.message, details: r.error.violations.map((v) => v.message) };
  };

  it("a PNG's bytes", () => {
    const r = refused({ ...set, data: PNG });
    expect(r.kind).toBe("invalid");
    expect(r.message).toBe(MESSAGES.logo);
    expect(r.details).toEqual(["Logo logo must be a JPEG"]);
  });

  it("over the cap, and at it", () => {
    expect(refused({ ...set, data: JPEG.padEnd(MAX_LOGO_DATA_CHARS + 1, "A") }).details).toEqual([`Logo logo data must be 1 to ${MAX_LOGO_DATA_CHARS} characters`]);
    expect(execute(room, { ...set, data: JPEG.padEnd(MAX_LOGO_DATA_CHARS, "A") }).ok).toBe(true);
  });

  it("no data at all", () => {
    expect(refused({ ...set, data: "" }).details).toContain(`Logo logo data must be 1 to ${MAX_LOGO_DATA_CHARS} characters`);
  });

  it.each([[0, 200], [600, 0], [1.5, 200], [LOGO_LONG_SIDE + 1, 200], [600, LOGO_LONG_SIDE + 1]])("a size of %s × %s pixels", (width, height) => {
    expect(refused({ ...set, width, height }).details).toEqual([`Logo logo size must be whole pixels from 1 to ${LOGO_LONG_SIDE}`]);
  });

  it("a size that isn't a number at all", () => {
    expect(execute(room, { ...set, width: Number.NaN }).ok).toBe(false);
    expect(execute(room, { ...set, height: Infinity }).ok).toBe(false);
  });

  it("the toast names it, from a broken row and from a server's rejection", () => {
    const broken = validateDocument(withRow({ id: LOGO_ID, data: PNG, width: 1, height: 1 }));
    expect(broken.ok ? "valid" : topologyMessage(broken.error)).toBe(MESSAGES.logo);
    expect(invariantsMessage(new Set(["I24"]))).toBe(MESSAGES.logo);
  });

  it("two rows can't be: a row under any other id is broken", () => {
    expect(violations(withRow({ id: "other", data: JPEG, width: 1, height: 1 }))).toEqual(["I24: Logo other must use the id logo"]);
  });

  it("a message never holds the row's bytes", () => {
    for (const v of violations(withRow({ id: LOGO_ID, data: PNG, width: 0, height: 0 }))) expect(v).not.toContain(PNG);
  });

  it("deleting it as an entity is refused", () => {
    expect(refusal(withLogo, { type: "deleteEntities", ids: [{ table: "logos", id: LOGO_ID }] })).toEqual({ kind: "invalidInput", message: "The logo is removed with its own command" });
  });
});

describe("on the wire and in a file", () => {
  it("a logo at its cap is far under the message cap, so it needs no chunking", () => {
    expect(MAX_LOGO_DATA_CHARS).toBeLessThan(MAX_MESSAGE_BYTES / 4);
  });

  it("the patch passes validateChangeset, and a stored row parses on the wire", () => {
    const { patch } = unwrap(execute(room, set));
    const cs = validateChangeset({ id: "cs1", patch: { puts: patch.puts, deletes: [] }, expect: [{ table: "logos", id: LOGO_ID, lastCs: null }] });
    expect(cs.ok ? cs.value.patch.puts.length : cs.error).toBe(1);
    const stored = { ...emptyStored(), logos: { [LOGO_ID]: { id: LOGO_ID, data: JPEG, width: 600, height: 200 } } };
    expect(parseStoredDocument(stored)?.logos).toEqual(stored.logos);
  });

  it("a file round-trips it, and an older file with no logos table reads as none", () => {
    const back = unwrap(deserialize(serialize(withLogo)));
    expect(back.logos).toEqual(withLogo.logos);
    const older: Record<string, unknown> = { ...serialize(room) };
    delete older["logos"];
    expect(unwrap(deserialize(older)).logos).toEqual({});
  });

  it("applyPatch refuses a malformed row", () => {
    const entity: EntityValue = { id: LOGO_ID, data: JPEG, width: 600 };
    expect(applyPatch(room, { puts: [{ table: "logos", entity }], deletes: [] })).toMatchObject({ ok: false, error: { message: "Invalid logos entity logo" } });
  });
});
