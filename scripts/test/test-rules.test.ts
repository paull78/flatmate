import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Rules about the unit tests themselves (snags.07, AC-02): correctness runs everywhere, speed only with FM_PERF=1, on a
// machine quiet enough to judge it. A wall-clock read in a test belongs in a `describe.skipIf(!PERF)` block, which the
// shared vitest config (vitest.shared.ts) switches on with FM_PERF=1.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const THIS = fileURLToPath(import.meta.url);

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(name) && path !== THIS ? [path] : [];
  });
}

const testDirs = [...readdirSync(join(ROOT, "packages")).map((p) => join(ROOT, "packages", p, "test")), join(ROOT, "scripts", "test")].filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});

/** The [start, end) ranges of every `describe.skipIf(!PERF)(…, () => { … })` body in a file's source. */
function perfBlocks(src: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of src.matchAll(/describe\.skipIf\(!PERF\)\(/g)) {
    const open = src.indexOf("{", src.indexOf("=>", m.index));
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.push([m.index, i]);
        break;
      }
    }
  }
  return out;
}

describe("the unit tests' own rules (snags)", () => {
  it("no unit test reads the wall clock outside a describe.skipIf(!PERF) block", () => {
    const outside: string[] = [];
    for (const file of testDirs.flatMap(testFiles)) {
      const src = readFileSync(file, "utf8");
      const blocks = perfBlocks(src);
      for (const m of src.matchAll(/\b(performance|Date)\.now\(\)/g)) {
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const before = src.slice(lineStart, m.index);
        if (before.includes("//") || before.includes("/*") || /^\s*\*/.test(before)) continue; // a comment
        if (blocks.some(([a, b]) => m.index > a && m.index < b)) continue;
        outside.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(outside).toEqual([]);
  });

  // A correctness test that only runs slowly under load must not fail on time (snags.11, .12, AC-03): ten took 2–4 s
  // against vitest's 5 s default at load 2.
  // A limit shorter than the default undoes it: the large-drawing overview's 15 s timed out at load 11 (snags.20).
  it("no unit test or hook sets a time limit under the shared 30 s", () => {
    const short: string[] = [];
    for (const file of testDirs.flatMap(testFiles)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const m = /^\s*\}, (\d[\d_]*)\);\s*(\/\/.*)?$/.exec(line);
        const ms = m ? Number((m[1] ?? "").replaceAll("_", "")) : 0;
        if (ms >= 1000 && ms < 30_000) short.push(`${relative(ROOT, file)}:${i + 1} (${ms} ms)`);
      });
    }
    expect(short).toEqual([]);
  });

  it("every package that runs vitest gives each test and hook 30 s, through the shared config", async () => {
    const { sharedTest } = await import("../../vitest.shared");
    expect(sharedTest.testTimeout).toBe(30_000);
    expect(sharedTest.hookTimeout).toBe(30_000);
    const dirs = [...readdirSync(join(ROOT, "packages")).map((p) => join(ROOT, "packages", p)), join(ROOT, "scripts")];
    const missing = dirs.filter((dir) => {
      const manifest = join(dir, "package.json");
      try {
        const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        const test = typeof pkg === "object" && pkg !== null && "scripts" in pkg ? JSON.stringify(pkg.scripts) : "";
        if (!test.includes("vitest")) return false;
      } catch {
        return false;
      }
      try {
        return !readFileSync(join(dir, "vitest.config.ts"), "utf8").includes("...sharedTest");
      } catch {
        return true;
      }
    });
    expect(missing.map((d) => relative(ROOT, d))).toEqual([]);
  });

  // One failing package used to stop the run, hiding every later package's results (test-hardening.06).
  it("pnpm test runs every package even after one fails", () => {
    const pkg: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const scripts = typeof pkg === "object" && pkg !== null && "scripts" in pkg ? pkg.scripts : null;
    const test = typeof scripts === "object" && scripts !== null && "test" in scripts ? String(scripts.test) : "";
    expect(test).toMatch(/^pnpm -r .*--no-bail.* test$/);
  });
});
