# Phase 5: Zones and helper dimensions

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** Rooms become zones and walls get an editable length. The Zone tool (`Z`) labels an unlabelled room with a click and selects it; clicking a labelled room or its tag selects the zone and highlights its floor. The properties panel renames a zone, and `Delete` removes only its label. A selected wall shows a helper dimension; clicking it and typing a length resizes the wall from its fixed `a` end. Demo steps 2–6 pass headless and steps 2–5 pass in Playwright.

**Spec:** §1.2 F4–F5, §1.4 steps 4–6, §3.6 (labels, orphans, merged-room labels), §5.4 (`Delete`, key precedence), §5.6 (selection rules, helper editing), §5.9 (Scene, ViewModel), §9 (editor rows and the zone acceptance scenario), §10 step 5.

**Prerequisites:** Gate 4 approved. The phase 3 editor exists with the extension points listed at the end of `phase-3-editor.md`. `@fm/domain` exports `zones`, `faceAt`, `orphanLabelIds`, `Zone`, `wallHelperDimension`, `sortedIds`, the geometry helpers (`add`, `sub`, `scale`, `normalize`, `perpLeft`), `MESSAGES` and `WALL_THICKNESS`. The phase 4 web shell runs, and `PropertiesPanel` sends `setField` for editable fields.

**Design memory to read first:**

- `editor-interaction.md`:
  - zone clicks select and highlight the floor, and create a label only for an unlabelled room;
  - selection references the label ID;
  - properties rename, and `Delete` removes only the label;
  - the helper keeps endpoint `a` fixed;
  - Don't: no duplicate labels on repeated room clicks; no rename on tag click (select, then edit in properties).
- `domain-geometry.md`:
  - labels are stored annotations, and rooms are derived;
  - the two-room ` / ` merge on divider deletion;
  - `labelZone` refuses a labelled face;
  - a command with no writes is skipped;
  - Don't: no nested or three-label merge semantics.
- `rendering.md`: text always goes on the Canvas2D overlay, and the Scene unit conventions (text size in px, upright, middle baseline).
- `scope.md`: complex zones and merges of three or more labels are follow-ups (§11); area unavailable is an accepted outcome.

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/editor/src/view/tags.ts` | Tag layout (name and area lines, box), tag hit-test, area texts |
| Replace | `packages/editor/src/tools/hit-test.ts` | Adds zone tags and labelled floors to the hit order; `hitTest` gains `host`; `labelAtFloor` |
| Modify | `packages/editor/src/tools/select-tool.ts` | Passes `host` to hit-testing; the helper click starts editing; `selectKey` delegates to the helper field |
| Replace | `packages/editor/src/tools/zone-tool.ts` | Zone tool (hover, click to label or select) and `setField` (rename) |
| Modify | `packages/editor/src/view/view-model.ts` | Zone properties: `name` (editable) and `area` (read-only) |
| Create | `packages/editor/src/view/zones-layer.ts` | `drawZones`: floor fills, selection highlight, hints in `Z`, tags, orphan tags |
| Create | `packages/editor/src/view/helper.ts` | Helper geometry (`helperLabelAt`), box, hit-test and drawing |
| Modify | `packages/editor/src/view/scene.ts` | `buildScene` calls `drawZones` and `drawHelper`; the selected wall's `a` handle is marked fixed |
| Create | `packages/editor/src/tools/helper-edit.ts` | The helper value field: digits, `.`, `Backspace`, `Enter`/`Space` apply `setWallLength` with `keep: "a"` |
| Modify | `packages/editor/src/index.ts` | Export `helperLabelAt` and `formatArea` |
| Modify | `packages/editor/test/builders.ts` | `labelledDoc`, `withOrphan`, `narrowRoomDoc` |
| Replace | `packages/editor/test/scenarios/demo-steps.ts` | Adds `labelRooms` (step 4) and `resizeRightWall` (step 5) |
| Replace | `packages/editor/test/scenarios/demo.test.ts` | Demo steps 2–6 headless; step 6 starts from (6, 3.5) |
| Test | `packages/editor/test/tags.test.ts`, `zone-selection.test.ts`, `zone-properties.test.ts`, `zone-tool.test.ts`, `view-zones.test.ts`, `helper-view.test.ts`, `helper-edit.test.ts`, `zone-scenarios.test.ts` | Unit tests and scenarios |
| Create | `packages/web/e2e/support/canvas.ts` | World-to-screen helpers for Playwright (phase 7 appends shared-mode helpers; phase 8 reuses them) |
| Test | `packages/web/e2e/zones.spec.ts` | Demo steps 2–5 in the browser; rename round trip |

---

## Tasks

### Task 5.1: Tag layout and area texts

A zone tag is two centred lines at the label point: the name above, the area below. For an unavailable area the tag says "Area unavailable"; an orphan says "no enclosing walls" (spec §3.6). The same box is used to draw the tag's background plate and to hit-test it, so what you click is what you see. Widths come from `host.textMetrics` with `TAG_FONT`; the two lines sit 16 px apart.

**Files:** Create `packages/editor/src/view/tags.ts`, `packages/editor/test/tags.test.ts`. Modify `packages/editor/test/builders.ts`.

- [x] **Step 1: Add the fixtures.** Append to `packages/editor/test/builders.ts` (its imports already include `emptyDocument`, `execute`, `rectangleRoom`, `unwrap` and `Document`):

```ts
/** Demo step 4 as a fixture: the divided room with "Room 1" (L1, left) and "Room 2" (L2, right). */
export function labelledDoc(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2" })).doc;
}

/** Adds a label outside every room: an orphan (spec §3.6). labelZone refuses this, so it is written directly. */
export function withOrphan(doc: Document, id = "L9", at = { x: 8, y: 6 }, name = "Lost"): Document {
  return { ...doc, zoneLabels: { ...doc.zoneLabels, [id]: { id, at, name } } };
}

/** A 0.15 × 3 m room labelled "Closet" (L1). Too narrow for a 0.20 m wall inset, so its area is unavailable. */
export function narrowRoomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 0.15, 3, "narrow")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 0.075, y: 1.5 }, name: "Closet" })).doc;
}
```

- [x] **Step 2: Write the failing test** `packages/editor/test/tags.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, type Camera } from "../src/camera";
import { areaFieldText, formatArea, tagAt, tagLayout, zoneOfLabel } from "../src/view/tags";
import { labelledDoc, narrowRoomDoc, withOrphan } from "./builders";
import { FakeHost } from "./fake-shell";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };
const host = new FakeHost();

