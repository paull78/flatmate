import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every number in the MCP text is printed from its constant (cleanup.09, AC-09): a value changed in the domain changes
// the text Claude reads. The scanner reads each string and template literal in server.ts and schemas.ts, drops the
// template holes and the phrases below, and fails on any digit left.

/** Phrases whose numbers are prose, not rules, each with why. */
const PROSE: readonly [RegExp, string][] = [
  [/\b(?:2\.5|[23])[dD]\b/g, "2D, 2.5D (what Flatmate is, mcp step 11), 3D and the view name 3d"],
  [/\b\d+\.\d+\.\d+\b/g, "the server's version string (semver)"],
  [/\(0\.00\)/g, "the floor's height, the origin of every range"],
  [/(?:rotation|at|default) 0(?![.\d])/g, "rotation zero, the reference direction"],
  [/(?<![\d.])[1-5]\) /g, "the tracing loop's step numbers"],
  [/about 1 m across/g, "a rough zoom for reading a ruler"],
  [/more than 2 %/g, "the tracing loop's tolerance for a scale check, judgement not a rule"],
  [/at least 1\/ of its/g, "look's short side as a share of its long side; the share is the constant that follows"],
];

/**
 * The text of every string and template literal in a source file, comments skipped. A template hole is kept only if
 * it holds a decimal literal (`${m(0.2)}` is a typed metre too); a hole naming a constant, or doing integer
 * arithmetic (`?? 0`, `* 100`, `1 / zoom`), drops out.
 */
function literals(file: string): { line: number; text: string }[] {
  const src = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  const out: { line: number; text: string }[] = [];
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{([^}]*)\}/g, (_, hole: string) => (/(?<![\w.])\d+\.\d/.test(hole) ? ` ${hole} ` : ""));
    out.push({ line: src.slice(0, m.index).split("\n").length, text });
  }
  return out;
}

/** The numbers left in a literal once the prose phrases are dropped. */
export function strayNumbers(text: string): string[] {
  const rest = PROSE.reduce((t, [re]) => t.replace(re, ""), text);
  return [...rest.matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

describe("MCP text prints its numbers from constants (AC-09)", () => {
  // look's refusals and captions (editor/src/view/look.ts, look-section.ts) are MCP text too (AC-09).
  for (const file of ["../src/server.ts", "../src/schemas.ts", "../../editor/src/view/look.ts", "../../editor/src/view/look-section.ts"]) {
    it(`${file} types no number inside a string`, () => {
      const stray = literals(file).flatMap(({ line, text }) => strayNumbers(text).map((n) => `${file}:${line} ${n} in "${text.slice(0, 60)}"`));
      expect(stray).toEqual([]);
    });
  }

  it("the scanner sees a stray number and lets prose through", () => {
    expect(strayNumbers("walls are 0.20 m thick")).toEqual(["0.20"]);
    expect(strayNumbers("1) look at the whole plan, about 1 m across, more than 2 %")).toEqual([]);
    // The prose phrases end where their number ends: a longer number is still caught (the M2 review's MC1, MC3).
    expect(strayNumbers("default 0.20")).toEqual(["0.20"]);
    expect(strayNumbers("rotation 0.5")).toEqual(["0.5"]);
    expect(strayNumbers("turn 0 to 30")).toEqual(["0", "30"]);
    expect(strayNumbers(" m(0.2) ")).toEqual(["0.2"]); // a typed metre in a template hole (MC2)
  });
});
