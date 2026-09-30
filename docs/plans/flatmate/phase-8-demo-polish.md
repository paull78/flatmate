# Phase 8: Demo polish and final gate

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** Make the five-minute demo (spec §1.4, steps 1–9) reliable and presentable. Deliverables:

- the two step-9 artifacts: a domain-only script and a narrated headless scenario;
- a seeded fallback project and a one-command launcher;
- a palette and styling pass, with screenshots;
- an honest root README;
- two timed rehearsals;
- the final sprint report.

**Spec:** §1.4 (demo script), §2.3 ("Scripts / AI agent" and "Headless editor" rows), §3.1 (script usage), §6.1, §7.2 (restart loop), §9 (web Playwright smoke), §10 step 7, §11 (follow-up order).

**Prerequisites:** G7 approved. `pnpm check` and `pnpm e2e` are green. `pnpm dev:server` runs the restart loop (phase 6) and `pnpm dev` runs the web app (phase 4, with server mode from phase 7).

**Design memory to read first:**

- `scope.md`:
  - Don't claim "cutting from the end leaves a complete demo" unless polish and the demo-critical details come before the cut line.
  - Don't let the demo depend on WebGL.
  - Don't treat §11 as required scope.
- `rendering.md`: don't claim antialiasing or draw-call numbers. The README must not mention WebGL as present.
- `collaboration.md`: don't claim universal power-loss durability. Receipts and tombstones are never compacted; say so, don't hide it.
- `architecture.md`: don't import `@fm/domain` from `server/src/app`. The seed script therefore lives in `packages/server/scripts/`, outside `src/`.
- `process.md`:
  - lesson 4: don't overclaim;
  - lesson 16: re-run the demo script against the rules that remain.
- `undo-history.md`, "Known consequence": demo step 8 must use a non-topological move, or Bob's edit wipes Alice's whole history.

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `pnpm-workspace.yaml` | add `scripts` as a workspace package |
| Modify | `package.json` (root) | `demo`, `demo:script`, `demo:headless`, `demo:seed` and `screenshots` scripts; `tsx` dev dependency |
| Create | `scripts/package.json`, `scripts/tsconfig.json` | `@fm/scripts`: the CLI shell from spec §2.2 ("cli: scripts"), with Node typings |
| Create | `scripts/src/rooms.ts` | `buildRoom()` and `describeRooms()`: the domain-only room script (demo step 9b) |
| Create | `scripts/test/rooms.test.ts` | asserts the numbers the script prints |
| Create | `scripts/build-room.ts` | CLI entry that prints the room table |
| Create | `scripts/demo.sh` | starts the server restart loop and the web dev server; `trap` stops both |
| Modify | `packages/editor/src/view/colors.ts` | final palette (hex values only) |
| Create | `packages/editor/test/view/colors.test.ts` | palette format and contrast guard |
| Modify | `packages/web/src/styles.css` | append design tokens and panel restyling; layout rules (phases 4 and 7) unchanged |
| Modify | `packages/web/src/main.tsx` | import `./styles.css` if not already imported |
| Modify | `packages/web/src/app.tsx` and `packages/web/src/panels/*.tsx` | root `className` hooks; `aria-pressed` on tool buttons (no behaviour change) |
| Create | `packages/editor/test/scenarios/demo-narrated.test.ts` | demo step 9a: steps 2–6 replayed through `FakeShell` with one `it` per step |
| Create | `packages/server/scripts/seed-demo.ts` | `seedDemo(repository)`: "Sample apartment" built with domain commands and accepted through `decideSubmit` |
| Create | `packages/server/scripts/run-seed-demo.ts` | CLI entry for the seed |
| Create | `packages/server/test/seed-demo.test.ts` | the seed against a temporary directory |
| Modify | `packages/server/tsconfig.json` | include `scripts` |
| Create | `packages/web/e2e/support/demo-driver.ts` | world→page mapping and demo-driving helpers for Playwright |
| Create | `packages/web/e2e/screenshots.spec.ts` | four demo screenshots; runs only with `FM_SCREENSHOTS=1` |
| Create | `docs/reports/screenshots/*.png` | output of the screenshot run (committed at the gate) |
| Create | `README.md` (root) | what it is, how to run, architecture, testing, honest limits |
| Create | `docs/reports/demo-rehearsal.md` | timed rehearsal checklist with fallbacks |
| Create | `docs/reports/gate-8-demo-polish.md` | final gate report and sprint summary |

## Tasks

### Task 8.1: Domain-only room script (demo step 9b)

**Files:**

- Modify: `pnpm-workspace.yaml` and the root `package.json`.
- Create: `scripts/package.json`, `scripts/tsconfig.json`, `scripts/src/rooms.ts`, `scripts/test/rooms.test.ts` and `scripts/build-room.ts`.

Why a workspace package: the script needs `console` and Node typings, which the core `tsconfig`s exclude (README P2). It must also be typechecked and tested by `pnpm check`. Spec §2.2 already lists "cli: scripts" as a shell, so this is a shell, not a new ring.

- [x] **Step 1: Register the package.** Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - "packages/*"
  - "scripts"
onlyBuiltDependencies:
  - esbuild
```

(Keep every other entry phase 1 or later phases added, such as `onlyBuiltDependencies`; only the `scripts` line is new.)

Create `scripts/package.json`:

```json
{
  "name": "@fm/scripts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@fm/domain": "workspace:*",
    "@fm/protocol": "workspace:*"
  }
}
```

Create `scripts/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["build-room.ts", "src", "test"]
}
```

Run:

```bash
pnpm --filter @fm/scripts add -D typescript vitest @types/node
pnpm add -Dw tsx
pnpm install
```

Expected: pnpm lists `@fm/scripts` among the workspace projects, and the install succeeds. If the root already has these dev dependencies, pnpm reuses the same versions.

- [x] **Step 2: Write the failing test** `scripts/test/rooms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, validateDocument, zones } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { buildRoom, describeRooms } from "../src/rooms";

describe("build-room script (spec §2.3, demo step 9b)", () => {
  it("builds a valid 4 × 5 m room split by a divider", () => {
    const doc = buildRoom();
    expect(validateDocument(doc).ok).toBe(true);
    expect(Object.keys(doc.walls)).toHaveLength(7); // 4 outer walls, the divider, 2 split fragments
    expect(Object.keys(doc.joints)).toHaveLength(6); // 4 corners, 2 T-junctions
    expect(zones(doc)).toHaveLength(2);
  });

  it("prints each labelled room with its clear area (0.20 m walls)", () => {
    expect(describeRooms(buildRoom())).toEqual([
      { room: "Kitchen", area: "8.64 m²" },
      { room: "Living", area: "8.64 m²" },
    ]);
  });

  it("describes an undivided, unlabelled room", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    expect(describeRooms(doc)).toEqual([{ room: "(unlabelled)", area: "18.24 m²" }]);
  });
});
```

Expected areas: a 2 × 5 m centreline room with 0.20 m walls has a clear area of 1.80 × 4.80 = 8.64 m². The whole room is 3.80 × 4.80 = 18.24 m².

- [x] **Step 3: Run it.** `pnpm --filter @fm/scripts test`. Expected: FAIL, because `../src/rooms` cannot be resolved.

- [x] **Step 4: Implement** `scripts/src/rooms.ts`:

```ts
import { emptyDocument, execute, rectangleRoom, zones } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";

export type RoomLine = { room: string; area: string };

/** Spec §2.3 "Scripts / AI agent": a 4 × 5 m room, a divider and two labels, through the domain API only. */
export function buildRoom(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
  const more: Command[] = [
    { type: "addWall", opId: "divider", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 5 } } },
    { type: "labelZone", id: "kitchen", at: { x: 1, y: 2.5 }, name: "Kitchen" },
    { type: "labelZone", id: "living", at: { x: 3, y: 2.5 }, name: "Living" },
  ];
  for (const cmd of more) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

