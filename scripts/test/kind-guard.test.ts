import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENING_KIND_IDS } from "@fm/domain";

// AC-14 (openkinds): the lint guard that keeps opening kind ids out of comparisons and lists outside the kinds table
// knows every id the table has, so a kind added later is guarded from the start.

describe("the opening kind guard", () => {
  it("lists exactly the table's ids", () => {
    const config = readFileSync(new URL("../../eslint.config.js", import.meta.url), "utf8");
    const list = /const OPENING_KIND_ID_LIST = \[([^\]]*)\];/.exec(config)?.[1] ?? "";
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...OPENING_KIND_IDS]);
  });
});