describe("zone tags (spec §3.6)", () => {
  it("formats areas with two decimals", () => {
    expect(formatArea(10.64)).toBe("10.64 m²");
    expect(formatArea(9.9400001)).toBe("9.94 m²");
  });

  it("lays out the name above the area, sized with the host's text metrics", () => {
    const tag = tagLayout(labelledDoc(), "L1", camera, host);
    if (!tag) throw new Error("no tag");
    expect(tag.lines.map((l) => l.text)).toEqual(["Room 1", "10.64 m²"]);
    // Lines are 16 px apart: ±8 px = ±0.1 m at 80 px/m around the label point (1.5, 2).
    expect(tag.lines[0].at.x).toBe(1.5);
    expect(tag.lines[0].at.y).toBeCloseTo(2.1, 9);
    expect(tag.lines[1].at.y).toBeCloseTo(1.9, 9);
    // The wider line is "10.64 m²": 8 characters × 0.6 × 12 px = 57.6 px.
    // Half-width (28.8 + 4) px = 0.41 m; half-height (16 + 2) px = 0.225 m.
    expect(tag.min.x).toBeCloseTo(1.09, 9);
    expect(tag.max.x).toBeCloseTo(1.91, 9);
    expect(tag.min.y).toBeCloseTo(1.775, 9);
    expect(tag.max.y).toBeCloseTo(2.225, 9);
  });

  it("says when the area is unavailable, and when no walls enclose a label", () => {
    expect(tagLayout(narrowRoomDoc(), "L1", camera, host)?.lines[1].text).toBe("Area unavailable");
    expect(tagLayout(withOrphan(labelledDoc()), "L9", camera, host)?.lines[1].text).toBe("no enclosing walls");
    expect(tagLayout(labelledDoc(), "missing", camera, host)).toBeNull();
  });

  it("gives the properties panel the domain's reason for an unavailable area", () => {
    expect(areaFieldText(zoneOfLabel(labelledDoc(), "L1"))).toBe("10.64 m²");
    expect(areaFieldText(zoneOfLabel(narrowRoomDoc(), "L1"))).toBe("Area unavailable: unsupported geometry");
    expect(areaFieldText(zoneOfLabel(withOrphan(labelledDoc()), "L9"))).toBe("no enclosing walls");
  });

  it("hit-tests tags by the same box they are drawn with", () => {
    const doc = withOrphan(labelledDoc());
    expect(tagAt(doc, { x: 1.5, y: 2 }, camera, host)).toBe("L1");
    expect(tagAt(doc, { x: 8.5, y: 6.1 }, camera, host)).toBe("L9"); // "no enclosing walls" makes the orphan tag wide
    expect(tagAt(doc, { x: 1.5, y: 2.3 }, camera, host)).toBeNull(); // just above L1's tag
    expect(tagAt(doc, { x: 1, y: 3 }, camera, host)).toBeNull(); // floor, not tag
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/tags.test.ts`
Expected: FAIL, `Cannot find module '../src/view/tags'`.

- [x] **Step 4: Implement** `packages/editor/src/view/tags.ts`

```ts
import { sortedIds, zones, type Document, type Zone } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Host } from "../ports/host";
import { TAG_FONT } from "./fonts";

// Zone tags (spec §3.6): the name above, the clear area below, centred on the label point.
export const TAG_LINE_PX = 16; // distance between the two line centres
export const TAG_PAD_PX = 4;
export const AREA_UNAVAILABLE_SHORT = "Area unavailable";
export const ORPHAN_TEXT = "no enclosing walls";

export type TagLine = { text: string; at: Point; role: "name" | "area" };
export type TagLayout = { labelId: string; lines: [TagLine, TagLine]; min: Point; max: Point };

export function formatArea(area: number): string {
  return `${area.toFixed(2)} m²`;
}

/** The derived zone that holds this label, or null for an orphan. */
export function zoneOfLabel(doc: Document, labelId: string): Zone | null {
  return zones(doc).find((z) => z.labelIds.includes(labelId)) ?? null;
}

/** Second tag line: the clear area, a short unavailable note, or the orphan note. */
export function tagAreaText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : AREA_UNAVAILABLE_SHORT;
}

/** The properties "Area" field: the clear area, the domain's reason when unavailable, or the orphan note. */
export function areaFieldText(zone: Zone | null): string {
  if (!zone) return ORPHAN_TEXT;
  return zone.area !== null ? formatArea(zone.area) : (zone.unavailable ?? AREA_UNAVAILABLE_SHORT);
}

/** Both lines and the box used for the tag's plate and for hit-testing; null when the label does not exist. */
export function tagLayout(doc: Document, labelId: string, camera: Camera, host: Host): TagLayout | null {
  const label = doc.zoneLabels[labelId];
  if (!label) return null;
  const half = TAG_LINE_PX / 2 / camera.zoom;
  const name: TagLine = { text: label.name, at: { x: label.at.x, y: label.at.y + half }, role: "name" };
  const area: TagLine = { text: tagAreaText(zoneOfLabel(doc, labelId)), at: { x: label.at.x, y: label.at.y - half }, role: "area" };
  const width = Math.max(host.textMetrics(name.text, TAG_FONT).width, host.textMetrics(area.text, TAG_FONT).width);
  const hw = (width / 2 + TAG_PAD_PX) / camera.zoom;
  const hh = (TAG_LINE_PX + TAG_PAD_PX / 2) / camera.zoom;
  return {
    labelId,
    lines: [name, area],
    min: { x: label.at.x - hw, y: label.at.y - hh },
    max: { x: label.at.x + hw, y: label.at.y + hh },
  };
}

export function inBox(p: Point, min: Point, max: Point): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

/** The label whose tag contains p. Where tags overlap, the last drawn (highest ID) wins. */
export function tagAt(doc: Document, p: Point, camera: Camera, host: Host): string | null {
  let found: string | null = null;
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, camera, host);
    if (tag && inBox(p, tag.min, tag.max)) found = id;
  }
  return found;
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/tags.test.ts`
Expected: PASS (5 tests).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: zone tag layout, tag hit-testing and area texts"
```

---

### Task 5.2: Zone selection in the Select tool

The hit order becomes handles of the selected wall → joints → walls → zone tags → labelled floors (spec §5.6). A tag or a labelled floor selects the zone by its label ID; an unlabelled floor clears the selection, as empty space does. Zones never drag (`dragTarget` already returns `null` for labels). `hitTest` gains the `host` parameter the phase 3 extension point anticipated, because tag sizes need text metrics.

**Files:** Replace `packages/editor/src/tools/hit-test.ts`. Modify `packages/editor/src/tools/select-tool.ts`. Create `packages/editor/test/zone-selection.test.ts`.

Phase 3 wave 7 measures the drag threshold in world units and removed `pressScreen` (Task 3.12 planned deviation); the `press`/`move` code below and in Task 5.7 already follows it.

- [x] **Step 1: Write the failing test** `packages/editor/test/zone-selection.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { EntityRef } from "@fm/domain";
import { dividedRoomDoc, labelledDoc, wallBetween, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });

describe("zone selection in the Select tool (spec §3.6, §5.6)", () => {
  it("selects a labelled room by clicking its floor", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    expect(shell.state.selection).toEqual([zone("L1")]);
    expect(shell.view().properties.kind).toBe("zone");
  });

  it("selects an orphan label through its tag", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    shell.click({ x: 8.5, y: 6.1 });
    expect(shell.state.selection).toEqual([zone("L9")]);
    shell.click({ x: 8.5, y: 7 }); // above the tag: empty space
    expect(shell.state.selection).toEqual([]);
  });

  it("prefers walls to tags and floors", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const divider = wallBetween(shell.doc(), { x: 3, y: 0 }, { x: 3, y: 4 });
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: divider }]);
  });

  it("clears the selection on an unlabelled floor", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.click({ x: 6, y: 1 });
    expect(shell.state.selection).toHaveLength(1);
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([]);
  });

  it("never drags a zone", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.drag({ x: 1, y: 3 }, { x: 2, y: 3.5 });
    expect(shell.doc()).toEqual(labelledDoc());
    expect(shell.state.selection).toEqual([zone("L1")]);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Delete removes the selected zone's label and leaves the walls", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const walls = shell.doc().walls;
    shell.click({ x: 1, y: 3 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().zoneLabels)).toEqual(["L2"]);
    expect(shell.doc().walls).toEqual(walls);
    expect(shell.state.selection).toEqual([]);
    expect(shell.state.undo.past).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/zone-selection.test.ts`
Expected: FAIL; the first test gets an empty selection (`expected [] to deeply equal [ { table: 'zoneLabels', id: 'L1' } ]`).

- [x] **Step 3: Replace** `packages/editor/src/tools/hit-test.ts`

```ts
import { distance, faceAt, hitCandidates, zones, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { tagAt } from "../view/tags";
import { draggedJoints } from "./types";

export const DRAG_THRESHOLD_PX = 4; // spec §5.7
export const HIT_TOLERANCE_PX = 6;
export const HANDLE_HIT_PX = 8;

export type Hit = { ref: EntityRef; handle: boolean };

/**
 * Handles of the selected wall win, then joints, walls, zone tags and labelled floors (spec §5.6).
 * The Select tool checks the helper dimension before calling this (Task 5.7).
 */
export function hitTest(state: EditorState, world: Point, host: Host): Hit | null {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  const handle = handleHit(state, doc, world);
  if (handle) return handle;
  const first = hitCandidates(doc, world, HIT_TOLERANCE_PX / state.camera.zoom)[0];
  if (first) return { ref: first, handle: false };
  const label = tagAt(doc, world, state.camera, host) ?? labelAtFloor(doc, world);
  return label ? { ref: { table: "zoneLabels", id: label }, handle: false } : null;
}

/** The label of the labelled room under the point; null on a boundary, outside, or in an unlabelled room. */
export function labelAtFloor(doc: Document, world: Point): string | null {
  const face = faceAt(doc, world);
  if (!face) return null;
  return zones(doc).find((z) => z.face.key === face.key)?.labelIds[0] ?? null;
}

/** The nearest handle in range; endpoint `a` wins an exact tie. */
function handleHit(state: EditorState, doc: Document, world: Point): Hit | null {
  const selected = state.selection[0];
  if (!selected || selected.table !== "walls") return null;
  let best: { id: string; d: number } | null = null;
  for (const id of draggedJoints(doc, { kind: "wall", wallId: selected.id })) {
    const j = doc.joints[id];
    const d = j ? distance(j, world) : Infinity;
    if (d <= HANDLE_HIT_PX / state.camera.zoom && (!best || d < best.d)) best = { id, d };
  }
  return best ? { ref: { table: "joints", id: best.id }, handle: true } : null;
}
```

- [x] **Step 4: Pass `host` through the Select tool.** In `packages/editor/src/tools/select-tool.ts`, replace the functions `selectPointer`, `press` and `move` with these versions. The rest of the file stays as phase 3 left it.

```ts
/** Spec §5.6 and §5.7: press selects, a drag previews on baseDoc, release commits once. */
export function selectPointer(state: EditorState, tool: SelectToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  switch (e.type) {
    case "pointerDown":
      return { state: press(state, pointer.world, host), effects: [] };
    case "pointerMove":
      return { state: move(state, tool, pointer.world, host), effects: [] };
    case "pointerUp":
      return release(state, tool, host);
    default:
      return assertNever(e.type);
  }
}

function press(state: EditorState, world: Point, host: Host): EditorState {
  const hit = hitTest(state, world, host);
  if (!hit) return withSelect({ ...state, selection: [] }, { kind: "idle" });
  const selection = hit.handle ? state.selection : [hit.ref]; // a handle keeps its wall selected
  return withSelect({ ...state, selection }, { kind: "pressing", pressWorld: world, target: dragTarget(hit.ref) });
}

function move(state: EditorState, tool: SelectToolState, world: Point, host: Host): EditorState {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
      return { ...state, hover: hitTest(state, world, host)?.ref ?? null };
    case "pressing": {
      if (!tool.target || !state.document || !canCommit(state.document)) return state; // no drag while edits are blocked
      // In world units at the current zoom: the cursor follows the camera (spec §5.4), so a scroll
      // under a still press starts the drag and a zoom at the cursor does not.
      if (distance(world, tool.pressWorld) * state.camera.zoom <= DRAG_THRESHOLD_PX) return state;
      const baseDoc = visibleDoc(state.document);
      const start: Moving = {
        kind: "moving",
        target: tool.target,
        pressWorld: tool.pressWorld,
        baseDoc,
        attempt: { ok: false, doc: baseDoc, cursor: world, moves: [] }, // replaced by the first attempt below
      };
      return attemptMove(state, start, world);
    }
    case "moving":
      return attemptMove(state, tool, world);
    default:
      return assertNever(tool);
  }
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/zone-selection.test.ts test/select-tool.test.ts`
Expected: PASS (6 new tests; the phase 3 select-tool tests still pass).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: select zones by tag or labelled floor; hit order handles, joints, walls, tags, floors"
```

---

### Task 5.3: Zone properties and renaming

A selected zone shows its `name` (editable) and `area` (read-only) in the properties panel. The panel's `setField name` becomes `renameZone`, one undoable edit (spec §5.6). Other fields are read-only, so `setField` ignores them. The area follows the label as geometry changes, because rooms are derived on every render (spec §3.6: selection tracks the label ID).

**Files:** Modify `packages/editor/src/view/view-model.ts`. Replace `packages/editor/src/tools/zone-tool.ts`. Create `packages/editor/test/zone-properties.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/zone-properties.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document, type EntityRef } from "@fm/domain";
import type { EditorState } from "../src/state";
import { buildViewModel, type ViewModel } from "../src/view/view-model";
import { labelledDoc, localState, narrowRoomDoc, wallBetween, withOrphan } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