export function describeRooms(doc: Document): RoomLine[] {
  return zones(doc)
    .map((z) => ({
      room: z.labelIds.map((id) => doc.zoneLabels[id]?.name ?? id).join(" / ") || "(unlabelled)",
      area: z.area === null ? "Area unavailable" : `${z.area.toFixed(2)} m²`,
    }))
    .sort((a, b) => a.room.localeCompare(b.room));
}
```

- [x] **Step 5: Run it.** `pnpm --filter @fm/scripts test`. Expected: PASS, 3 tests.

- [x] **Step 6: Add the CLI entry** `scripts/build-room.ts`:

```ts
import { buildRoom, describeRooms } from "./src/rooms";

console.log("Flatmate: a room built through the domain API only (no editor, no UI, no server)");
console.table(describeRooms(buildRoom()));
```

In the root `package.json`, add this entry to the existing `scripts` object:

```json
"demo:script": "tsx scripts/build-room.ts"
```

Run `pnpm demo:script`. Expected: the heading line, then a table with two rows: `Kitchen` with `8.64 m²` and `Living` with `8.64 m²`.

- [x] **Step 7: Check and commit.**

```bash
pnpm check
git add pnpm-workspace.yaml package.json pnpm-lock.yaml scripts/package.json scripts/tsconfig.json scripts/src/rooms.ts scripts/test/rooms.test.ts scripts/build-room.ts
git commit -m "scripts: domain-only room script for demo step 9"
```

- [x] **Step 8: Memory.** Add an `implementation.md` decision row (2026-MM-DD, §2.2/§2.3): "`scripts/` is the `@fm/scripts` workspace package (a CLI shell with Node typings); it may import `@fm/domain` and `@fm/protocol` only". Add a Sprint log row.

### Task 8.2: Palette and styling pass

**Files:**

- Create: `packages/editor/test/view/colors.test.ts`.
- Modify: `packages/editor/src/view/colors.ts`, `packages/web/src/main.tsx`, and `packages/web/src/app.tsx` and `packages/web/src/panels/*.tsx` (class hooks only).
- Modify: `packages/web/src/styles.css` (append only).

Scope: colour constants, CSS, and class/ARIA hooks. Do not change layout or behaviour. If a panel looks wrong because of its structure, log it in the Sprint log and leave it for a follow-up.

- [x] **Step 1: Write the guard test** `packages/editor/test/view/colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLORS } from "../../src/view/colors";

function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb or #rrggbbaa colour: ${hex}`);
  return [parseInt(m[1] ?? "0", 16), parseInt(m[2] ?? "0", 16), parseInt(m[3] ?? "0", 16)];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("COLORS", () => {
  it("uses hex colours only, so renderers and tests can compare them", () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(() => channels(value), name).not.toThrow();
    }
  });

  it("keeps walls and text readable on the canvas background (WCAG contrast)", () => {
    expect(contrast(COLORS.wall, COLORS.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(COLORS.text, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.textMuted, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.helper, COLORS.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLORS.invalid, COLORS.background)).toBeGreaterThanOrEqual(3);
  });

  it("keeps invalid distinct from selection and preview", () => {
    const rgb = (c: string) => c.slice(0, 7).toLowerCase();
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.wallSelected));
    expect(rgb(COLORS.invalid)).not.toBe(rgb(COLORS.preview));
  });
});
```

- [x] **Step 2: Run it.** `pnpm --filter @fm/editor test test/view/colors.test.ts`.
  - Expected: FAIL if the phase 3 palette uses `rgba()` strings or misses a contrast target.
  - It may already pass. In that case the new palette must keep it passing; record which case applied in the Sprint log.

- [x] **Step 3: Replace the palette** in `packages/editor/src/view/colors.ts`:
  - Keep any keys that phases 3–7 added beyond the README contract, such as presence defaults, and convert their values to hex.
  - Keep `as const`.

```ts
// Light theme. Hex only (#rrggbb or #rrggbbaa): renderers and tests compare these values.
// Keep background equal to --fm-bg in packages/web/src/styles.css.
export const COLORS = {
  background: "#f4f4f2", // light warm grey canvas
  grid: "#e7e7e3",
  gridMajor: "#d8d8d3",
  wall: "#1d1d1f", // near-black walls
  wallSelected: "#2563eb", // blue selection
  wallHover: "#4b4b50",
  preview: "#2563eb99", // translucent blue preview
  invalid: "#e5484d", // red invalid preview, ghost and toasts
  handle: "#ffffff",
  handleFixed: "#2563eb",
  snap: "#d97706",
  zoneFill: "#dce8f7aa", // soft blue floor
  zoneFillSelected: "#b9d0f2cc",
  zoneHint: "#2563eb1f", // faint unlabelled-room hint while Z is active
  text: "#1d1d1f",
  textMuted: "#6b6b70",
  helper: "#0f766e", // teal: distinct from the blue selection, so helper text is easy to tell apart (and to filter in tests)
} as const;
```

Contrast on `#f4f4f2`, computed with the formula in the test:

| Colour | Hex | Contrast |
|--------|-----|----------|
| wall | `#1d1d1f` | ≈ 15.4 |
| helper | `#0f766e` | ≈ 5.0 |
| textMuted | `#6b6b70` | ≈ 4.8 |
| invalid | `#e5484d` | ≈ 3.6 |

- [x] **Step 4: Run it.** `pnpm --filter @fm/editor test`. Expected: PASS.
  - If an existing editor test asserted an old colour value, update it to the constant name (`COLORS.x`), never to the literal.
  - Log it in the Sprint log.

- [x] **Step 5: Styling hooks.** Make sure each element below has the listed class. Add `className` to the existing root element, keeping any classes already there; add no wrapper elements.

| Component | Element | Class |
|-----------|---------|-------|
| `app.tsx` | outermost element | `fm-app` |
| `app.tsx` | the canvas's parent element | `fm-stage` |
| `panels/Toolbar.tsx` | root | `fm-toolbar` |
| `panels/CommandBar.tsx` | root | `fm-commandbar` |
| `panels/PropertiesPanel.tsx` | root | `fm-properties` |
| `panels/StatusBar.tsx` | root | `fm-statusbar` |
| `panels/Toast.tsx` | root | `fm-toast` |
| `panels/ProjectList.tsx` | root | `fm-projectlist` |

Each tool button in `Toolbar.tsx` carries `aria-pressed`, for example:

```tsx
<button type="button" aria-pressed={view.activeTool === "wall"} onClick={() => send({ type: "pickTool", tool: "wall" })}>
  Wall <kbd>W</kbd>
</button>
```

Keep the existing handler and label; only add `aria-pressed` if it is missing. `send` and `view` stand for whatever phase 4 named the props.

- [x] **Step 6: Append** to `packages/web/src/styles.css` (revised at review: the file already holds phase 4's layout and phase 7's project list; replacing it would move the canvas that the e2e specs map world points through). Keep every existing rule; the block below only restyles, and because it comes last it wins over the phase 4 rules of equal specificity. `main.tsx` already imports the file (phase 4).

```css
/* Phase 8 visual pass: tokens and restyling only; layout stays in the rules above.
   Keep --fm-bg equal to COLORS.background (packages/editor/src/view/colors.ts). */
:root {
  --fm-bg: #f4f4f2;
  --fm-panel: #ffffff;
  --fm-border: #e2e2de;
  --fm-text: #1d1d1f;
  --fm-muted: #6b6b70;
  --fm-accent: #2563eb;
  --fm-accent-soft: #2563eb14;
  --fm-danger: #e5484d;
  --fm-radius: 8px;
  --fm-shadow: 0 1px 2px #0000000f, 0 4px 12px #00000014;
  --fm-font: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --fm-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  /* the phase 4 tokens follow the palette */
  --bg: var(--fm-bg);
  --panel: var(--fm-panel);
  --border: var(--fm-border);
  --text: var(--fm-text);
  --muted: var(--fm-muted);
  --accent: var(--fm-accent);
  --danger: var(--fm-danger);
  font-family: var(--fm-font);
  -webkit-font-smoothing: antialiased;
}

