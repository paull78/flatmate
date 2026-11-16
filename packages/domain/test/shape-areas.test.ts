import { describe, expect, it } from "vitest";
import { parseArea } from "../src/shape-areas";

// The area row's shape (I8, areas step 01): flat fields for the wire (library.17).

const good = { id: "nook/a0", name: "Kitchen", at: { x: 1, y: 2 }, w: 2, d: 1.5 };

describe("parseArea", () => {
  it("parses a good row", () => {
    expect(parseArea(good)).toEqual(good);
  });

  it("refuses a missing name, a non-finite centre, a string width and a bad ID", () => {
    const noName = { id: good.id, at: good.at, w: good.w, d: good.d };
    expect(parseArea(noName)).toBeNull();
    expect(parseArea({ ...good, at: { x: Number.NaN, y: 2 } })).toBeNull();
    expect(parseArea({ ...good, at: { x: 1 } })).toBeNull();
    expect(parseArea({ ...good, w: "2" })).toBeNull();
    expect(parseArea({ ...good, id: "" })).toBeNull();
  });

  it("refuses a row with an extra field", () => {
    expect(parseArea({ ...good, rotation: 0 })).toBeNull();
  });
});