const host = new FakeHost();
const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });
const selecting = (doc: Document, id: string): EditorState => ({ ...localState(host, doc), selection: [zone(id)] });
const values = (vm: ViewModel): string[] => (vm.properties.kind === "none" ? [] : vm.properties.fields.map((f) => f.value));

describe("zone properties (spec §5.6)", () => {
  it("shows an editable name and a read-only clear area", () => {
    expect(buildViewModel(selecting(labelledDoc(), "L1"), host).properties).toEqual({
      kind: "zone",
      fields: [
        { id: "name", label: "Name", value: "Room 1", unit: null, readOnly: false },
        { id: "area", label: "Area", value: "10.64 m²", unit: null, readOnly: true },
      ],
    });
  });

  it("gives the domain's reason when the area is unavailable", () => {
    expect(values(buildViewModel(selecting(narrowRoomDoc(), "L1"), host))).toEqual(["Closet", "Area unavailable: unsupported geometry"]);
  });

  it("says when no walls enclose an orphan label", () => {
    expect(values(buildViewModel(selecting(withOrphan(labelledDoc()), "L9"), host))).toEqual(["Lost", "no enclosing walls"]);
  });

  it("follows the selected label through geometry changes", () => {
    const before = labelledDoc();
    const right = wallBetween(before, { x: 6, y: 0 }, { x: 6, y: 4 });
    const after = unwrap(execute(before, { type: "setWallLength", wallId: right, length: 3.5, keep: "a" })).doc;
    expect(values(buildViewModel(selecting(before, "L2"), host))[1]).toBe("10.64 m²");
    expect(values(buildViewModel(selecting(after, "L2"), host))[1]).toBe("9.94 m²");
  });
});