.fm-toolbar button { border-color: transparent; background: transparent; }
.fm-toolbar button:hover:not(:disabled) { background: #0000000a; }
.fm-toolbar button[aria-pressed="true"] { background: var(--fm-accent-soft); border-color: transparent; color: var(--fm-accent); font-weight: 600; }
.fm-toolbar kbd { font: 11px var(--fm-mono); color: var(--fm-muted); }

.fm-commandbar { font-family: var(--fm-mono); }

.fm-properties .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.fm-properties input:focus { outline: 2px solid var(--fm-accent); outline-offset: -1px; border-color: transparent; }

.fm-toast { border-radius: var(--fm-radius); box-shadow: var(--fm-shadow); font-weight: 500; }

.fm-projectlist form, .fm-projectlist ul { background: var(--fm-panel); border: 1px solid var(--fm-border); border-radius: var(--fm-radius); box-shadow: var(--fm-shadow); padding: 12px; }
```

- [x] **Step 7: Visual check.** Run `pnpm dev`, open `http://localhost:5173`, draw the demo room (steps 2–4 of §1.4, local mode) and check each item:
  - near-black walls on light grey;
  - blue selection and handles;
  - a red invalid preview while dragging onto the divider;
  - soft blue zone fills, and tags readable at 100% zoom;
  - the command bar in monospace;
  - the toast centred at the bottom.

  Note anything that fails in the Sprint log.

- [x] **Step 8: Run all tests** (`pnpm check && pnpm e2e`). An e2e test that depended on a colour or class name gets fixed to use roles or text, never a colour.

- [x] **Step 9: Commit.**

```bash
git add packages/editor/src/view/colors.ts packages/editor/test/view/colors.test.ts packages/web/src/styles.css packages/web/src/main.tsx packages/web/src/app.tsx packages/web/src/panels
git commit -m "polish: light palette, panel styling and contrast guard"
```

- [x] **Step 10: Memory.** In `rendering.md`, add a decision row (2026-MM-DD, §6.1): "Palette is hex-only in `COLORS`, guarded by a WCAG contrast test; `--fm-bg` mirrors `COLORS.background`". Add a Sprint log row.

### Task 8.3: Narrated headless scenario (demo step 9a)

**Files:**

- Create: `packages/editor/test/scenarios/demo-narrated.test.ts`.
- Modify: the root `package.json` (`demo:headless`).

The narrated file tells the demo as a story: one `it` per step, sharing one `FakeShell`, so the verbose reporter prints the steps as a checklist on screen. `test/scenarios/demo.test.ts` (phases 3/5) remains the regression test. This file exists to be shown.

Assumptions (listed under Contract extensions):

- Clicking the `at` point of the helper-dimension text primitive starts helper editing (phase 5 hit-test).
- The typed-length direction comes from the last pointer event (`state.pointer`), so Shift only needs to be held while moving.

- [x] **Step 1: Write the scenario** `packages/editor/test/scenarios/demo-narrated.test.ts`:

```ts
// Demo step 9a (spec §1.4): steps 2–6 of the five-minute demo, replayed through the headless editor.
// No DOM, no canvas, no server: pointer and key events go in, effects and a ViewModel come out.
// Run on screen with: pnpm demo:headless
import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import type { Document, Joint } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../../src/view/colors";
import type { Scene } from "../../src/view/scene-types";
import { FakeShell } from "../fake-shell";

const SHIFT = { shift: true };

function jointAt(doc: Document, p: Point): Joint | undefined {
  return Object.values(doc.joints).find((j) => Math.abs(j.x - p.x) < 1e-9 && Math.abs(j.y - p.y) < 1e-9);
}

function areas(doc: Document): number[] {
  return zones(doc)
    .map((z) => z.area ?? Number.NaN)
    .sort((a, b) => a - b);
}

function field(shell: FakeShell, id: string): string {
  const props = shell.view().properties;
  if (props.kind === "none") throw new Error("nothing is selected");
  const f = props.fields.find((x) => x.id === id);
  if (!f) throw new Error(`no property field "${id}"`);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

function textAnchor(scene: Scene, prefix: string): Point {
  for (const layer of scene.layers) {
    for (const p of layer.primitives) {
      if (p.kind === "text" && p.text.startsWith(prefix)) return p.at;
    }
  }
  throw new Error(`no text starting with "${prefix}" in the scene`);
}

function usesColor(scene: Scene, hex: string): boolean {
  const rgb = hex.slice(0, 7).toLowerCase();
  return scene.layers.some((l) => l.primitives.some((p) => p.color.toLowerCase().startsWith(rgb)));
}

describe("Flatmate demo, headless (steps 2–6)", () => {
  const shell = FakeShell.local();

  it("step 2: W, then a 6 × 4 m room from typed lengths, moving with Shift so directions stay orthogonal", () => {
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.moveTo({ x: 2, y: 0.1 }, SHIFT);
    shell.type("6", SHIFT); // Shift stays held while typing (spec §5.4)
    shell.key("Enter", SHIFT);
    shell.moveTo({ x: 6.1, y: 2 }, SHIFT);
    shell.type("4", SHIFT);
    shell.key("Enter", SHIFT);
    shell.moveTo({ x: 3, y: 4.1 }, SHIFT);
    shell.type("6", SHIFT);
    shell.key("Enter", SHIFT);
    shell.click({ x: 0.05, y: 0.02 }, SHIFT); // clicking the first joint closes the chain

    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
    for (const p of [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]) {
      expect(jointAt(shell.doc(), p), `joint at (${p.x}, ${p.y})`).toBeDefined();
    }
    expect(shell.view().commandBar.prompt).toBe("First point");
  });

  it("step 3: a divider between the two wall midpoints; the midpoint snap makes both ends exact", () => {
    shell.moveTo({ x: 3.07, y: 0.02 });
    expect(shell.view().snap).toEqual({ kind: "midpoint", at: { x: 3, y: 0 } });
    shell.click({ x: 3.07, y: 0.02 });
    shell.moveTo({ x: 2.96, y: 3.97 }, SHIFT);
    expect(shell.view().snap).toEqual({ kind: "midpoint", at: { x: 3, y: 4 } });
    shell.click({ x: 2.96, y: 3.97 }, SHIFT);
    shell.key("Enter"); // an empty value finishes the chain

    expect(Object.keys(shell.doc().walls)).toHaveLength(7); // the bottom and top walls split at T-junctions
    expect(jointAt(shell.doc(), { x: 3, y: 0 })).toBeDefined();
    expect(jointAt(shell.doc(), { x: 3, y: 4 })).toBeDefined();
    expect(zones(shell.doc())).toHaveLength(2);
  });

  it("step 4: Z, click inside each room: each tag shows 10.64 m² with 0.20 m walls", () => {
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    expect(field(shell, "area")).toBe("10.64 m²");
    shell.click({ x: 4.5, y: 2 });

    expect(Object.keys(shell.doc().zoneLabels)).toHaveLength(2);
    expect(areas(shell.doc()).map((a) => a.toFixed(2))).toEqual(["10.64", "10.64"]);
  });

  it("step 5: select the right wall, click its helper, type 3.5: the top-right joint moves to (6, 3.5)", () => {
    shell.key("v");
    shell.click({ x: 6, y: 2 });
    expect(shell.view().properties.kind).toBe("wall");
    expect(field(shell, "length")).toMatch(/^4\.00/);

    shell.click(textAnchor(shell.scene(), "4.00"));
    expect(shell.view().commandBar.prompt).toBe("Wall length");
    shell.type("3.5");
    shell.key("Enter");

    expect(jointAt(shell.doc(), { x: 6, y: 3.5 })).toBeDefined();
    expect(jointAt(shell.doc(), { x: 6, y: 4 })).toBeUndefined();
    const [right, left] = areas(shell.doc());
    expect(right).toBeCloseTo(9.94, 2); // the top wall now slopes
    expect(left).toBeCloseTo(10.64, 6);
  });

  it("step 6: dragging that joint across the divider turns red and reverts on release", () => {
    const before = shell.doc();
    shell.down({ x: 6, y: 3.5 }); // the selected wall's handle
    shell.moveTo({ x: 4, y: 2.8 }); // passing through: still valid
    expect(usesColor(shell.scene(), COLORS.invalid)).toBe(false);
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    expect(usesColor(shell.scene(), COLORS.invalid)).toBe(true);
    shell.up({ x: 2, y: 2 });

    expect(shell.doc()).toEqual(before);
    expect(shell.view().toast).toBe("Walls can't cross");

    const doc = shell.doc();
    console.table(
      zones(doc).map((z) => ({
        room: z.labelIds.map((id) => doc.zoneLabels[id]?.name ?? id).join(" / "),
        area: z.area === null ? "Area unavailable" : `${z.area.toFixed(2)} m²`,
      })),
    );
  });
});
```

Numbers used above:

- The right room after step 5 has centreline corners (3, 0), (6, 0), (6, 3.5) and (3, 4).
- Its inset top edge is y = 4.5 − x/6 − 0.1014.
- The inset polygon is a trapezoid 2.8 m wide with heights 3.3153 and 3.7820, so its area is 9.936 m².

- [x] **Step 2: Run it.** `pnpm --filter @fm/editor exec vitest run test/scenarios/demo-narrated.test.ts --reporter=verbose`.
  - This file exercises finished behaviour, so the expected result is PASS: five named steps and a two-row table.
  - A failure is a real bug found on the demo path. Fix it test-first in the owning package, with the same step in `demo.test.ts` as the regression. Log it and record it in memory (README working rule 5).
  - If step 5 fails only because the helper cannot be clicked at its text anchor, do not change this test. Reconcile with phase 5's hit-test and record the rule in `editor-interaction.md`.

- [x] **Step 3: Root script.** Add this entry to the root `package.json` `scripts`:

```json
"demo:headless": "pnpm --filter @fm/editor exec vitest run test/scenarios/demo-narrated.test.ts --reporter=verbose"
```

Run `pnpm demo:headless`. Expected: the same PASS output as step 2.

- [x] **Step 4: Check and commit.**

```bash
pnpm check
git add packages/editor/test/scenarios/demo-narrated.test.ts package.json
git commit -m "editor: narrated headless demo scenario for demo step 9"
```

### Task 8.4: Seeded fallback project

**Files:**

- Create: `packages/server/scripts/seed-demo.ts`, `packages/server/scripts/run-seed-demo.ts` and `packages/server/test/seed-demo.test.ts`.
- Modify: `packages/server/tsconfig.json` and the root `package.json`.

The seed builds the demo apartment with domain commands and accepts each one through the server's own `decideSubmit`. This gives the stored project real `seq`, versions and receipts. The file lives in `packages/server/scripts/`, outside `src/`, so the dependency-cruiser rule that only `adapters/domain-validator.ts` in `src` imports `@fm/domain` still holds.

- [x] **Step 1: Include the scripts folder.** In `packages/server/tsconfig.json`, add `"scripts"` to `include`, for example `"include": ["src", "test", "scripts"]`. Keep the existing entries.

- [x] **Step 2: Write the failing test** `packages/server/test/seed-demo.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromStored, zones } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { SAMPLE_NAME, sampleCommands, seedDemo } from "../scripts/seed-demo";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-seed-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("seedDemo", () => {
  it("stores the sample apartment through the ordinary submit decision", async () => {
    const meta = await seedDemo(createJsonFileRepository(dir));

    const repo = createJsonFileRepository(dir); // a fresh instance reads back from disk
    expect((await repo.list()).map((p) => p.name)).toEqual([SAMPLE_NAME]);
    const state = await repo.load(meta.id);
    if (!state) throw new Error("the sample project was not saved");

    expect(state.seq).toBe(sampleCommands().length);
    expect(Object.keys(state.receipts)).toHaveLength(sampleCommands().length);
    expect(domainValidator.validate(state.doc)).toEqual({ ok: true });

    const doc = unwrap(fromStored(state.doc));
    expect(zones(doc).map((z) => z.area?.toFixed(2)).sort()).toEqual(["10.64", "10.64"]);
    expect(Object.values(doc.zoneLabels).map((l) => l.name).sort()).toEqual(["Kitchen", "Living"]);
  });

  it("does not create a second sample project", async () => {
    const repo = createJsonFileRepository(dir);
    const first = await seedDemo(repo);
    const second = await seedDemo(repo);
    expect(second).toEqual(first);
    expect(await repo.list()).toHaveLength(1);
  });
});
```

- [x] **Step 3: Run it.** `pnpm --filter @fm/server test test/seed-demo.test.ts`. Expected: FAIL, because `../scripts/seed-demo` cannot be resolved.

- [x] **Step 4: Implement** `packages/server/scripts/seed-demo.ts`:

```ts
// Demo fallback (spec §1.4): a "Sample apartment" project, built with domain commands and accepted through the
// server's own submit decision, so its seq, version map and receipts look exactly like a drawn project's.
import { emptyDocument, execute, rectangleRoom } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { buildExpectations, patchWrites, uniqueKeys, unwrap } from "@fm/protocol";
import type { Changeset, ProjectMeta } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { decideSubmit } from "../src/app/decide-submit";
import type { ProjectRepository, ProjectState } from "../src/app/ports";

export const SAMPLE_NAME = "Sample apartment";

/** The demo apartment after steps 2–4: 6 × 4 m, divider at x = 3, two labelled rooms. */
export function sampleCommands(): Command[] {
  return [
    ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "sample"),
    { type: "addWall", opId: "sample-divider", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } },
    { type: "labelZone", id: "sample-kitchen", at: { x: 1.5, y: 2 }, name: "Kitchen" },
    { type: "labelZone", id: "sample-living", at: { x: 4.5, y: 2 }, name: "Living" },
  ];
}

export async function seedDemo(repository: ProjectRepository): Promise<ProjectMeta> {
  const existing = (await repository.list()).find((p) => p.name === SAMPLE_NAME);
  if (existing) return existing;

  let state: ProjectState = await repository.create(SAMPLE_NAME);
  let doc: Document = emptyDocument();
  for (const [i, cmd] of sampleCommands().entries()) {
    const { doc: next, patch } = unwrap(execute(doc, cmd));
    const changeset: Changeset = {
      id: `seed-${i}`,
      patch: { puts: patch.puts, deletes: patch.deletes },
      expect: buildExpectations(state.versions, uniqueKeys([...patchWrites(patch), ...patch.dependencies])),
    };
    const decision = decideSubmit(state, changeset, domainValidator);
    if (decision.kind !== "accept") {
      throw new Error(`seed step ${i} (${cmd.type}) was not accepted: ${JSON.stringify(decision)}`);
    }
    state = decision.next;
    doc = next;
  }
  await repository.save(state);
  return state.meta;
}
```

- [x] **Step 5: Run it.** `pnpm --filter @fm/server test test/seed-demo.test.ts`. Expected: PASS, 2 tests.

- [x] **Step 6: CLI entry** `packages/server/scripts/run-seed-demo.ts`:

```ts
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedDemo } from "./seed-demo";

// Same directory rule as src/main.ts (phase 6).
const dir = process.env.DATA_DIR ?? "./data";
const meta = await seedDemo(createJsonFileRepository(dir));
console.log(`"${meta.name}" is ready in ${dir} (project ${meta.id}).`);
```

Before running it, open `packages/server/src/main.ts` and check how it chooses its data directory. If it uses a different variable or default, use the same one here so the seed lands where the server reads, and add a Sprint log row.

In the root `package.json` `scripts`, add:

```json
"demo:seed": "pnpm --filter @fm/server exec tsx scripts/run-seed-demo.ts"
```

Run `pnpm demo:seed` twice. Expected:
- Each run prints `"Sample apartment" is ready in data (project …)` with the same project ID.
- `ls packages/server/data` shows one project file for it.

- [x] **Step 7: Check and commit.**

```bash
pnpm check
git add packages/server/scripts/seed-demo.ts packages/server/scripts/run-seed-demo.ts packages/server/test/seed-demo.test.ts packages/server/tsconfig.json package.json
git commit -m "server: seed a sample apartment through decideSubmit as a demo fallback"
```

- [x] **Step 8: Memory.** In `implementation.md`, add a row: "Seed data goes through `decideSubmit` (same seq, versions and receipts as live edits); seed scripts live in `packages/server/scripts/`, outside `src/`, because they import `@fm/domain`". Add a Sprint log row.

### Task 8.5: One-command demo launcher

**Files:**

- Create: `scripts/demo.sh`.
- Modify: the root `package.json`.

- [x] **Step 1: Write** `scripts/demo.sh`:

```bash
#!/usr/bin/env bash
# Demo: the collaboration server (crash-only restart loop, spec §7.2) plus the web app.
# Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_SERVER_URL="${VITE_SERVER_URL:-ws://localhost:8787}"

cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true   # every process in this script's process group
}
trap cleanup INT TERM EXIT

pnpm dev:server &
pnpm dev &

echo
echo "  Server: $VITE_SERVER_URL"
echo "  Alice:  http://localhost:5173/?name=Alice"
echo "  Bob:    http://localhost:5173/?name=Bob"
echo

wait
```

Then run `chmod +x scripts/demo.sh`. In the root `package.json` `scripts`, add:

```json
"demo": "bash scripts/demo.sh"
```

The script targets bash 3.2, which macOS ships: it uses no `wait -n`.

- [x] **Step 2: Verify manually.**
  1. Run `pnpm demo`. Expected:
     - both the server's and Vite's start-up lines, then the three URL lines;
     - `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173` prints `200`;
     - `nc -z localhost 8787 && echo up` prints `up`.
  2. Press Ctrl+C. Expected: `lsof -i :8787 -i :5173` prints nothing.
  3. If the server's port is not 8787, align `VITE_SERVER_URL` with `packages/server/src/main.ts` and log it.

- [x] **Step 3: Commit.**

```bash
git add scripts/demo.sh package.json
git commit -m "demo: one-command launcher for server and web app"
```

### Task 8.6: Demo screenshots with Playwright

> **Cut (revised: lean mode, 2026-09-29).** Skip; no committed screenshots.

**Files:**

- Create: `packages/web/e2e/support/demo-driver.ts`, `packages/web/e2e/screenshots.spec.ts` and `docs/reports/screenshots/`.
- Modify: the root `package.json`.

The spec runs only with `FM_SCREENSHOTS=1` against a running `pnpm demo`, so the normal `pnpm e2e` run never overwrites committed images. It uses absolute URLs and does not depend on the Playwright config's `webServer`.

Assumptions (listed under Contract extensions; reconcile with phases 5 and 7 if they differ):

- The `ProjectList` panel has an input with placeholder `Project name`, a `Create` button, and one button per project named after it.
- The helper text is centred `WALL_THICKNESS / 2 + 18 px` to the left of the wall's a→b direction, from its midpoint.

Phase 5 already created `packages/web/e2e/support/canvas.ts` (world→page mapping, `drawRoomWithDivider`) and phase 5's `helperLabelAt` defines the helper position (midpoint + left normal · (WALL_THICKNESS/2 + 18 px / zoom)). The driver below imports those helpers from `canvas.ts` (plus phase 7's `typeLengthAndWait`) and keeps only what is missing. The narrated headless scenario (Task 8.3) keeps its steps inline on purpose, because it is shown on screen; `demo-steps.ts` stays the regression helpers (revised at review).

