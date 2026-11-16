import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_DOC_BYTES, MAX_FOLDER_BYTES, historyProblems, indexProblems, levelsProblems, sizeProblems, specProblems } from "../src/spec-docs";

// The spec is a folder of short documents by topic, docs/specs/, each saying what Flatmate does now. These checks keep
// it from growing back into a log: the index lists every file, a document stays short, none carries the marks of a
// history, and a feature's document says what the feature does at levels. They check the shape, not the truth.

const DIR = new URL("../../docs/specs/", import.meta.url);

describe("the spec folder's checks", () => {
  it("lists a file missing from the index and an index line without a file", () => {
    const index = ["# Specs", "- [walls.md](walls.md) · walls", "- [gone.md](gone.md) · nothing"].join("\n");
    expect(indexProblems(index, ["walls.md", "stairs.md"])).toEqual(["stairs.md is not in the index", "the index lists gone.md, which is not there"]);
    expect(indexProblems(index, ["walls.md", "gone.md"])).toEqual([]);
  });

  it("lists a document over the size limit, and a folder over its limit", () => {
    const big = { name: "big.md", text: "x".repeat(MAX_DOC_BYTES + 1) };
    expect(sizeProblems([big, { name: "ok.md", text: "x".repeat(MAX_DOC_BYTES) }])).toEqual([`big.md is ${MAX_DOC_BYTES + 1} bytes, over ${MAX_DOC_BYTES}`]);
    const count = Math.floor(MAX_FOLDER_BYTES / MAX_DOC_BYTES) + 1;
    const many = Array.from({ length: count }, (_, i) => ({ name: `d${i}.md`, text: "x".repeat(MAX_DOC_BYTES) }));
    expect(sizeProblems(many)).toEqual([`the folder is ${count * MAX_DOC_BYTES} bytes, over ${MAX_FOLDER_BYTES}`]);
    expect(sizeProblems(many.slice(1))).toEqual([]);
  });

  it("counts bytes, not characters", () => {
    expect(sizeProblems([{ name: "m.md", text: "²".repeat(MAX_DOC_BYTES / 2 + 1) }])).toHaveLength(1);
  });

  it("lists a cycle marker, a memory ID, an acceptance ID, a date, a section number and the user's house, each with its line", () => {
    const text = ["# Stairs", "Stairs (cycle stairs) rise.", "See stairdraw.16 and real3d.27.", "Covers AC-07.", "Added on 2026-11-13.", "As §13.8 and § 5 say.", "From My Home's kink."].join("\n");
    expect(historyProblems({ name: "s.md", text })).toEqual([
      "s.md:2 a cycle's name: (cycle stairs",
      "s.md:3 a memory ID: stairdraw.16",
      "s.md:3 a memory ID: real3d.27",
      "s.md:4 an acceptance ID: AC-07",
      "s.md:5 a date: 2026-11-13",
      "s.md:6 a section number: §13",
      "s.md:6 a section number: § 5",
      "s.md:7 the user's house: My Home",
    ]);
  });

  it("takes sizes, versions, file names and code for what they are", () => {
    const text = ["A wall is 0.10 m or 0.20 m thick; version v0.1.0, then 0.2.", "`queries/levels.ts`, `look3d.ts:27`, `packages/web/e2e/look.spec.ts`", "I21 holds; 1:50 on paper; a 2.40 m ceiling; rev. 5", "kinds-s0-t0.png and section A-A"].join("\n");
    expect(historyProblems({ name: "ok.md", text })).toEqual([]);
  });

  it("lists a document without an At levels section, one with an empty section, and not an exempt one", () => {
    const docs = [
      { name: "stairs.md", text: "# Stairs\n\n## Kinds\ntext\n\n## At levels\nA stair lands on a loft.\n" },
      { name: "guards.md", text: "# Guards\n\n## Rules\nAt levels it does things.\n" },
      { name: "roofs.md", text: "# Roofs\n\n## At levels\n\n## Limits\ntext\n" },
      { name: "finishes.md", text: "# Finishes\n\n```\n## At levels\ninside a code block\n```\n" },
      { name: "roadmap.md", text: "# Roadmap\n" },
    ];
    expect(levelsProblems(docs)).toEqual(["guards.md has no At levels section", "roofs.md has an empty At levels section", "finishes.md has no At levels section"]);
  });

  it("the real folder passes every check", () => {
    const names = readdirSync(DIR).filter((n) => n !== "README.md");
    const docs = names.map((name) => ({ name, text: readFileSync(new URL(name, DIR), "utf8") }));
    expect(specProblems(readFileSync(new URL("README.md", DIR), "utf8"), docs)).toEqual([]);
  });
});