describe("renaming through setField (spec §5.6)", () => {
  it("renames the selected zone as one undoable edit", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    shell.ui({ type: "setField", fieldId: "name", value: "Kitchen" });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Kitchen");
    expect(values(shell.view())).toEqual(["Kitchen", "10.64 m²"]);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Room 1");
  });

  it("renames an orphan label selected through its tag", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    shell.click({ x: 8.5, y: 6.1 });
    shell.ui({ type: "setField", fieldId: "name", value: "Storage" });
    expect(shell.doc().zoneLabels.L9?.name).toBe("Storage");
  });

  it("ignores read-only fields and non-zone selections", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 6, y: 1 }); // the right wall
    shell.ui({ type: "setField", fieldId: "name", value: "X" });
    shell.click({ x: 1, y: 3 }); // the left zone
    shell.ui({ type: "setField", fieldId: "area", value: "99" });
    expect(shell.doc()).toEqual(labelledDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("refuses a name longer than 200 characters with a toast", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    shell.ui({ type: "setField", fieldId: "name", value: "x".repeat(201) });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Room 1");
    expect(shell.view().toast).toBe("Name too long");
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/zone-properties.test.ts`
Expected: FAIL; the first test gets `{ kind: 'none' }` (phase 3 returns no properties for labels).

- [x] **Step 3: Implement zone properties.** In `packages/editor/src/view/view-model.ts`, add this import next to the others:

```ts
import { areaFieldText, zoneOfLabel } from "./tags";
```

and replace the function `properties` with:

```ts
function properties(state: EditorState): ViewModel["properties"] {
  const ref = state.selection[0];
  if (!ref || !state.document) return { kind: "none" };
  const doc = visibleDoc(state.document);
  switch (ref.table) {
    case "walls": {
      const h = wallHelperDimension(doc, ref.id);
      if (!h) return { kind: "none" };
      return {
        kind: "wall",
        fields: [field("length", "Length", h.length.toFixed(2), "m"), field("thickness", "Thickness", WALL_THICKNESS.toFixed(2), "m")],
      };
    }
    case "joints": {
      const j = doc.joints[ref.id];
      if (!j) return { kind: "none" };
      return { kind: "joint", fields: [field("x", "X", j.x.toFixed(2), "m"), field("y", "Y", j.y.toFixed(2), "m")] };
    }
    case "zoneLabels": {
      // Spec §5.6: an editable name and a read-only area; the area is derived, so it follows geometry changes.
      const label = doc.zoneLabels[ref.id];
      if (!label) return { kind: "none" };
      return {
        kind: "zone",
        fields: [field("name", "Name", label.name, null, false), field("area", "Area", areaFieldText(zoneOfLabel(doc, ref.id)), null)],
      };
    }
    default:
      return assertNever(ref.table);
  }
}
```

- [x] **Step 4: Implement renaming.** Replace `packages/editor/src/tools/zone-tool.ts` (the pointer handler stays a placeholder until Task 5.4):

```ts
import { runCommand } from "../commit";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import type { ZoneToolState } from "./types";

// Placeholder: Task 5.4 replaces zonePointer with the Zone tool.
export function zonePointer(state: EditorState, _tool: ZoneToolState, _e: PointerInput, _host: Host): Step {
  return { state: { ...state, snap: null }, effects: [] };
}

/** Properties-panel edits (`ui setField`): the selected zone's `name` renames it (spec §5.6); other fields are read-only. */
export function setField(state: EditorState, fieldId: string, value: string, host: Host): Step {
  const ref = state.selection[0];
  if (fieldId !== "name" || !ref || ref.table !== "zoneLabels") return { state, effects: [] };
  const out = runCommand(state, { type: "renameZone", id: ref.id, name: value }, host);
  return { state: out.state, effects: out.effects };
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/zone-properties.test.ts test/view.test.ts`
Expected: PASS (8 new tests; the phase 3 view tests still pass).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: zone properties (name, area) and renaming through setField"
```

---

### Task 5.4: Zone tool

Hovering records the face under the cursor (`hoverFaceKey`) so the scene can highlight it. A click follows spec §3.6 and §5.6:

- a tag, or a labelled room's floor, selects that zone;
- an unlabelled room gets `labelZone { id: host.newId(), at: <click point>, name: "Room N" }` and the new zone is selected, where N is the number of labels plus one;
- a click on a boundary (within ε) or outside every room does nothing.

**Files:** Replace `packages/editor/src/tools/zone-tool.ts`. Create `packages/editor/test/zone-tool.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/zone-tool.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { faceAt, type EntityRef } from "@fm/domain";
import { dividedRoomDoc, labelledDoc } from "./builders";
import { FakeShell } from "./fake-shell";

const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });
const labels = (shell: FakeShell) => Object.values(shell.doc().zoneLabels);

function zoneTool(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "zone") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

describe("zone tool (spec §3.6, §5.6)", () => {
  it("labels an unlabelled room where it was clicked and selects the zone", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    const [label] = labels(shell);
    expect(labels(shell)).toHaveLength(1);
    expect(label?.name).toBe("Room 1");
    expect(label?.at).toEqual({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([zone(label?.id ?? "")]);
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Room 1", "10.64 m²"]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("numbers new zones", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    shell.click({ x: 4.5, y: 2 });
    expect(labels(shell).map((l) => l.name).sort()).toEqual(["Room 1", "Room 2"]);
  });

  it("selects a labelled room by its floor or tag without creating another label", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.key("z");
    shell.click({ x: 1, y: 3.5 }); // floor
    expect(shell.state.selection).toEqual([zone("L1")]);
    shell.click({ x: 4.5, y: 2 }); // tag
    expect(shell.state.selection).toEqual([zone("L2")]);
    expect(labels(shell)).toHaveLength(2);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("does nothing on a boundary or outside every room", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 3, y: 2 }); // on the divider's centreline
    shell.click({ x: 8, y: 1 }); // outside
    expect(labels(shell)).toHaveLength(0);
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().toast).toBeNull();
  });

  it("tracks the room under the cursor", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.moveTo({ x: 4.5, y: 2 });
    expect(zoneTool(shell).hoverFaceKey).toBe(faceAt(shell.doc(), { x: 4.5, y: 2 })?.key);
    shell.moveTo({ x: 8, y: 1 });
    expect(zoneTool(shell).hoverFaceKey).toBeNull();
  });

  it("Delete removes the selected zone's label only", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const walls = shell.doc().walls;
    shell.key("z");
    shell.click({ x: 1, y: 3.5 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().zoneLabels)).toEqual(["L2"]);
    expect(shell.doc().walls).toEqual(walls);
    expect(shell.state.selection).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/zone-tool.test.ts`
Expected: FAIL; the placeholder creates no label (`expected [] to have a length of 1`).

- [x] **Step 3: Replace** `packages/editor/src/tools/zone-tool.ts`

```ts
import { faceAt, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { tagAt } from "../view/tags";
import { labelAtFloor } from "./hit-test";
import type { ZoneToolState } from "./types";

/** Spec §3.6, §5.6: hovering highlights a room; a click selects its zone, labelling an unlabelled room first. */
export function zonePointer(state: EditorState, tool: ZoneToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  const doc = visibleDoc(state.document);
  switch (e.type) {
    case "pointerMove": {
      const hoverFaceKey = faceAt(doc, pointer.world)?.key ?? null;
      return { state: withZone({ ...state, snap: null, hover: null }, { ...tool, hoverFaceKey }), effects: [] };
    }
    case "pointerDown":
      return clickZone(state, doc, pointer.world, host);
    case "pointerUp":
      return { state, effects: [] };
    default:
      return assertNever(e.type);
  }
}

/** Properties-panel edits (`ui setField`): the selected zone's `name` renames it (spec §5.6); other fields are read-only. */
export function setField(state: EditorState, fieldId: string, value: string, host: Host): Step {
  const ref = state.selection[0];
  if (fieldId !== "name" || !ref || ref.table !== "zoneLabels") return { state, effects: [] };
  const out = runCommand(state, { type: "renameZone", id: ref.id, name: value }, host);
  return { state: out.state, effects: out.effects };
}

function clickZone(state: EditorState, doc: Document, world: Point, host: Host): Step {
  const existing = tagAt(doc, world, state.camera, host) ?? labelAtFloor(doc, world);
  if (existing) return { state: select(state, existing), effects: [] };
  if (!faceAt(doc, world)) return { state, effects: [] }; // outside every room, or on a boundary (spec §3.6)
  const id = host.newId();
  const name = `Room ${Object.keys(doc.zoneLabels).length + 1}`;
  const out = runCommand(state, { type: "labelZone", id, at: world, name }, host);
  if (out.committed === null) return { state: out.state, effects: out.effects }; // refused: the toast explains why
  return { state: select(out.state, id), effects: out.effects };
}

function select(state: EditorState, labelId: string): EditorState {
  const ref: EntityRef = { table: "zoneLabels", id: labelId };
  return { ...state, selection: [ref] };
}

function withZone(state: EditorState, tool: ZoneToolState): EditorState {
  return { ...state, tool: { name: "zone", state: tool } };
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/zone-tool.test.ts test/zone-properties.test.ts`
Expected: PASS (6 + 8 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: Zone tool labels unlabelled rooms and selects labelled ones"
```

---

### Task 5.5: Zones in the Scene

Floors go in the `zoneFills` layer:

- labelled rooms get `zoneFill`;
- the selected zone, and the hovered room in the Zone tool, get `zoneFillSelected`;
- unlabelled rooms appear as faint `zoneHint`s only while `Z` is active (spec §3.6).

A room with an unavailable area is filled along its centreline ring, so it can still be highlighted.

Tags go in the `annotations` layer: a background plate from the tag box, then the two text lines. The name of the selected zone is drawn in the selection colour. Zones are derived from the scene document, so tags and areas update live during a drag.

**Files:** Create `packages/editor/src/view/zones-layer.ts`. Modify `packages/editor/src/view/scene.ts`. Create `packages/editor/test/view-zones.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/view-zones.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { dividedRoomDoc, labelledDoc, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

function layer(shell: FakeShell, name: string): Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const fills = (shell: FakeShell, color: string) => layer(shell, "zoneFills").filter((p) => p.kind === "polygon" && p.color === color);
const texts = (shell: FakeShell) => layer(shell, "annotations").flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("zones in the Scene (spec §3.6, §5.6)", () => {
  it("fills labelled rooms and draws their tags", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(2);
    expect(texts(shell)).toEqual(expect.arrayContaining(["Room 1", "10.64 m²", "Room 2"]));
  });

  it("highlights the selected zone's floor", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    const selected = fills(shell, COLORS.zoneFillSelected);
    const floor = zones(shell.doc()).find((z) => z.labelIds.includes("L1"))?.floor;
    expect(selected).toHaveLength(1);
    expect(selected[0]?.kind === "polygon" && selected[0].points).toEqual(floor);
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(1);
  });

  it("shows unlabelled rooms as faint hints only while Z is active", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    expect(layer(shell, "zoneFills")).toEqual([]);
    shell.key("z");
    expect(fills(shell, COLORS.zoneHint)).toHaveLength(2);
  });

  it("highlights the room under the cursor in the Zone tool", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.moveTo({ x: 4.5, y: 2 });
    expect(fills(shell, COLORS.zoneFillSelected)).toHaveLength(1);
    expect(fills(shell, COLORS.zoneHint)).toHaveLength(1);
  });

  it("draws an orphan's tag with its note", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    expect(texts(shell)).toEqual(expect.arrayContaining(["Lost", "no enclosing walls"]));
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/view-zones.test.ts`
Expected: FAIL; `zoneFills` is empty (`expected [] to have a length of 2`).

- [x] **Step 3: Implement** `packages/editor/src/view/zones-layer.ts`

```ts
import { sortedIds, zones, type Document } from "@fm/domain";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { COLORS } from "./colors";
import { TAG_FONT } from "./fonts";
import type { LayerName, Primitive } from "./scene-types";
import { tagLayout } from "./tags";

/** Room floors (zoneFills) and zone tags (annotations), spec §3.6 and §5.6. */
export function drawZones(state: EditorState, doc: Document, layers: Record<LayerName, Primitive[]>, host: Host): void {
  const selected = new Set(state.selection.filter((r) => r.table === "zoneLabels").map((r) => r.id));
  const zoneTool = state.tool.name === "zone" ? state.tool.state : null;
  for (const z of zones(doc)) {
    const highlighted = z.labelIds.some((id) => selected.has(id)) || zoneTool?.hoverFaceKey === z.face.key;
    const color = highlighted
      ? COLORS.zoneFillSelected
      : z.labelIds.length > 0
        ? COLORS.zoneFill
        : zoneTool
          ? COLORS.zoneHint
          : null;
    // A room whose clear area is unavailable is filled along its centreline ring.
    if (color) layers.zoneFills.push({ kind: "polygon", points: z.floor ?? z.face.ring, color });
  }
  for (const id of sortedIds(doc.zoneLabels)) {
    const tag = tagLayout(doc, id, state.camera, host);
    if (!tag) continue;
    const { min, max } = tag;
    layers.annotations.push({
      kind: "polygon",
      points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }],
      color: COLORS.background,
    });
    for (const line of tag.lines) {
      const color = line.role === "area" ? COLORS.textMuted : selected.has(id) ? COLORS.wallSelected : COLORS.text;
      layers.annotations.push({ kind: "text", text: line.text, at: line.at, size: TAG_FONT.size, color, align: "center", rotation: 0 });
    }
  }
}
```

- [x] **Step 4: Call it from the Scene.** In `packages/editor/src/view/scene.ts`, add the import:

```ts
import { drawZones } from "./zones-layer";
```

and replace the function `buildScene` with:

```ts
export function buildScene(state: EditorState, host: Host): Scene {
  const layers: Layers = { grid: [], zoneFills: [], walls: [], annotations: [], overlays: [], presence: [] };
  drawGrid(state.camera, layers.grid);
  const doc = sceneDocument(state);
  if (doc) {
    drawZones(state, doc, layers, host); // floors under the walls; tags in annotations
    drawWalls(state, doc, layers.walls);
    drawSelection(state, doc, layers.overlays);
    drawToolOverlay(state, layers, host);
  }
  drawSnap(state, layers.overlays);
  // Phase 7 appends drawPresence(state, layers.presence) here.
  return { layers: LAYER_ORDER.map((name): Layer => ({ name, primitives: layers[name] })) };
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/view-zones.test.ts test/view.test.ts test/perf.test.ts`
Expected: PASS (5 new tests; the phase 3 view and cost tests still pass).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: zone fills, selection highlight, Z hints and tags in the Scene"
```

---

### Task 5.6: Helper dimension in the Scene

A selected wall shows its helper dimension in the Select tool (not during a drag), in the `annotations` layer:

- a dimension line parallel to the wall, 8 px beyond its face;
- end ticks at both ends;
- the length (`4.00`) on a background plate, centred 18 px beyond the face.

The helper is on the left of `a → b`, which is inside a room drawn counter-clockwise. `helperLabelAt` is the single placement function; the Select tool, the headless demo steps and phase 8's Playwright driver all use it. The fixed endpoint `a` is marked by drawing its handle filled (`handleFixed`) instead of white (spec §5.6: "visibly marks it"), so each handle is still two discs.

**Files:** Create `packages/editor/src/view/helper.ts`. Modify `packages/editor/src/view/scene.ts`. Create `packages/editor/test/helper-view.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/helper-view.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Camera } from "../src/camera";
import { COLORS } from "../src/view/colors";
import { helperLabelAt } from "../src/view/helper";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

const camera = (zoom: number): Camera => ({ center: { x: 3, y: 2 }, zoom, viewport: { width: 1200, height: 800 }, dpr: 1 });

function layer(shell: FakeShell, name: string): Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const helperTexts = (shell: FakeShell) =>
  layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []));

describe("helper placement (spec §5.6)", () => {
  it("centres the text 18 px beyond the wall face, on the left of a → b", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 }); // a = (6, 0): the left of a → b is −x
    const at80 = helperLabelAt(doc, right, camera(80));
    expect(at80?.x).toBeCloseTo(6 - 0.1 - 18 / 80, 9); // 5.675
    expect(at80?.y).toBeCloseTo(2, 9);
    expect(helperLabelAt(doc, right, camera(160))?.x).toBeCloseTo(6 - 0.1 - 18 / 160, 9); // 5.7875
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(helperLabelAt(doc, bottom, camera(80))?.y).toBeCloseTo(0.1 + 18 / 80, 9); // 0.325
    expect(helperLabelAt(doc, "missing", camera(80))).toBeNull();
  });
});

describe("helper dimension in the Scene", () => {
  it("shows the selected wall's length on a dimension line with end ticks", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    expect(helperTexts(shell)).toEqual(["4.00"]);
    expect(layer(shell, "annotations").filter((p) => p.kind === "segment" && p.color === COLORS.helper)).toHaveLength(3);
  });

  it("marks the fixed endpoint a with a filled handle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    const inner = layer(shell, "overlays").flatMap((p) =>
      p.kind === "disc" && "px" in p.radius && p.radius.px === 3.5 ? [[p.center, p.color]] : [],
    );
    expect(inner).toEqual([
      [{ x: 6, y: 0 }, COLORS.handleFixed],
      [{ x: 6, y: 4 }, COLORS.handle],
    ]);
  });

  it("hides the helper outside the Select tool and during a drag", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    shell.key("w"); // the selection stays, the helper does not
    expect(helperTexts(shell)).toEqual([]);

    const dragging = FakeShell.withDocument(roomDoc());
    dragging.click({ x: 6, y: 1 });
    dragging.moveTo({ x: 6, y: 4 });
    dragging.down({ x: 6, y: 4 });
    dragging.moveTo({ x: 6, y: 4.6 }); // a grid point (0.2 m steps at 80 px/m), so the snapped result is exact
    expect(helperTexts(dragging)).toEqual([]);
    dragging.up({ x: 6, y: 4.6 });
    expect(helperTexts(dragging)).toEqual(["4.60"]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/helper-view.test.ts`
Expected: FAIL, `Cannot find module '../src/view/helper'`.

- [x] **Step 3: Implement** `packages/editor/src/view/helper.ts`

```ts
import { WALL_THICKNESS, add, normalize, perpLeft, scale, sub, wallHelperDimension, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { COLORS } from "./colors";
import { HELPER_FONT } from "./fonts";
import { labelBox } from "./labels";
import type { Primitive } from "./scene-types";
import { inBox } from "./tags";

// The editable helper dimension of a selected wall (spec §5.6, F5). It sits on the left of a → b.
export const HELPER_LINE_PX = 8; // dimension line, beyond the wall face
export const HELPER_OFFSET_PX = 18; // text centre, beyond the wall face
export const HELPER_TICK_PX = 4;

type Frame = { a: Point; b: Point; length: number; normal: Point };

function frame(doc: Document, wallId: string): Frame | null {
  const h = wallHelperDimension(doc, wallId);
  const dir = h ? normalize(sub(h.b, h.a)) : null;
  return h && dir ? { ...h, normal: perpLeft(dir) } : null;
}

/** Centre of the helper text: the wall's midpoint, 18 px beyond its face. The one placement function. */
export function helperLabelAt(doc: Document, wallId: string, camera: Camera): Point | null {
  const f = frame(doc, wallId);
  if (!f) return null;
  return add(scale(add(f.a, f.b), 0.5), scale(f.normal, WALL_THICKNESS / 2 + HELPER_OFFSET_PX / camera.zoom));
}

/** The wall whose helper is shown: in the Select tool, the one selected wall (or the one being edited), never during a drag. */
export function helperWall(state: EditorState): string | null {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind === "moving") return null;
  if (tool.state.kind === "editingHelper") return tool.state.wallId;
  const ref = state.selection[0];
  return state.selection.length === 1 && ref?.table === "walls" ? ref.id : null;
}

/** The typed value while editing, otherwise the length with two decimals. */
export function helperText(state: EditorState, length: number): string {
  const tool = state.tool;
  const editing = tool.name === "select" && tool.state.kind === "editingHelper" ? tool.state.value : "";
  return editing !== "" ? editing : length.toFixed(2);
}

/** The text, its centre and its box; the box is both the drawn plate and the click target. */
export function helperBox(
  state: EditorState,
  doc: Document,
  wallId: string,
  host: Host,
): { text: string; at: Point; min: Point; max: Point } | null {
  const f = frame(doc, wallId);
  const at = helperLabelAt(doc, wallId, state.camera);
  if (!f || !at) return null;
  const text = helperText(state, f.length);
  return { text, at, ...labelBox(text, at, HELPER_FONT, state.camera, host) }; // same box as the length label (phase 3)
}

/** The selected wall, when the point is on its helper text (a click there starts editing). */
export function helperHit(state: EditorState, world: Point, host: Host): string | null {
  const wallId = helperWall(state);
  if (!wallId || !state.document) return null;
  const box = helperBox(state, visibleDoc(state.document), wallId, host);
  return box && inBox(world, box.min, box.max) ? wallId : null;
}

/** Dimension line with end ticks, and the length on a plate (annotations layer). */
export function drawHelper(state: EditorState, doc: Document, out: Primitive[], host: Host): void {
  const wallId = helperWall(state);
  const f = wallId ? frame(doc, wallId) : null;
  const box = wallId ? helperBox(state, doc, wallId, host) : null;
  if (!f || !box) return;
  const zoom = state.camera.zoom;
  const offset = scale(f.normal, WALL_THICKNESS / 2 + HELPER_LINE_PX / zoom);
  const tick = scale(f.normal, HELPER_TICK_PX / zoom);
  const a = add(f.a, offset);
  const b = add(f.b, offset);
  const seg = (p: Point, q: Point): Primitive => ({ kind: "segment", a: p, b: q, width: { px: 1 }, color: COLORS.helper, cap: "butt" });
  out.push(seg(a, b), seg(sub(a, tick), add(a, tick)), seg(sub(b, tick), add(b, tick)));
  out.push({
    kind: "polygon",
    points: [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }],
    color: COLORS.background,
  });
  out.push({ kind: "text", text: box.text, at: box.at, size: HELPER_FONT.size, color: COLORS.helper, align: "center", rotation: 0 });
}
```

- [x] **Step 4: Draw it, and mark the fixed endpoint.** In `packages/editor/src/view/scene.ts`, add the import:

```ts
import { drawHelper } from "./helper";
```

then replace `buildScene` with the version below (it adds the `drawHelper` call to the Task 5.5 version):

```ts
export function buildScene(state: EditorState, host: Host): Scene {
  const layers: Layers = { grid: [], zoneFills: [], walls: [], annotations: [], overlays: [], presence: [] };
  drawGrid(state.camera, layers.grid);
  const doc = sceneDocument(state);
  if (doc) {
    drawZones(state, doc, layers, host); // floors under the walls; tags in annotations
    drawWalls(state, doc, layers.walls);
    drawSelection(state, doc, layers.overlays);
    drawHelper(state, doc, layers.annotations, host); // selected wall, Select tool only
    drawToolOverlay(state, layers, host);
  }
  drawSnap(state, layers.overlays);
  // Phase 7 appends drawPresence(state, layers.presence) here.
  return { layers: LAYER_ORDER.map((name): Layer => ({ name, primitives: layers[name] })) };
}
```

and replace the functions `drawSelection` and `handle` with:

```ts
function drawSelection(state: EditorState, doc: Document, out: Primitive[]): void {
  for (const ref of state.selection) {
    if (ref.table === "walls") {
      const w = doc.walls[ref.id];
      const a = w ? doc.joints[w.a] : undefined;
      const b = w ? doc.joints[w.b] : undefined;
      if (a) out.push(...handle({ x: a.x, y: a.y }, true)); // endpoint a stays fixed when the helper resizes (spec §5.6)
      if (b) out.push(...handle({ x: b.x, y: b.y }, false));
    } else if (ref.table === "joints") {
      const j = doc.joints[ref.id];
      if (j) out.push(...handle({ x: j.x, y: j.y }, false));
    }
  }
}

function handle(p: Point, fixed: boolean): Primitive[] {
  return [
    { kind: "disc", center: p, radius: { px: 5 }, color: COLORS.wallSelected },
    { kind: "disc", center: p, radius: { px: 3.5 }, color: fixed ? COLORS.handleFixed : COLORS.handle },
  ];
}
```

`draggedJoints` stays imported: `invalidWalls` still uses it.

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/helper-view.test.ts test/view.test.ts`
Expected: PASS (4 new tests; phase 3's "shows its two joint handles" still counts four discs).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: helper dimension for the selected wall; fixed endpoint marked"
```

---

### Task 5.7: Helper editing

A click on the helper text enters `editingHelper { wallId, value: "" }`. The helper is checked before every other hit, because on a vertical wall its text box overlaps the wall's hit zone. `selectKey` becomes the value field (spec §5.4 precedence 1): digits, `.` and `Backspace` edit the value, and `Enter` or `Space` apply `setWallLength { keep: "a" }` (spec §5.6).

- A value that is not a positive number shows "Type a length in metres" and keeps editing.
- A domain refusal (for example "Wall too short") shows its toast and ends editing; the selection stays.
- An empty `Enter` ends editing.
- `Esc` cancels (phase 3's `selectEscape`).
- `Delete` does nothing while editing, because a value field is active.

**Files:** Create `packages/editor/src/tools/helper-edit.ts`. Modify `packages/editor/src/tools/select-tool.ts`. Create `packages/editor/test/helper-edit.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/helper-edit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { helperLabelAt } from "../src/view/helper";
import { jointAt, pointOf, roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

/** Selects the right wall of the demo room (a = (6, 0)) and clicks its helper. */
function editRightWall() {
  const shell = FakeShell.withDocument(roomDoc());
  const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
  shell.click({ x: 6, y: 1 });
  const at = helperLabelAt(shell.doc(), right, shell.state.camera);
  if (!at) throw new Error("no helper");
  shell.click(at);
  return { shell, right };
}

function selectState(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "select") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

const helperTexts = (shell: FakeShell) =>
  (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).flatMap((p) =>
    p.kind === "text" && p.color === COLORS.helper ? [p.text] : [],
  );

describe("helper dimension editing (spec §5.6, F5)", () => {
  it("a click on the helper starts editing the length", () => {
    const { shell, right } = editRightWall();
    expect(selectState(shell)).toEqual({ kind: "editingHelper", wallId: right, value: "" });
    expect(shell.view().commandBar).toEqual({ prompt: "Wall length", value: "", unit: "m" });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("Enter resizes the wall from its fixed a end; connected walls follow", () => {
    const { shell, right } = editRightWall();
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.type("3.5");
    expect(shell.view().commandBar.value).toBe("3.5");
    shell.key("Enter");
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 3.5 });
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    wallBetween(shell.doc(), { x: 6, y: 3.5 }, { x: 0, y: 4 }); // the top wall kept its connection and now slopes
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    expect(shell.state.undo.past).toHaveLength(1);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("3.50");
  });

  it("Space applies like Enter", () => {
    const { shell } = editRightWall();
    shell.type("5");
    shell.key(" ");
    jointAt(shell.doc(), { x: 6, y: 5 });
  });

  it("shows the typed value in the helper while editing", () => {
    const { shell } = editRightWall();
    shell.type("35");
    shell.key("Backspace");
    expect(helperTexts(shell)).toEqual(["3"]);
  });

  it("Esc cancels without changing the wall", () => {
    const { shell, right } = editRightWall();
    shell.type("3");
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("keeps editing after a value that is not a positive number", () => {
    const { shell } = editRightWall();
    shell.type(".");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(selectState(shell)).toMatchObject({ kind: "editingHelper", value: "." });
  });

  it("shows a domain refusal and ends editing", () => {
    const { shell } = editRightWall();
    shell.type("0.005");
    shell.key("Enter");
    expect(shell.view().toast).toBe(MESSAGES.tooShort);
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("an empty Enter ends editing without a change", () => {
    const { shell } = editRightWall();
    shell.key("Enter");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Delete deletes nothing while the value field is active", () => {
    const { shell } = editRightWall();
    shell.key("Delete");
    expect(shell.doc()).toEqual(roomDoc());
    expect(selectState(shell).kind).toBe("editingHelper");
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/helper-edit.test.ts`
Expected: FAIL; the click on the helper selects nothing new and the tool stays idle (`expected { kind: 'idle' } to deeply equal { kind: 'editingHelper', … }`).

- [x] **Step 3: Implement** `packages/editor/src/tools/helper-edit.ts`

```ts
import { runCommand } from "../commit";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { showToast } from "../toast";
import type { SelectToolState } from "./types";

type Editing = Extract<SelectToolState, { kind: "editingHelper" }>;

/** The helper's value field (spec §5.4 precedence 1, §5.6). Returns null for keys it does not capture. */
export function helperKey(state: EditorState, tool: Editing, key: string, host: Host): Step | null {
  if (/^[0-9]$/.test(key) || key === ".") return { state: withSelect(state, { ...tool, value: tool.value + key }), effects: [] };
  if (key === "Backspace") return { state: withSelect(state, { ...tool, value: tool.value.slice(0, -1) }), effects: [] };
  if (key === "Enter" || key === " ") return applyLength(state, tool, host);
  return null;
}

/** setWallLength keeping endpoint a. A bad number keeps editing; any other outcome ends it and keeps the selection. */
function applyLength(state: EditorState, tool: Editing, host: Host): Step {
  const idle = withSelect(state, { kind: "idle" });
  if (tool.value === "") return { state: idle, effects: [] };
  const length = Number(tool.value);
  if (!Number.isFinite(length) || length <= 0) return showToast(state, "Type a length in metres", host);
  const out = runCommand(idle, { type: "setWallLength", wallId: tool.wallId, length, keep: "a" }, host);
  return { state: out.state, effects: out.effects };
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
```

- [x] **Step 4: Wire it into the Select tool.** In `packages/editor/src/tools/select-tool.ts`, add the imports:

```ts
import { helperHit } from "../view/helper";
import { helperKey } from "./helper-edit";
```

replace the function `selectKey` with:

```ts
/** The helper-dimension value field while editing (spec §5.4 precedence 1). */
export function selectKey(state: EditorState, tool: SelectToolState, key: string, host: Host): Step | null {
  return tool.kind === "editingHelper" ? helperKey(state, tool, key, host) : null;
}
```

and replace the function `press` (the Task 5.2 version) with:

```ts
function press(state: EditorState, world: Point, host: Host): EditorState {
  // The helper text first: on a vertical wall its box overlaps the wall's hit zone.
  const helper = helperHit(state, world, host);
  if (helper) return withSelect({ ...state, snap: null }, { kind: "editingHelper", wallId: helper, value: "" });
  const hit = hitTest(state, world, host);
  if (!hit) return withSelect({ ...state, selection: [] }, { kind: "idle" });
  const selection = hit.handle ? state.selection : [hit.ref]; // a handle keeps its wall selected
  return withSelect({ ...state, selection }, { kind: "pressing", pressWorld: world, target: dragTarget(hit.ref) });
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/helper-edit.test.ts test/select-tool.test.ts test/undo.test.ts`
Expected: PASS (9 new tests; the phase 3 select and undo tests still pass).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: helper dimension editing resizes the wall keeping endpoint a"
```

---

### Task 5.8: Merged room names through the editor

Spec §9 acceptance: deleting a divider between two labelled rooms combines the names with ` / ` in label-ID order and keeps one label; undo restores both labels and the divider in one operation. The domain does the merge (phase 2); this scenario proves the editor path (select the divider, `Delete`, `Cmd+Z`). Unlabelled rooms, existing slashes and an opened exterior are covered by the phase 2 domain tests. A concurrent rename conflicting through label expectations is a phase 7 sync test.

**Files:** Create `packages/editor/test/zone-scenarios.test.ts`.

- [x] **Step 1: Write the test** `packages/editor/test/zone-scenarios.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document } from "@fm/domain";
import { dividedRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function kitchenAndDining(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining" })).doc;
}

describe("merging labelled rooms (spec §3.6, §9 acceptance)", () => {
  it("deleting the divider keeps one label with both names in label-ID order", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 }); // the divider
    shell.key("Delete");
    expect(shell.doc().zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } });
    expect(Object.keys(shell.doc().walls)).toHaveLength(6);
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 1, y: 3 });
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Kitchen / Dining", "22.04 m²"]);
  });

  it("one undo restores the divider and both labels", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 });
    shell.key("Delete");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(kitchenAndDining());
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/editor test test/zone-scenarios.test.ts`
Expected: PASS (2 tests). These use existing code; a failure is a real finding. Fix it in the owning task or phase and log it in the sprint log.

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: scenario for merged room names on divider deletion and its undo"
```