- [ ] **Step 1: Write** `packages/web/e2e/support/demo-driver.ts`. It reuses phase 5's and phase 7's helpers from `./canvas` and adds only what the screenshot run needs in server mode: waiting for each edit to settle, opening a project by name, and the helper's page position (revised at review: in server mode a wall chain pauses after every segment and digits typed meanwhile are ignored, so every commit waits for the server):

```ts
import { expect, type Page } from "@playwright/test";
import { ZOOM, clickAt, moveTo, toScreen, typeLengthAndWait, type WorldPoint } from "./canvas";

const HALF_WALL = 0.1; // WALL_THICKNESS / 2
const HELPER_OFFSET_PX = 18; // phase 5's helperLabelAt: the text centre is 18 px beyond the wall face

export const canvasOf = (page: Page) => page.getByTestId("canvas");

export async function worldToPage(page: Page, p: WorldPoint): Promise<WorldPoint> {
  return toScreen(canvasOf(page), p);
}

/** Server mode: one edit is outstanding at a time (spec §7.4), so wait for it before the next one. */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("project-status")).toHaveText("saved");
}

/** Server mode: open the project by name, creating it first if it does not exist (demo steps 1 and 7). */
export async function openProject(page: Page, name: string): Promise<void> {
  const field = page.getByPlaceholder("Project name");
  await field.waitFor();
  const existing = page.getByRole("button", { name, exact: true });
  if ((await existing.count()) === 0) {
    await field.fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
  } else {
    await existing.click();
  }
  await field.waitFor({ state: "hidden" });
}

/** Demo steps 2–4 on a shared drawing: the 6 × 4 m room, the midpoint divider, and a zone in each room. */
export async function drawDemoApartment(page: Page): Promise<void> {
  const canvas = canvasOf(page);
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift"); // digits still type as digits: the input adapter reads the physical key (spec §5.4)
  const legs: [WorldPoint, string][] = [[{ x: 2, y: 0.1 }, "6"], [{ x: 6.1, y: 2 }, "4"], [{ x: 3, y: 4.1 }, "6"]];
  for (const [p, length] of legs) {
    await moveTo(page, canvas, p);
    await typeLengthAndWait(page, length);
  }
  await clickAt(page, canvas, { x: 0.05, y: 0.02 }); // the first joint closes the chain
  await page.keyboard.up("Shift");
  await waitSaved(page);

  await clickAt(page, canvas, { x: 3.07, y: 0.02 }); // midpoint snap → (3, 0)
  await page.keyboard.down("Shift");
  await clickAt(page, canvas, { x: 2.96, y: 3.97 }); // vertical axis + midpoint snap → (3, 4)
  await page.keyboard.up("Shift");
  await waitSaved(page);
  await page.keyboard.press("Enter"); // the chain resumed; an empty Enter finishes it

  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 1.5, y: 2 });
  await waitSaved(page);
  await clickAt(page, canvas, { x: 4.5, y: 2 });
  await waitSaved(page);
}

/** Page position of the helper dimension text of the wall a→b (mirrors helperLabelAt at the default zoom). */
export async function helperLabelPage(page: Page, a: WorldPoint, b: WorldPoint): Promise<WorldPoint> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const offset = HALF_WALL + HELPER_OFFSET_PX / ZOOM;
  return worldToPage(page, { x: (a.x + b.x) / 2 + left.x * offset, y: (a.y + b.y) / 2 + left.y * offset });
}
```

- [ ] **Step 2: Write** `packages/web/e2e/screenshots.spec.ts`:

```ts
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { clickAt, moveTo } from "./support/canvas";
import { canvasOf, drawDemoApartment, helperLabelPage, openProject, waitSaved, worldToPage } from "./support/demo-driver";

const OUT = fileURLToPath(new URL("../../../docs/reports/screenshots/", import.meta.url));
const APP = process.env.RM_APP_URL ?? "http://localhost:5173";
const VIEWPORT = { width: 1280, height: 800 };

test.skip(!process.env.FM_SCREENSHOTS, "run with FM_SCREENSHOTS=1 while `pnpm demo` is running");

test("demo screenshots: zones, helper editing, invalid drag, two windows", async ({ browser }) => {
  const project = `Apartment ${Date.now()}`;

  const aliceContext = await browser.newContext({ viewport: VIEWPORT });
  const alice = await aliceContext.newPage();
  await alice.goto(`${APP}/?name=Alice`);
  await openProject(alice, project);

  // Steps 2–4
  await drawDemoApartment(alice);
  await expect(alice.locator('[data-field-id="area"]')).toHaveValue("10.64 m²"); // canvas text is not in the DOM (README P14)
  await alice.screenshot({ path: `${OUT}room-with-zones.png` });

  // Step 5, before Enter
  await alice.keyboard.press("v");
  await clickAt(alice, canvasOf(alice), { x: 6, y: 2 });
  const helper = await helperLabelPage(alice, { x: 6, y: 0 }, { x: 6, y: 4 });
  await alice.mouse.click(helper.x, helper.y);
  await alice.keyboard.type("3.5");
  await alice.screenshot({ path: `${OUT}helper-editing.png` });
  await alice.keyboard.press("Enter");
  await waitSaved(alice); // the drag below cannot start while the resize is outstanding

  // Step 6, while the pointer is still down
  const joint = await worldToPage(alice, { x: 6, y: 3.5 });
  const through = await worldToPage(alice, { x: 4, y: 2.8 });
  const invalid = await worldToPage(alice, { x: 2, y: 2 });
  await alice.mouse.move(joint.x, joint.y);
  await alice.mouse.down();
  await alice.mouse.move(through.x, through.y, { steps: 5 });
  await alice.mouse.move(invalid.x, invalid.y, { steps: 5 });
  await alice.screenshot({ path: `${OUT}invalid-drag.png` });
  await alice.mouse.up();
  await expect(alice.getByText("Walls can't cross")).toBeVisible();

  // Step 7
  const bobContext = await browser.newContext({ viewport: VIEWPORT });
  const bob = await bobContext.newPage();
  await bob.goto(`${APP}/?name=Bob`);
  await openProject(bob, project);
  await moveTo(bob, canvasOf(bob), { x: 4.5, y: 1 });
  await expect(alice.getByText("Bob")).toBeVisible();
  await alice.screenshot({ path: `${OUT}two-windows-alice.png` });
  await bob.screenshot({ path: `${OUT}two-windows-bob.png` });

  await aliceContext.close();
  await bobContext.close();
});
```