---

### Task 5.9: Demo steps 4–6 headless and the public index

`labelRooms` (step 4) and `resizeRightWall` (step 5) join the phase 3 demo helpers, so phase 8's narrated scenario can reuse them. Step 6 now starts from the resized joint (6, 3.5). `helperLabelAt` and `formatArea` are exported for other hosts: phase 8's Playwright driver clicks the helper at `helperLabelAt`.

**Files:** Replace `packages/editor/test/scenarios/demo-steps.ts` and `packages/editor/test/scenarios/demo.test.ts`. Modify `packages/editor/src/index.ts`.

- [x] **Step 1: Replace** `packages/editor/test/scenarios/demo-steps.ts`

```ts
import { helperLabelAt } from "../../src/view/helper";
import type { FakeShell } from "../fake-shell";

/** Demo step 2 (spec §1.4): W, Shift held, click the origin, type 6 / 4 / 6 along the cursor, click the first joint. */
export function drawRoom(shell: FakeShell): void {
  const shift = { shift: true };
  shell.key("w");
  shell.click({ x: 0, y: 0 }, shift);
  shell.moveTo({ x: 3, y: 0.2 }, shift); // right
  // Digits typed with Shift held: mapping the physical key to a digit is the web shell's rule (phase 4), so this
  // proves only that the value field takes digits whatever the modifiers.
  shell.type("6", shift);
  shell.key("Enter", shift);
  shell.moveTo({ x: 6.2, y: 2 }, shift); // up
  shell.type("4", shift);
  shell.key("Enter", shift);
  shell.moveTo({ x: 3, y: 4.2 }, shift); // left
  shell.type("6", shift);
  shell.key("Enter", shift);
  shell.click({ x: 0.02, y: 0.02 }, shift); // the first joint closes the chain
}

/** Demo step 3: with Shift held, from the bottom wall's midpoint to the top wall's midpoint, then finish. */
export function drawDivider(shell: FakeShell): void {
  const shift = { shift: true };
  shell.click({ x: 3.04, y: 0.03 }, shift); // midpoint snap → (3, 0)
  shell.click({ x: 3.1, y: 3.97 }, shift); // vertical axis + midpoint snap → (3, 4)
  shell.key("Enter");
}

/** Demo step 4: Z, click (1.5, 2) and (4.5, 2). Each room gets a zone; the second stays selected. */
export function labelRooms(shell: FakeShell): void {
  shell.key("z");
  shell.click({ x: 1.5, y: 2 });
  shell.click({ x: 4.5, y: 2 });
}

/** Demo step 5: select the right exterior wall (a = (6, 0)), click its helper, type 3.5, Enter. */
export function resizeRightWall(shell: FakeShell): void {
  shell.key("v");
  shell.click({ x: 6, y: 1 });
  const selected = shell.state.selection[0];
  if (!selected || selected.table !== "walls") throw new Error("the right wall is not selected");
  const at = helperLabelAt(shell.doc(), selected.id, shell.state.camera);
  if (!at) throw new Error("the right wall has no helper dimension");
  shell.click(at);
  shell.type("3.5");
  shell.key("Enter");
}
```

- [x] **Step 2: Replace** `packages/editor/test/scenarios/demo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES, zones } from "@fm/domain";
import { COLORS } from "../../src/view/colors";
import { jointAt, pointOf, wallBetween } from "../builders";
import { FakeShell } from "../fake-shell";
import { drawDivider, drawRoom, labelRooms, resizeRightWall } from "./demo-steps";

const count = (o: object) => Object.keys(o).length;
const areas = (shell: FakeShell) => zones(shell.doc()).map((z) => z.area?.toFixed(2)).sort();

function throughStep5(): FakeShell {
  const shell = FakeShell.local();
  drawRoom(shell);
  drawDivider(shell);
  labelRooms(shell);
  resizeRightWall(shell);
  return shell;
}

describe("demo script, headless (spec §1.4)", () => {
  it("step 2: draws the 6 × 4 m room with Shift and typed lengths, and closes it", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    const doc = shell.doc();
    expect([count(doc.walls), count(doc.joints)]).toEqual([4, 4]);
    wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
    wallBetween(doc, { x: 0, y: 4 }, { x: 0, y: 0 });
    expect(pointOf(doc, jointAt(doc, { x: 6, y: 4 }))).toEqual({ x: 6, y: 4 }); // exact, not just within 1 mm
    const tool = shell.state.tool;
    expect(tool.name === "wall" && tool.state.kind).toBe("idle");
  });

  it("step 3: the divider joins the two midpoints exactly and splits both walls", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    const doc = shell.doc();
    expect([count(doc.walls), count(doc.joints)]).toEqual([7, 6]);
    expect(pointOf(doc, jointAt(doc, { x: 3, y: 0 }))).toEqual({ x: 3, y: 0 });
    expect(pointOf(doc, jointAt(doc, { x: 3, y: 4 }))).toEqual({ x: 3, y: 4 });
    wallBetween(doc, { x: 3, y: 0 }, { x: 3, y: 4 });
    wallBetween(doc, { x: 0, y: 0 }, { x: 3, y: 0 });
    wallBetween(doc, { x: 3, y: 0 }, { x: 6, y: 0 });
    wallBetween(doc, { x: 6, y: 4 }, { x: 3, y: 4 });
    wallBetween(doc, { x: 3, y: 4 }, { x: 0, y: 4 });
    expect(shell.state.undo.past.map((e) => e.status)).toEqual(["usable", "usable", "usable", "usable", "usable"]);
  });

  it("step 3, undone: removing the divider restores the unsplit room exactly", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    const room = shell.doc();
    drawDivider(shell);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(room);
  });

  it("step 4: Z labels both rooms; each shows 10.64 m²", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    labelRooms(shell);
    expect(Object.values(shell.doc().zoneLabels).map((l) => l.name).sort()).toEqual(["Room 1", "Room 2"]);
    expect(areas(shell)).toEqual(["10.64", "10.64"]);
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Room 2", "10.64 m²"]);
  });

  it("step 5: the helper resizes the right wall to 3.5 m from its fixed a end; the top wall slopes", () => {
    const shell = throughStep5();
    const doc = shell.doc();
    expect(pointOf(doc, jointAt(doc, { x: 6, y: 3.5 }))).toEqual({ x: 6, y: 3.5 });
    wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 3.5 });
    wallBetween(doc, { x: 6, y: 3.5 }, { x: 3, y: 4 });
    expect(areas(shell)).toEqual(["10.64", "9.94"]);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("3.50");
  });

  it("step 6: dragging the top-right joint to (2, 2) crosses the divider: red, refused, reverted", () => {
    const shell = throughStep5();
    const corner = jointAt(shell.doc(), { x: 6, y: 3.5 });
    const entries = shell.state.undo.past.length;
    // The right wall is still selected after step 5, so (6, 3.5) is one of its handles.
    shell.moveTo({ x: 6, y: 3.5 });
    shell.down({ x: 6, y: 3.5 });
    shell.moveTo({ x: 4, y: 3 }); // still valid
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(walls.some((p) => p.kind === "polygon" && p.color === COLORS.invalid)).toBe(true);
    shell.up({ x: 2, y: 2 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 3.5 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(entries);
  });
});
```