In the root `package.json` `scripts`, add:

```json
"screenshots": "FM_SCREENSHOTS=1 pnpm --filter @fm/web exec playwright test e2e/screenshots.spec.ts"
```

- [ ] **Step 3: Run it.**
  1. `mkdir -p docs/reports/screenshots`.
  2. Start `pnpm demo` in a second terminal.
  3. Run `pnpm screenshots`.

  Expected: 1 passed, and five PNG files in `docs/reports/screenshots/`.

  Also run `pnpm e2e` without the variable. Expected: this spec is reported as skipped, and the rest pass.

  Open each image and check it against the Task 8.2 Step 7 list. A failure in the helper click or the project-list selectors means phases 5 and 7 chose differently. Align this driver with them rather than changing the app, and log it.

- [ ] **Step 4: Commit.**

```bash
pnpm check
git add packages/web/e2e/support/demo-driver.ts packages/web/e2e/screenshots.spec.ts docs/reports/screenshots package.json
git commit -m "web: Playwright demo screenshots"
```

### Task 8.7: Root README

**Files:** Create: `README.md`.

Rules: every factual claim must be backed by a test or a command, and Step 2 audits this. Mention no WebGL, performance or durability beyond what spec §7.2 states. Do not mention who created Crux (`scope.md`: unverified).

- [x] **Step 1: Write** `README.md`:

````markdown
# Flatmate

A small collaborative 2D CAD editor for floor plans.

You draw walls with the keyboard and mouse, click inside a room to see its clear area, resize a wall by typing its length, and edit the same drawing from two browser windows. Underneath, the drawing rules and the editing behaviour live in two platform-neutral TypeScript packages that run unchanged in the browser, in tests and on the server.

## Run it

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
pnpm demo              # collaboration server (restarts itself after a crash) + web app
```

Open two windows side by side:

- http://localhost:5173/?name=Alice
- http://localhost:5173/?name=Bob

| Command | What it does |
|---------|--------------|
| `pnpm demo:seed` | adds a "Sample apartment" project (a finished demo room) |
| `pnpm demo:headless` | replays the drawing part of the demo in the headless editor, step by step |
| `pnpm demo:script` | builds a room through the domain API only and prints its areas |
| `pnpm check` | typecheck, lint, dependency rules and all unit/integration tests |
| `pnpm e2e` | Playwright tests in Chromium |

## The five-minute demo

1. As Alice, create a project called "Apartment".
2. Press `W`. Click the origin. Holding `Shift`, move right, type `6` and `Enter`. Do the same with `4` up and `6` left, then click the first joint to close the room.
3. Draw a divider between the midpoints of the bottom and top walls. The midpoint snap makes both ends exact, and the walls split at T-junctions.
4. Press `Z` and click inside each room: each shows 10.64 m² (walls are 0.20 m thick).
5. Select the right wall, click its length, type `3.5`: the top-right corner moves down and the areas update.
6. Drag that corner across the divider: the preview turns red and snaps back on release.
7. Open "Apartment" as Bob: both cursors are visible, and Bob's changes show up for Alice.
8. Alice moves a joint twice and undoes both; after Bob edits that joint, Alice's redo is refused with an explanation.
9. `pnpm demo:headless` and `pnpm demo:script` show the same core without a browser.

## Architecture

```
┌──────────────────────────── shells (platform-specific) ────────────────────────────┐
│  web: React panels · Canvas2D · DOM input · WebSocket     server: Node · JSON files │
│  tests: fake shell                                         scripts: CLI             │
│                                                                                     │
│   ┌──────────────────── @fm/editor (no DOM, no network) ─────────────────────┐      │
│   │  tools (Select, Wall, Zone) · snapping · camera · undo · open document    │      │
│   │  update(state, event, host) → { state, effects }                          │      │
│   │                                                                           │      │
│   │     ┌────────────── @fm/domain (pure functions) ──────────────┐           │      │
│   │     │  joints, walls, zone labels · commands · invariants     │           │      │
│   │     │  patches · outlines · zones and areas                   │           │      │
│   │     └─────────────────────────────────────────────────────────┘           │      │
│   └───────────────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────────┘
          dependencies point inward only; checked by dependency-cruiser in `pnpm check`