- [x] **Step 3: Export for other hosts.** Append to `packages/editor/src/index.ts`:

```ts
export { helperLabelAt } from "./view/helper";
export { formatArea } from "./view/tags";
```

- [x] **Step 4: Run the whole editor suite**

Run: `pnpm --filter @fm/editor test --reporter verbose`
Expected: PASS, including `scenarios/demo.test.ts` (6 tests) and every phase 3 file. A failing demo step is a real bug: fix it in the owning task and log it.

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: headless demo steps 2-6; export helperLabelAt and formatArea"
```

---

### Task 5.10: Playwright: demo steps 2–5 and a rename round trip

> **Cut (revised: lean mode, 2026-09-29).** The headless demo test covers steps 2–6; the phase 4 smoke covers the browser. Skip this task. Its Step 1 helper file `e2e/support/canvas.ts` is created by phase 7 Task 7.16 instead.

The canvas is not in the DOM, so the tests read the properties panel (README P14). The helper's screen position comes from the `helperLabelAt` formula at the initial camera: the right wall's midpoint (6, 2), pushed 0.10 m + 18 px / 80 px per m to the left of a → b, gives (5.675, 2). The rename test re-selects the zone after renaming, which proves the name went through the editor rather than staying in the input's local draft.

**Files:** Create `packages/web/e2e/support/canvas.ts`, `packages/web/e2e/zones.spec.ts`.

- [ ] **Step 1: Write the helpers** `packages/web/e2e/support/canvas.ts`

```ts
import type { Locator, Page } from "@playwright/test";

// Mirrors the editor's initial camera (README contracts): centre (3, 2), 80 px per metre, world y up.
export const CENTER = { x: 3, y: 2 };
export const ZOOM = 80;

export type WorldPoint = { x: number; y: number };

export async function toScreen(canvas: Locator, p: WorldPoint): Promise<WorldPoint> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas is not visible");
  return {
    x: box.x + box.width / 2 + (p.x - CENTER.x) * ZOOM,
    y: box.y + box.height / 2 - (p.y - CENTER.y) * ZOOM,
  };
}

export async function moveTo(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  const s = await toScreen(canvas, p);
  await page.mouse.move(s.x, s.y, { steps: 4 });
}

export async function clickAt(page: Page, canvas: Locator, p: WorldPoint): Promise<void> {
  await moveTo(page, canvas, p);
  await page.mouse.down();
  await page.mouse.up();
}

export async function typeLength(page: Page, value: string): Promise<void> {
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

/** Demo steps 2–3: the 6 × 4 room by typed lengths with Shift held, then the divider between the two midpoints. */
export async function drawRoomWithDivider(page: Page, canvas: Locator): Promise<void> {
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  await moveTo(page, canvas, { x: 3, y: 0 });
  await typeLength(page, "6");
  await moveTo(page, canvas, { x: 6, y: 2 });
  await typeLength(page, "4");
  await moveTo(page, canvas, { x: 3, y: 4 });
  await typeLength(page, "6");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await clickAt(page, canvas, { x: 3, y: 0 }); // midpoint of the bottom wall
  await clickAt(page, canvas, { x: 3, y: 4 }); // midpoint of the top wall, on the vertical axis
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
}
```

- [ ] **Step 2: Write the tests** `packages/web/e2e/zones.spec.ts`

```ts
import { expect, test } from "@playwright/test";
import { clickAt, drawRoomWithDivider } from "./support/canvas";

// helperLabelAt (packages/editor/src/view/helper.ts) for the right wall a = (6, 0), b = (6, 4) at 80 px/m:
// midpoint (6, 2) + left normal (−1, 0) × (0.10 m + 18 px / 80 px per m) = (5.675, 2).
const RIGHT_WALL_HELPER = { x: 5.675, y: 2 };

test("labels both rooms and resizes the right wall through its helper (demo steps 2–5)", async ({ page }) => {
  await page.goto("/?name=Alice&server=off"); // local mode even if a reused dev server has VITE_SERVER_URL (revised at review)
  const canvas = page.getByTestId("canvas");
  await expect(canvas).toBeVisible();
  await drawRoomWithDivider(page, canvas);

  // Step 4: Z, click inside each room.
  await page.keyboard.press("z");
  await expect(page.locator('[data-tool="zone"]')).toHaveAttribute("aria-pressed", "true");
  await clickAt(page, canvas, { x: 1.5, y: 2 });
  await expect(page.locator('[data-field-id="area"]')).toHaveValue("10.64 m²");
  await clickAt(page, canvas, { x: 4.5, y: 2 });
  await expect(page.locator('[data-field-id="name"]')).toHaveValue("Room 2");
  await expect(page.locator('[data-field-id="area"]')).toHaveValue("10.64 m²");

  // Step 5: select the right wall, click its helper, type 3.5.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 6, y: 1 });
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("4.00");
  await clickAt(page, canvas, RIGHT_WALL_HELPER);
  await page.keyboard.type("3.5");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-field-id="length"]')).toHaveValue("3.50");
});

test("renames a zone from the properties panel", async ({ page }) => {
  await page.goto("/?name=Alice&server=off");
  const canvas = page.getByTestId("canvas");
  await drawRoomWithDivider(page, canvas);
  await page.keyboard.press("z");
  await clickAt(page, canvas, { x: 1.5, y: 2 });

  const name = page.locator('[data-field-id="name"]');
  await expect(name).toHaveValue("Room 1");
  await name.fill("Kitchen");
  await name.press("Enter"); // blurs the field, which sends setField

  // Deselect, then select the zone again: the name must come back from the editor.
  await page.keyboard.press("v");
  await clickAt(page, canvas, { x: 8, y: 1 });
  await expect(page.getByTestId("properties")).toContainText("Nothing selected");
  await clickAt(page, canvas, { x: 1, y: 3 });
  await expect(name).toHaveValue("Kitchen");
});
```

- [ ] **Step 3: Run them**

Run: `pnpm e2e`
Expected: PASS, 3 tests (the phase 4 smoke test plus these two) in Chromium. Common failures:

- `10.64 m²` missing: the zone click hit a tag or a boundary. Check the divider's exact midpoints (the snap glyph should show a triangle).
- The length stays `4.00`: the helper click missed. Compare the drawn text position with `RIGHT_WALL_HELPER`, and log real text widths against `FakeHost` ones (a gate 5 question).

Record every failure and fix in the sprint log.

- [ ] **Step 4: Check and commit**

```bash
pnpm check
git add packages/web/e2e
git commit -m "web: Playwright covers zones, the helper resize and a rename round trip"
```

---

## Completion criteria

- [x] `pnpm check` passes. Every phase 3 editor test still passes unchanged except the replaced `demo.test.ts`, which now covers steps 2–6.
- [x] Zone tool (spec §3.6, §5.6, §9 acceptance):
  - a click in an unlabelled room creates "Room N" at the click point and selects it;
  - a click on a labelled room's floor or tag selects it without creating a label;
  - a boundary or outside click does nothing;
  - hover highlights the room;
  - unlabelled rooms show as hints only while `Z` is active.
- [x] Select tool hit order is helper → handles → joints → walls → tags → labelled floors. An unlabelled floor clears the selection, and zones never drag.
- [x] Properties show a zone's editable `name` and read-only `area` (`10.64 m²`, the domain's unavailable reason, or "no enclosing walls"). `setField name` renames in one undoable edit, and other fields are ignored.
- [x] `Delete` removes only a selected zone's label, in the Select and Zone tools, never while a value field is active.
- [x] The selected zone's floor is highlighted and follows geometry changes (selection by label ID).
- [x] Orphan tags are drawn and are selectable for rename and delete.
- [x] Helper dimension:
  - the selected wall shows its length on a dimension line, with the `a` handle marked fixed;
  - a click on the text starts editing;
  - digits, `.` and `Backspace` edit the value;
  - `Enter`/`Space` apply `setWallLength` with `keep: "a"`;
  - `Esc` cancels;
  - a bad number keeps editing with a toast;
  - a domain refusal ends editing with a toast.
- [x] Deleting a divider between two labelled rooms gives "Kitchen / Dining" (one label, ID L1), and one undo restores both labels and the divider.
- [x] Demo steps 2–6 pass headless (`scenarios/demo.test.ts`): 10.64 m² twice, then 10.64 and 9.94 m² with the joint at exactly (6, 3.5), and the step 6 drag red, refused and reverted.
- [x] ~~`pnpm e2e` passes: demo steps 2–5 in Chromium and the rename round trip.~~ Task 5.10 cut (lean mode); the controller ran steps 2–6 and the rename round trip once in Chromium with a Playwright script instead (Gate 5 report).
- [x] `helperLabelAt` and `formatArea` are exported from `@fm/editor`.
- [x] No file in `packages/editor/src` exceeds about 300 lines (`wc -l`). If one does, split it and record the split as a plan change.
- [x] The sprint log is complete and every finding is in design memory.

## Gate 5

Follow the [gate protocol](README.md#gate-protocol) with report `docs/reports/gate-5-zones-helpers.md`. Phase-specific verification:

```bash
pnpm check
pnpm --filter @fm/editor test --reporter verbose
pnpm e2e
wc -l packages/editor/src/*.ts packages/editor/src/*/*.ts | sort -n | tail -8
pnpm dev   # demo steps 2-6 by hand on an unsaved local document; time them
```

The report must answer:

1. **Tag hit accuracy.**
   - Does the clickable tag box match the drawn text in the browser? `FakeHost` widths are 0.6 × size per character; log two real widths (`Room 1`, `10.64 m²`) from `createWebHost` for comparison.
   - Does the two-line height (16 px apart, 18 px half-height) cover the drawn glyphs?
2. **Helper placement at different zooms** (20, 80 and 400 px/m):
   - Does the text overlap the wall, the tag or the dimension line?
   - Is the left of a → b the right side for the demo's counter-clockwise room? For a room drawn clockwise, the helper sits outside the room; is that acceptable?
3. **Zone rules in the browser.**
   - Did any rule feel wrong? Candidates: an outside click in `Z` keeps the selection; an unlabelled floor click in Select clears it; the label goes at the raw click point; the name "Room N" uses the label count, so it can repeat after deletions.
   - Confirm each rule or change it, and record it in `editor-interaction.md`.
4. **Demo timing.** How long do steps 2–6 take by hand? Which step is fiddly: clicking the helper, or hitting a midpoint?
5. **Scene cost.** Re-run `test/perf.test.ts` and compare with gate 3, now that zones and tags are drawn every frame.
6. **Risks for phases 6–7.**
   - `labelZone` from two clients at once: labels in one room are refused locally, but both may be accepted concurrently (spec §3.6).
   - Renames racing through label expectations.
   - Helper editing when a remote change touches the wall: phase 7 must cancel `editingHelper` like a gesture (§5.7).

## Contract extensions

Additions to the README's `@fm/editor` contract. Nothing is renamed.

- `tools/hit-test.ts`:
  - `hitTest(state, world, host)` gains `host`, as the phase 3 extension point anticipated;
  - new `labelAtFloor(doc, world)`.
- `view/tags.ts`:
  - `TagLine`, `TagLayout`, `tagLayout` and `tagAt`;
  - `inBox`, `zoneOfLabel`, `tagAreaText`, `areaFieldText` and `formatArea`;
  - `TAG_LINE_PX`, `TAG_PAD_PX`, `AREA_UNAVAILABLE_SHORT` ("Area unavailable") and `ORPHAN_TEXT` ("no enclosing walls").
- `view/zones-layer.ts`: `drawZones(state, doc, layers, host)`.
- `view/helper.ts`:
  - `helperLabelAt(doc, wallId, camera)` is the single placement function;
  - also `helperWall`, `helperText`, `helperBox`, `helperHit` and `drawHelper`;
  - `HELPER_LINE_PX`, `HELPER_OFFSET_PX` and `HELPER_TICK_PX`.
- `tools/helper-edit.ts`: `helperKey`.
- `tools/zone-tool.ts`: `zonePointer` and `setField` are now real.
- `index.ts` also exports `helperLabelAt` and `formatArea`.
- Test harness:
  - `test/builders.ts`: `labelledDoc`, `withOrphan` and `narrowRoomDoc`;
  - `test/scenarios/demo-steps.ts`: `labelRooms` and `resizeRightWall`;
  - `packages/web/e2e/support/canvas.ts`: `CENTER`, `ZOOM`, `toScreen`, `moveTo`, `clickAt`, `typeLength` and `drawRoomWithDivider`.
- Behaviour the contract did not state:
  - the helper sits on the left of a → b, 18 px beyond the wall face, and its text is hit-tested before everything else;
  - the fixed endpoint is marked by a filled `a` handle;
  - a bad helper number keeps editing, while a domain refusal ends it;
  - tags have two lines (the short "Area unavailable" on tags, the domain's reason in properties);
  - labelled rooms are always filled, and unlabelled ones only as hints in `Z`;
  - hover in `Z` uses the selection fill;
  - a new zone's label goes at the raw (unsnapped) click point, named "Room N" with N = number of labels + 1.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | all | process | Lean mode: 4 waves (5.1 · 5.2, 5.3, 5.5→5.6 · 5.4→5.8, 5.7 · 5.9), 2 reviews (waves 1–2, wave 3), both found nothing at the demo bar | No fixes needed | `process.md` |
| 2026-09-29 | 5.2/5.3/5.5 | note | Parallel tasks needed each other's behaviour in tests (zone properties, floor-click selection, Z hover) | Agents set state directly or dropped an assertion; the controller restored the plan's gestures after the merges | none |
| 2026-09-29 | 5.1, 5.7 | deviation | `tagLayout` and helper keys look up IDs from outside the document | `isValidId` guards; a vanished wall ends helper editing silently on the next key | `editor-interaction.md` |
| 2026-09-29 | 5.6 | deviation | The plan's `drawSelection` read `doc.walls[id]` without `isValidId` | Kept the checked `draggedJoints` path; index 0 (`a`) drawn fixed | none |
| 2026-09-29 | 5.9 | deviation | Phase 3's "step 6 recovered" test kept, now starting from (6, 3.5) | 7 demo tests instead of 6 | none |
| 2026-09-29 | 5.10 | cut | Browser test of steps 2–5 cut (lean mode) | Controller ran steps 2–6 and a rename round trip in Chromium once by script: areas 10.64/10.64 then 10.64/9.94, length 3.50, rename and undo, step 6 refused | none |