```

| Package | Role |
|---------|------|
| `@fm/protocol` | wire messages, patch and changeset types, small shared helpers |
| `@fm/domain` | the document kernel: what a valid floor plan is and how commands change it |
| `@fm/editor` | how a person edits it: events in, effects out (render, submit, timers) |
| `@fm/web` | the browser shell: React panels, Canvas2D renderer, input and WebSocket adapters |
| `@fm/server` | project storage and collaboration; floor-plan validity comes in through a validator port |
| `@fm/sync-tests` | two headless editors against the in-memory server |
| `@fm/scripts` | command-line scripts that use the domain directly |

The editor never touches the DOM, the network or the clock. It receives events (`pointerDown`, `key`, `serverEvent`, …) and returns effects (`render`, `submit`, `startTimer`, …) as plain data, and the shell performs them. Sync questions it needs answered inside `update` (text width, time, new IDs) go through a small injected `Host`.

### How collaboration works

- The server is the source of truth. Each edit is a changeset: a value patch plus the versions of the entities it was built on.
- The server applies changesets one at a time per project. It accepts one only if those versions are unchanged and the resulting drawing is valid. The first writer wins; the second is rejected and its preview reverts. Nothing is merged.
- Each client keeps one edit in flight, with no local queue. The screen updates at once; new edits wait for the server's answer.
- The server writes each accepted change to the project's JSON file (temp file, sync, rename) before acknowledging it. It remembers every accepted changeset ID, so a resend after a reconnect is acknowledged instead of being applied twice.
- On a storage error the server exits, and the dev script restarts it. Clients reconnect, reload the project and resend their pending edit.
- Undo is local to each user and all-or-nothing. An entry becomes unavailable when someone else changes what it touched.

### Borrowed ideas

- [Crux](https://github.com/redbadger/crux) (Red Badger): a portable core with thin platform shells, talking in events and effects.
- Common desktop-editor patterns:
  - the injected `Host` port for synchronous queries;
  - preview-then-commit gestures (one change per drag);
  - snapping as independent policies plus a chooser;
  - a display list the renderer draws;
  - minimum-version serialization with JSON migrations;
  - fail-fast exhaustive switches.

## Testing

| Layer | What is tested | Where |
|-------|----------------|-------|
| Domain | invariants I1–I8, wall splits, mitered outlines, zones and clear areas, label merging, patches and inverses, serialization | `packages/domain/test` |
| Editor | reducer tables for local and shared documents; headless scenarios that drive the fake shell with pointer and key events | `packages/editor/test` |
| Sync | two headless editors against the in-memory server with the real domain validator: conflicts, rejections, resends, snapshots, undo races | `packages/sync-tests` |
| Server | submit decisions, serialized queue, JSON repository, restart and receipts, crash-only behaviour | `packages/server/test` |
| Web | Playwright in Chromium: draw a room and read its area; two windows see each other | `packages/web/e2e` |

## Limits

This is a demo, not a production CAD editor. Out of scope:

- openings, arc walls, editable wall thickness (fixed at 0.20 m), layers and styles;
- walls that cross another wall in its interior (T-junctions only);
- rooms nested inside rooms;
- multi-selection;
- offline editing;
- authentication;
- Safari.

Receipts and deleted-entity versions are never compacted. Ideas for later are listed, in order, in the spec's follow-up section; the first is a WebGL2 renderer behind the same `Renderer` port.

## Design documents

- Spec: [`docs/specs/flatmate-design.md`](docs/specs/flatmate-design.md)
- Design memory (decisions, reasons, mistakes not to repeat): [`docs/design-memory/INDEX.md`](docs/design-memory/INDEX.md)
- Implementation plan and gate reports: [`docs/plans/flatmate/`](docs/plans/flatmate/README.md), [`docs/reports/`](docs/reports/)
````

- [x] **Step 2: Claims audit.** (done by the README agent: every command run; claims corrected or dropped are listed in gate 8 §8) For each claim below, find the evidence named, run it, and copy the table into the Sprint log with a result column. Rewrite or remove any claim that has no evidence. Do not add a test just to justify a sentence unless the behaviour is in the spec.

| Claim | Evidence |
|-------|----------|
| Two windows see each other's cursors, and Bob's changes reach Alice | phase 7 Playwright spec; `pnpm screenshots` two-window step |
| Midpoint snap makes the divider exact | `demo-narrated.test.ts` step 3 |
| 10.64 m² per room | `demo-narrated.test.ts` step 4 |
| Invalid drag reverts | `demo-narrated.test.ts` step 6 |
| Redo refused after Bob's edit | phase 7 sync test for demo step 8 |
| Dependencies point inward, checked in `pnpm check` | `pnpm depcruise` (and the phase 1 negative check) |
| First writer wins; no merge | sync tests: same-entity concurrent moves |
| Write before ack; temp file, sync, rename | server repository and "ack only after repository completion" tests |
| Resend acknowledged, not applied twice | server receipt tests; sync "same-ID resend" test |
| Exit and restart on storage error | server crash-only tests; `packages/server/scripts/dev-server.sh` |
| Undo all-or-nothing, invalidated by others' edits | history tests; sync undo tests |
| Chromium only | `packages/web/playwright.config.ts` projects |

- [x] **Step 3: Commit.**

```bash
git add README.md
git commit -m "docs: project README"
```

### Task 8.8: Demo rehearsals

**Files:** Create: `docs/reports/demo-rehearsal.md`.

- [x] **Step 1: Write** `docs/reports/demo-rehearsal.md`:

```markdown
# Demo rehearsal

Target: steps 1–9 of spec §1.4 in under five minutes, twice in a row, without using a fallback.

## Pre-flight (before every rehearsal and before a live demo)

- [ ] `git status` clean; `pnpm install`; `pnpm check` and `pnpm e2e` green
- [ ] `pnpm demo:seed` (fallback project exists)
- [ ] `pnpm demo` running; Alice and Bob windows side by side at 100 % browser zoom
- [ ] a terminal ready with `pnpm demo:headless` and `pnpm demo:script` typed in
- [ ] notifications off; other tabs closed
- [ ] `Shift` may stay held while typing lengths: the input adapter reads digits from the physical key (spec §5.4)

## Steps

| # | Do | Expect on screen | If it fails | Target | Run 1 | Run 2 |
|---|----|------------------|-------------|--------|-------|-------|
| 1 | Alice: type "Apartment" in the project list, Create | empty canvas, project name in the status bar | server terminal: wait for the restart; reload; else open "Sample apartment" and skip to 5 | 0:20 | | |
| 2 | `W`; click origin; holding Shift: move right, `6` `Enter`; up `4`; left `6`; click first joint | closed 6 × 4 m room; prompt back to "First point" | `Cmd+Z` the bad wall and retype; else open "Sample apartment" | 0:40 | | |
| 3 | click bottom midpoint (midpoint glyph), Shift-click top midpoint, `Enter` | divider; T-junctions; two rooms | zoom in (`Ctrl` + wheel) until the midpoint glyph shows; `Cmd+Z` and redraw | 0:30 | | |
| 4 | `Z`; click inside each room | two tags, each 10.64 m² | "Area unavailable": the room is not closed; show the sample project | 0:20 | | |
| 5 | `V`; select the right wall; click its length; `3.5` `Enter` | top-right corner at (6, 3.5); top wall slopes; right room ≈ 9.94 m² | reselect the wall; click the length text again | 0:30 | | |
| 6 | drag the top-right corner to (2, 2) | red preview; reverts on release; toast "Walls can't cross" | release over empty space and retry slowly | 0:20 | | |
| 7 | Bob: open "Apartment"; move the cursor; move a wall | Bob's cursor in Alice's window; Alice's areas change | reload Bob; check both show the same project name | 0:40 | | |
| 8 | Alice: move one joint twice, undo twice; Bob moves that joint; Alice redoes | redo refused: "Can't redo: the drawing changed remotely" | explain the rule with the history panel state; it is the intended behaviour | 0:50 | | |
| 9 | terminal: `pnpm demo:headless`, then `pnpm demo:script` | five green steps and a zone table; the Kitchen/Living table | show `demo-narrated.test.ts` in the editor instead | 0:40 | | |
|   | **Total** | | | **4:50** | | |

## Notes

| Run | Step | What went wrong | Fix (commit) or fallback used |
|-----|------|-----------------|-------------------------------|
```

- [x] **Step 2: Rehearsal 1.** Run the pre-flight, then steps 1–9 with a stopwatch. Fill the Run 1 column and the Notes table. Every failure that is a bug gets fixed now through the normal loop:
  1. a failing test in the owning package (a headless scenario where possible);
  2. the fix;
  3. `pnpm check`;
  4. a commit;
  5. a memory entry and a Sprint log row.

  A failure caused by a demo instruction (for example, the step wording) is fixed in spec §1.4 and in this checklist, and recorded in `scope.md`.

- [x] **Step 3: Rehearsal 2.** Repeat from the pre-flight after all fixes. Fill in Run 2. If a step still fails or the total exceeds 5:00, the gate's completion criteria are not met: log the cause and ask the user whether to cut or simplify the step (AGENTS.md working style) before any further coding.

- [x] **Step 4: Commit.**

```bash
git add docs/reports/demo-rehearsal.md
git commit -m "docs: demo rehearsal checklist and results"
```

## Completion criteria

- [x] `pnpm demo:script` prints Kitchen 8.64 m² and Living 8.64 m². `scripts/test/rooms.test.ts` passes (spec §2.3, demo step 9b).
- [x] `pnpm demo:headless` passes five named steps covering demo steps 2–6 and prints the zone table (demo step 9a; spec §9 editor headless row).
- [x] `pnpm demo:seed` creates "Sample apartment" once. `seed-demo.test.ts` passes. Opening the project in the browser shows two zones of 10.64 m².
- [x] `pnpm demo` starts the server loop and the web app. Ctrl+C leaves nothing listening on 8787 or 5173.
- [x] `colors.test.ts` passes. `COLORS` and `styles.css` are the only visual changes, and no behaviour changed: `pnpm e2e` is green before and after.
- [ ] ~~Five screenshots~~ (Task 8.6 cut, lean mode; noted as an S1 risk) are committed in `docs/reports/screenshots/` and match the Task 8.2 Step 7 visual list.
- [x] The root `README.md` exists, and every claim in it has evidence in the claims audit, or was removed.
- [ ] Two timed rehearsals (run 1 scripted, all nine steps pass; run 2 by hand is for the user) are recorded in `docs/reports/demo-rehearsal.md`. The second has all nine steps passing without a fallback, in 5:00 or less.
- [x] `pnpm check` and `pnpm e2e` pass. The web Playwright smoke (spec §9) is green.
- [x] Every Sprint log row is reflected in design memory, and `INDEX.md` has today's date.

## Gate 8

Follow the [gate protocol](README.md#gate-protocol). This is the final gate. The report `docs/reports/gate-8-demo-polish.md` uses the template sections 1–9 and adds the sprint summary sections 10–14 below.

**Phase-specific verification** (record the output in report §3):

```bash
pnpm check
pnpm e2e
pnpm demo:script
pnpm demo:headless
DATA_DIR="$(mktemp -d)" pnpm demo:seed
pnpm demo            # in another terminal, then:
pnpm screenshots
```

Then run the rehearsal once more, as a dry run, and link its row in `demo-rehearsal.md`.

**Test count per layer.** Record the Vitest summary line of each package in report §3:

```bash
for p in protocol domain editor web server sync-tests scripts; do
  pnpm --filter "@fm/$p" test 2>&1 | grep -E "Tests +[0-9]+" | sed "s/^/$p: /"
done
pnpm e2e 2>&1 | grep -E "[0-9]+ (passed|skipped|failed)"
```

**Questions the report must answer:**

1. Which demo steps are fragile, why (timing, snapping near other candidates, a server restart, focus in a text field), and what is the fallback for each? Cross-check with the rehearsal notes.
2. What is the test count per layer (domain, editor, sync, server, web unit, Playwright, scripts)? Which spec §9 rows or acceptance scenarios have no test, and why?
3. Is anything claimed in `README.md` not verified by the claims audit? What was removed or reworded?
4. Did any Shift + digit or keyboard-layout issue show up (see Contract extensions)? Is spec §1.4 step 2's wording now correct?

**Sprint summary sections** to add after template section 9:

```markdown
## 10. Sprint summary: issues by theme
Group every issue from gate reports 1–8 by theme (geometry, interaction, open documents and sync, server and persistence,
rendering and web, tooling, process). For each theme: count, the two or three that cost most, and the memory entry that
prevents a repeat.

## 11. All plan and spec changes
One table merging report sections 5 and 6 of gates 1–8: gate, change, why, commit.

## 12. State of design memory
Per area file: decisions added and Don'ts added during the sprint; open issues left in process.md; anything in memory that
the spec contradicts (must be none: fix it now).

## 13. Follow-ups (spec §11)
Confirm or change the priority order in spec §11 based on what the sprint taught. If the order changes, edit spec §11 and
scope.md in this gate's commit.

## 14. Recommendation for S1 (WebGL2 SDF renderer)
What the Renderer port and Scene already give; the risks seen in Canvas2D (text overlay alignment, per-frame scene rebuild
cost, hit-testing independent of the renderer); reuse the screenshots as visual references; a suggested phase breakdown for a
separate S1 plan. Do not start S1 in this sprint.
```

After the user approves G8:
- tick "G8 approved" in the plan README;
- update the Claude auto-memory project note (`flatmate-project.md`) with a one-line pointer to the final report;
- stop.

## Contract extensions

- **New workspace package `@fm/scripts`** (`scripts/`, added to `pnpm-workspace.yaml`): a CLI shell with Node typings. It depends only on `@fm/domain` and `@fm/protocol`. Demo step 9a is `packages/editor/test/scenarios/demo-narrated.test.ts` plus the `demo:headless` root script, because `FakeShell` lives in `packages/editor/test` (the README file structure was updated to match while planning).
- **New root scripts:** `demo`, `demo:script`, `demo:headless`, `demo:seed`, `screenshots`. Root dev dependency: `tsx`.
- **Server seed:** `packages/server/scripts/seed-demo.ts` exports `SAMPLE_NAME`, `sampleCommands()` and `seedDemo(repository)`. `packages/server/tsconfig.json` includes `scripts`.
- **Server data directory:** the seed CLI uses `process.env.DATA_DIR ?? "./data"` (relative to `packages/server`), the same variable and default as phase 6's `main.ts` (reconciled while planning).
- **Server port:** the demo assumes the server listens on 8787 and the web dev server on 5173 (`VITE_SERVER_URL=ws://localhost:8787`).
- **Phase 5, helper hit-test:** a click at the helper text primitive's `at` point starts helper editing. The helper text for wall a→b is centred `WALL_THICKNESS / 2 + 18 px` to the left of a→b, from the wall midpoint; phase 5 exports this as `helperLabelAt`, and the Playwright driver mirrors it.
- **Playwright helpers:** `e2e/support/demo-driver.ts` builds on phase 5's `e2e/support/canvas.ts` and phase 7's `typeLengthAndWait`; it adds `canvasOf`, `worldToPage`, `waitSaved`, `openProject`, `drawDemoApartment` and `helperLabelPage`.
- **Phase 3, typed direction:** the typed-length direction uses the last pointer event (`state.pointer`, including its `mods`). A key event's own `mods` are not used, and a `Shift` key event must not change it. Holding Shift while moving and releasing it before typing therefore keeps the orthogonal direction. Unknown keys such as `"Shift"` are ignored.
- **Phase 7, `ProjectList` DOM:** an input with placeholder `Project name`, a button named `Create`, and one button per project whose accessible name is the project name. Creating a project opens it.
- **Styling hooks:** root classes `fm-app`, `fm-stage`, `fm-toolbar`, `fm-commandbar`, `fm-properties`, `fm-statusbar`, `fm-toast`, `fm-projectlist`; `aria-pressed` on tool buttons.
- **`COLORS` values are hex only** (`#rrggbb` or `#rrggbbaa`).

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | all | process | Lean mode: one wave {8.1→8.5, 8.2, 8.3, 8.4}, then 8.7; no reviews (glue); root package.json conflicts merged by hand | none | `process.md` |
| 2026-09-29 | 8.1 | deviation | `scripts/` needed depcruise coverage | `depcruise packages scripts`; rule `scripts-import-domain-and-protocol-only` | `implementation.md` |
| 2026-09-29 | 8.2 | deviation | `textMuted` kept at `#6b6b6b` so `DEFAULT_ME_COLOR` still matches; a Toast markup test updated for the class hook | none | `rendering.md` |
| 2026-09-29 | 8.3 | tooling | Editor tests have no `console` type | The narrated test declares the one member it uses | `implementation.md` |
| 2026-09-29 | 8.4 | note | A crash between create and save would leave an empty sample project that later runs return unfilled | Accepted | `implementation.md` |
| 2026-09-29 | 8.6 | cut | Screenshots cut (lean mode) | S1 must restore references first | gate 8 §14 |
| 2026-09-29 | 8.8 | demo | Bob's window opened before Alice created "Apartment" did not list it (list fetched, not pushed) | Demo instruction: open or reload Bob at step 7 | `scope.md` |
