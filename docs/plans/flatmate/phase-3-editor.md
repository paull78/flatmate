# Phase 3: Headless editor on an unsaved LocalDocument

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** A platform-neutral `@fm/editor` whose `update(state, event, host) → { state, effects }` draws chained walls with typed lengths, snaps (endpoint, midpoint, on-wall, grid; `Shift` orthogonal, `Ctrl` bypass), selects and drags walls and joints with one commit per gesture, deletes, and undoes/redoes. It runs on an unsaved `LocalDocument` and is driven entirely by the fake shell. Demo steps 2, 3 and 6 pass as headless scenarios.

**Spec:** §5.1–§5.9, §7.0 (local parts, the `OpenDocument` interface, notices), §7.5 (the local plain-stack view of history), §9 (editor rows), §10 step 3.

**Prerequisites:** Gate 2 approved. `@fm/domain` exports everything in the README contract (`execute`, `wallOutlines`, `hitCandidates`, `wallHelperDimension`, `incidentWalls`, `wallEnds`, `sortedIds`, geometry helpers, `applyPatch`, `invertPatch`, `entityValue`, `validateDocument`, `topologyMessage`, `rectangleRoom`).

**Design memory to read first:**

- `architecture.md`: the Don'ts on async work in `Host`, sync queries in effects, and shells that precompute world coordinates.
- `editor-interaction.md`: the whole Decisions table, and these Don'ts:
  - no loop mode, no `DI`, no multi/box selection, no nudge;
  - keep the midpoint snap;
  - never drop `chainStart`;
  - scenario tests use pointer moves, not typed lengths alone;
  - don't end a wall chain because its preview is invalid.
- `open-documents.md`: the local kind accepts at once, emits `accepted` in the same `update`, and has no discard prompt.
- `undo-history.md`: the local plain stack uses the same code path.

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/protocol/src/messages.ts` | Wire message **types only** (`ProjectMeta`, `RejectReason`, `ClientMessage`, `ServerMessage`, `MAX_MESSAGE_BYTES`); phase 6 adds the parsers |
| Modify | `packages/protocol/src/index.ts` | Export `messages.ts` |
| Modify | `eslint.config.js` | `_`-prefixed parameters may be unused (extension-point stubs) |
| Create | `packages/editor/src/types.ts` | `Mods`, `NO_MODS`, `Size`, `ToolName`, `SnapKind`, `SnapResult`, `ProjectInfo`, `RemotePresence` |
| Create | `packages/editor/src/camera.ts` | Screen ↔ world, zoom at cursor, pan |
| Create | `packages/editor/src/ports/host.ts` | `Host`, `FontSpec` |
| Create | `packages/editor/src/ports/effects.ts` | `Effect`, `WorkspaceOp` |
| Create | `packages/editor/src/ports/events.ts` | `Event`, `UiAction`, `WorkspaceEvent`, `ServerEvent`, `PointerInput` |
| Create | `packages/editor/src/view/scene-types.ts` | `Scene`, `Layer`, `Primitive`, `Width`, `Color`, `Align` |
| Create | `packages/editor/src/view/view-model.ts` | `ViewModel`, `Field`, `buildViewModel` |
| Create | `packages/editor/src/document/types.ts` | `Notice`, `CommitInput`, `DocStep`, `DocumentStatus`, `LocalDocument`, `OpenDocument` |
| Create | `packages/editor/src/document/local-document.ts` | `createLocalDocument`, `localCommit` |
| Create | `packages/editor/src/document/open-document.ts` | The only `switch` on document kind |
| Create | `packages/editor/src/snapping/policies.ts` | Snap types and the four policies |
| Create | `packages/editor/src/snapping/chooser.ts` | Pure `choose` |
| Create | `packages/editor/src/snapping/snap.ts` | `snapPoint`, `gridSpacingFor`, `orthogonalAxis`, `projectOnAxis` |
| Create | `packages/editor/src/history/history.ts` | Value-based history shared by both document kinds |
| Create | `packages/editor/src/tools/types.ts` | Tool state unions, `idleTool`, `draggedJoints` |
| Create | `packages/editor/src/state.ts` | `EditorState`, `Step`, `initialState`, `switchTool`, `pruneSelection` |
| Create | `packages/editor/src/toast.ts` | `showToast`, `onToastTimer` |
| Create | `packages/editor/src/view/colors.ts`, `view/fonts.ts` | Palette and fonts |
| Create | `packages/editor/src/commit.ts` | `runCommand`, `runHistory`, `blockedMessage` |
| Create | `packages/editor/src/notices.ts` | `applyNotices`, `rejectMessage` |
| Create | `packages/editor/src/view/scene.ts` | `buildScene`, `sceneDocument`, `textBox` |
| Create | `packages/editor/src/keys.ts` | Key precedence: value field → command codes → global; `undoRedo` |
| Create | `packages/editor/src/pointer.ts` | Pointer routing: pan, tools, presence; `followCamera` (wave 6 review) |
| Create | `packages/editor/src/session.ts` | Phase 7 stubs: workspace, server events, presence |
| Create | `packages/editor/src/update.ts` | `update`: event routing plus one trailing `render` effect |
| Create | `packages/editor/src/tools/hit-test.ts` | Handles of the selected wall, then joints, then walls |
| Create | `packages/editor/src/tools/wall-tool.ts` | Wall tool (§5.5) |
| Create | `packages/editor/src/tools/select-tool.ts` | Select tool (§5.6, §5.7) |
| Create | `packages/editor/src/tools/zone-tool.ts` | Placeholder; phase 5 replaces it |
| Replace | `packages/editor/src/index.ts` | Public exports |
| Create | `packages/editor/test/builders.ts` | Demo documents and lookups (`roomDoc`, `dividedRoomDoc`, `jointAt`, …) |
| Create | `packages/editor/test/fake-shell.ts` | `FakeHost`, `FakeShell` |
| Test | `packages/protocol/test/message-types.test.ts`, `packages/editor/test/*.test.ts`, `packages/editor/test/scenarios/demo.test.ts` | Unit tests and headless scenarios |

---

## Tasks

### Task 3.1: Protocol message types

The editor needs `ProjectMeta`, `RejectReason` and `ServerMessage` before the server exists. This task adds the **types** from the README contract; phase 6 Task 6.1 replaces the file with a version that keeps these types unchanged and adds the parsers.

**Files:** Create `packages/protocol/src/messages.ts`, `packages/protocol/test/message-types.test.ts`. Modify `packages/protocol/src/index.ts`.

(revised 2026-09-28: the code below is the final code. The wave 1 code review added `openFailed`, so a failed open is tied to its generation (spec §7.2), and made the test a compile-time contract: an `@ts-expect-error` for `openProject { id }` and an exhaustive switch over `ServerMessage`.)

- [x] **Step 1: Write the failing test** `packages/protocol/test/message-types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assertNever, MAX_MESSAGE_BYTES, type ClientMessage, type RejectReason, type ServerMessage } from "../src/index";

// One label per ServerMessage variant: adding a variant without a case fails `pnpm check` (typecheck).
function describeServerMessage(m: ServerMessage): string {
  switch (m.type) {
    case "welcome":
      return `welcome ${m.clientId}`;
    case "projects":
      return `projects ${m.items.length}`;
    case "projectCreated":
      return `projectCreated ${m.meta.id}`;
    case "error":
      return `error ${m.message}`;
    case "snapshot":
      return `snapshot ${m.projectId}@${m.seq}`;
    case "openFailed":
      return `openFailed ${m.projectId}/${m.generation}`;
    case "changes":
      return `changes ${m.seq}`;
    case "ack":
      return `ack ${m.changesetId}`;
    case "rejected":
      return `rejected ${m.changesetId}`;
    case "presence":
      return `presence ${m.clientId}`;
    case "presenceLeft":
      return `presenceLeft ${m.clientId}`;
    default:
      return assertNever(m);
  }
}

describe("message types", () => {
  it("caps messages at 1 MB (spec §7.2)", () => {
    expect(MAX_MESSAGE_BYTES).toBe(1_000_000);
  });

  it("type-checks a rejection and a hello (compile-time contract)", () => {
    const reason: RejectReason = { kind: "conflict", entities: [{ table: "joints", id: "j1" }] };
    const rejected: ServerMessage = { type: "rejected", projectId: "p1", generation: "g1", changesetId: "c1", reason };
    const hello: ClientMessage = { type: "hello", clientId: "tab1", name: "Alice" };
    // @ts-expect-error openProject uses projectId, not id
    const wrongOpen: ClientMessage = { type: "openProject", id: "p1", generation: "g1" };
    expect([rejected.type, hello.type, wrongOpen.type]).toEqual(["rejected", "hello", "openProject"]);
  });

  it("ties a failed open to the project and generation it answers", () => {
    const failed: ServerMessage = { type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" };
    expect(failed).toEqual({ type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" });
  });

  it("switches exhaustively over server messages", () => {
    expect(describeServerMessage({ type: "welcome", clientId: "tab1", color: "#f00" })).toBe("welcome tab1");
    expect(describeServerMessage({ type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" })).toBe(
      "openFailed p1/g2",
    );
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test test/message-types.test.ts`
Expected: FAIL, `MAX_MESSAGE_BYTES` is not exported (`expected undefined to be 1000000`).

- [x] **Step 3: Implement** `packages/protocol/src/messages.ts`

```ts
import type { Changeset, EntityKey, StoredDocument, VersionMap } from "./patch";
import type { Point } from "./util";

// Wire messages (spec §7.2). Phase 6 adds the hand-written parsers to this file (types unchanged).

export type ProjectMeta = { id: string; name: string };

export type RejectReason =
  | { kind: "malformed"; message: string }
  | { kind: "tooLarge" }
  | { kind: "unknownProject" }
  | { kind: "conflict"; entities: EntityKey[] }
  | { kind: "invalid"; violations: string[] };

export type ClientMessage =
  | { type: "hello"; clientId: string; name: string }
  | { type: "listProjects"; requestId: string }
  | { type: "createProject"; requestId: string; name: string }
  | { type: "openProject"; projectId: string; generation: string }
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] };

// `error` answers a workspace request (its `requestId`) or a malformed message that cannot be answered
// with `rejected` (`requestId: null`); it never ends an open. An unknown project on `openProject` is
// answered with `openFailed`, which carries the `projectId` and `generation` of the open it answers.
export type ServerMessage =
  | { type: "welcome"; clientId: string; color: string }
  | { type: "projects"; requestId: string; items: ProjectMeta[] }
  | { type: "projectCreated"; requestId: string; meta: ProjectMeta }
  | { type: "error"; requestId: string | null; message: string }
  | { type: "snapshot"; projectId: string; generation: string; meta: ProjectMeta; doc: StoredDocument; versions: VersionMap; seq: number }
  | { type: "openFailed"; projectId: string; generation: string; message: string }
  | { type: "changes"; projectId: string; generation: string; seq: number; changeset: Changeset; clientId: string }
  | { type: "ack"; projectId: string; generation: string; changesetId: string; seq: number }
  | { type: "rejected"; projectId: string; generation: string; changesetId: string; reason: RejectReason }
  | { type: "presence"; projectId: string; generation: string; clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[] }
  | { type: "presenceLeft"; projectId: string; generation: string; clientId: string };

export const MAX_MESSAGE_BYTES = 1_000_000;
```

Append to `packages/protocol/src/index.ts`:

```ts
export * from "./messages";
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/protocol test test/message-types.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/protocol
git commit -m "protocol: wire message types (parsers follow in phase 6)"
```

---

### Task 3.2: Editor types, camera and the unused-parameter lint rule

**Files:** Modify `eslint.config.js`. Create `packages/editor/src/types.ts`, `packages/editor/src/camera.ts`, `packages/editor/test/camera.test.ts`.

(revised 2026-09-28: the code below is the final code. The wave 1 reviews froze `NO_MODS`, made `zoomAt` ignore a factor that is not a finite positive number, documented CSS pixels and `dpr`, added round-trip and clamped-anchor tests, and limited the lint exemption to parameters.)

- [x] **Step 1: Allow `_`-prefixed unused parameters.** Later tasks leave a few documented stubs whose parameters are used only in phases 5 and 7. In `eslint.config.js`, add this object at the end of the exported array:

```js
  {
    // Extension-point stubs keep their final signature; unused parameters start with "_".
    // Only parameters are exempt: an unused `_` variable is still reported.
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
```

Run: `pnpm lint`
Expected: exit code 0.

- [x] **Step 2: Write the failing test** `packages/editor/test/camera.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, panBy, screenToWorld, worldToScreen, zoomAt, type Camera } from "../src/camera";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };

describe("camera", () => {
  it("maps the viewport centre to the camera centre", () => {
    expect(screenToWorld(camera, { x: 600, y: 400 })).toEqual({ x: 3, y: 2 });
  });

  it("points world y up and screen y down", () => {
    expect(worldToScreen(camera, { x: 3, y: 3 })).toEqual({ x: 600, y: 320 });
    expect(screenToWorld(camera, { x: 680, y: 400 })).toEqual({ x: 4, y: 2 });
  });

  it("round-trips a world point exactly at integer scale", () => {
    const p = { x: 6, y: 0 };
    expect(screenToWorld(camera, worldToScreen(camera, p))).toEqual(p);
  });

  it("round-trips world points at a non-trivial zoom", () => {
    const odd: Camera = { center: { x: 0.1, y: 0.2 }, zoom: 80 * Math.E, viewport: { width: 1200, height: 800 }, dpr: 1 };
    for (const p of [
      { x: 3.3, y: -4.7 },
      { x: 0.1, y: 0 },
      { x: -12.25, y: 7.125 },
    ]) {
      const back = screenToWorld(odd, worldToScreen(odd, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("zooms around the cursor", () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(camera, screen);
    const zoomed = zoomAt(camera, screen, 2);
    expect(zoomed.zoom).toBe(160);
    const after = screenToWorld(zoomed, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("clamps zoom to [5, 2000] px per metre", () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1000).zoom).toBe(2000);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.0001).zoom).toBe(5);
  });

  it("keeps the point under the cursor when the zoom is clamped", () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(camera, screen);
    for (const factor of [1000, 0.0001]) {
      const after = screenToWorld(zoomAt(camera, screen, factor), screen);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it("ignores a zoom factor that is not a finite positive number", () => {
    const screen = { x: 300, y: 200 };
    for (const factor of [NaN, 0, -1, Infinity]) {
      expect(zoomAt(camera, screen, factor)).toBe(camera);
    }
  });

  it("pans with the pointer", () => {
    // Dragging right and up by 80 px at 80 px/m shows what was 1 m to the left and 1 m below.
    expect(panBy(camera, 80, -80).center).toEqual({ x: 2, y: 1 });
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/camera.test.ts`
Expected: FAIL, `Cannot find module '../src/camera'`.

- [x] **Step 4: Implement** `packages/editor/src/types.ts`

```ts
import type { EntityKey, Point } from "@fm/protocol";

export type Mods = { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
export const NO_MODS: Readonly<Mods> = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });

export type Size = { width: number; height: number };
export type ToolName = "select" | "wall" | "zone";
export type SnapKind = "endpoint" | "midpoint" | "onWall" | "grid" | "none";
export type SnapResult = { point: Point; kind: SnapKind };
export type ProjectInfo = { id: string; name: string };
export type RemotePresence = { clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[] };
```

and `packages/editor/src/camera.ts`:

```ts
import type { Point } from "@fm/protocol";
import type { Size } from "./types";

// The editor owns the camera (spec §5.2): shells send screen coordinates only.
// Screen y points down; world y points up. Screen coordinates and zoom are CSS pixels
// (zoom = CSS pixels per metre); `dpr` is carried only for the renderer's backing store
// and is ignored by these transforms.
export type Camera = { center: Point; zoom: number; viewport: Size; dpr: number };

export const DEFAULT_ZOOM = 80;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 2000;

export function screenToWorld(c: Camera, p: Point): Point {
  return {
    x: c.center.x + (p.x - c.viewport.width / 2) / c.zoom,
    y: c.center.y - (p.y - c.viewport.height / 2) / c.zoom,
  };
}

export function worldToScreen(c: Camera, p: Point): Point {
  return {
    x: (p.x - c.center.x) * c.zoom + c.viewport.width / 2,
    y: c.viewport.height / 2 - (p.y - c.center.y) * c.zoom,
  };
}

/**
 * Zooms by `factor` while the world point under `screen` stays under it; the zoom is clamped to
 * [MIN_ZOOM, MAX_ZOOM]. A factor that is not finite or not > 0 (NaN, 0, negative, Infinity)
 * returns `c` unchanged.
 */
export function zoomAt(c: Camera, screen: Point, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return c;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const anchor = screenToWorld(c, screen);
  return {
    ...c,
    zoom,
    center: {
      x: anchor.x - (screen.x - c.viewport.width / 2) / zoom,
      y: anchor.y + (screen.y - c.viewport.height / 2) / zoom,
    },
  };
}

/** Moves the content with the pointer by (dx, dy) screen pixels. */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { ...c, center: { x: c.center.x - dx / c.zoom, y: c.center.y + dy / c.zoom } };
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/camera.test.ts`
Expected: PASS (9 tests).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add eslint.config.js packages/editor
git commit -m "editor: shared types and camera; lint allows _-prefixed unused parameters"
```

---

### Task 3.3: Ports, view types and document types

These files are types only. The test builds one value of every event and effect variant, so a missing or misspelled variant fails the typecheck.

**Files:** Create `packages/editor/src/ports/host.ts`, `ports/effects.ts`, `ports/events.ts`, `view/scene-types.ts`, `view/view-model.ts`, `document/types.ts`, `packages/editor/test/ports.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/ports.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assertNever } from "@fm/domain";
import type { Notice } from "../src/document/types";
import type { Effect, WorkspaceOp } from "../src/ports/effects";
import type { Event, ServerEvent, UiAction, WorkspaceEvent } from "../src/ports/events";
import { NO_MODS } from "../src/types";
import type { ViewModel } from "../src/view/view-model";

function label(e: Event): string {
  switch (e.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
      return `${e.type} ${e.screen.x},${e.screen.y}`;
    case "wheel":
      return `wheel ${e.deltaY}`;
    case "key":
      return `key ${e.key}`;
    case "ui":
      return `ui ${e.action.type}`;
    case "timerFired":
      return `timer ${e.timerId}`;
    case "workspaceEvent":
      return `workspace ${e.event.type}`;
    case "saveResult":
      return `save ${e.writeId}`;
    case "serverEvent":
      return `server ${e.event.type}`;
    case "viewportResized":
      return `resize ${e.size.width}`;
  }
}

function effectLabel(e: Effect): string {
  switch (e.type) {
    case "render":
      return `render ${e.scene.layers.length}`;
    case "workspace":
      return `workspace ${e.op.type}`;
    case "saveSnapshot":
      return `save ${e.writeId}`;
    case "submit":
      return `submit ${e.changeset.id}`;
    case "presence":
      return `presence ${e.projectId}`;
    case "startTimer":
      return `start ${e.timerId} ${e.ms}`;
    case "cancelTimer":
      return `cancel ${e.timerId}`;
    default:
      return assertNever(e);
  }
}

// Pin the exact variants of the unions built only in part above: a missing or an extra one fails the typecheck.
const serverEventTypes: Record<ServerEvent["type"], true> = {
  welcome: true,
  snapshot: true,
  openFailed: true,
  changes: true,
  ack: true,
  rejected: true,
  presence: true,
  presenceLeft: true,
  connection: true,
};
const uiActionTypes: Record<UiAction["type"], true> = {
  createProject: true,
  openProject: true,
  showProjectList: true,
  pickTool: true,
  setField: true,
  undo: true,
  redo: true,
};
const workspaceEventTypes: Record<WorkspaceEvent["type"], true> = { projects: true, created: true, failed: true };
const workspaceOpTypes: Record<WorkspaceOp["type"], true> = { list: true, create: true, open: true };
const noticeTypes: Record<Notice["type"], true> = { accepted: true, rejected: true, remoteChange: true, resynced: true, offline: true };

const view: ViewModel = {
  activeTool: "wall",
  commandBar: { prompt: "Next point or length", value: "3.20", unit: "m" },
  properties: { kind: "none" },
  cursor: "crosshair",
  snap: { kind: "endpoint", at: { x: 3, y: 0 } },
  presence: [],
  project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
  projectList: null,
  toast: null,
  canUndo: true,
  canRedo: false,
};

describe("ports", () => {
  it("covers every event variant", () => {
    const events: Event[] = [
      { type: "pointerDown", screen: { x: 1, y: 2 }, mods: NO_MODS, button: 0 },
      { type: "wheel", screen: { x: 0, y: 0 }, deltaX: 0, deltaY: 5, mods: NO_MODS },
      { type: "key", key: "w", mods: NO_MODS },
      { type: "ui", action: { type: "pickTool", tool: "zone" } },
      { type: "timerFired", timerId: "toast" },
      { type: "workspaceEvent", event: { type: "failed", requestId: null, message: "x" } },
      { type: "saveResult", writeId: "w1", ok: true },
      { type: "serverEvent", event: { type: "connection", state: "open" } },
      { type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 },
    ];
    expect(events.map(label)).toEqual([
      "pointerDown 1,2", "wheel 5", "key w", "ui pickTool", "timer toast",
      "workspace failed", "save w1", "server connection", "resize 800",
    ]);
  });

  it("covers every effect variant", () => {
    const camera = { center: { x: 0, y: 0 }, zoom: 80, viewport: { width: 800, height: 600 }, dpr: 1 };
    const effects: Effect[] = [
      { type: "render", scene: { layers: [] }, view, camera },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "saveSnapshot", projectId: "p", writeId: "w", content: "{}" },
      { type: "submit", projectId: "p", generation: "g", changeset: { id: "c", patch: { puts: [], deletes: [] }, expect: [] } },
      { type: "presence", projectId: "p", generation: "g", cursor: null, selection: [] },
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
    ];
    expect(effects.map(effectLabel)).toEqual([
      "render 0", "workspace list", "save w", "submit c", "presence p", "start toast 3000", "cancel toast",
    ]);
  });

  it("pins the server event, UI action, workspace and notice variants", () => {
    expect(Object.keys(serverEventTypes)).toEqual([
      "welcome", "snapshot", "openFailed", "changes", "ack", "rejected", "presence", "presenceLeft", "connection",
    ]);
    expect(Object.keys(uiActionTypes)).toEqual(["createProject", "openProject", "showProjectList", "pickTool", "setField", "undo", "redo"]);
    expect(Object.keys(workspaceEventTypes)).toEqual(["projects", "created", "failed"]);
    expect(Object.keys(workspaceOpTypes)).toEqual(["list", "create", "open"]);
    expect(Object.keys(noticeTypes)).toEqual(["accepted", "rejected", "remoteChange", "resynced", "offline"]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor typecheck`
Expected: FAIL, `test/ports.test.ts(2,29): error TS2307: Cannot find module '../src/ports/effects'`. The test run itself passes before the sources exist: the test imports only types, which Vitest erases, so the red step is the typecheck.

- [x] **Step 3: Implement the ports.** `packages/editor/src/ports/host.ts`:

```ts
// Synchronous queries the core needs inside update (spec §5.2). No async work here.
export type FontSpec = { family: string; size: number; weight?: number }; // size in px

export interface Host {
  textMetrics(text: string, font: FontSpec): { width: number; ascent: number; descent: number };
  now(): number;
  newId(): string;
}
```

`packages/editor/src/ports/effects.ts`:

```ts
import type { Changeset, EntityKey, Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Scene } from "../view/scene-types";
import type { ViewModel } from "../view/view-model";

// Async work the core asks the shell to do (spec §5.2). Results come back as events.
export type WorkspaceOp =
  | { type: "list"; requestId: string }
  | { type: "create"; requestId: string; name: string }
  | { type: "open"; projectId: string; generation: string };

export type Effect =
  | { type: "render"; scene: Scene; view: ViewModel; camera: Camera } // the shell never reads editor state
  | { type: "workspace"; op: WorkspaceOp }
  | { type: "saveSnapshot"; projectId: string; writeId: string; content: string } // X1: declared, never emitted
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] }
  | { type: "startTimer"; timerId: string; ms: number }
  | { type: "cancelTimer"; timerId: string };
```

`packages/editor/src/ports/events.ts`:

```ts
import type { Point, ProjectMeta, ServerMessage } from "@fm/protocol";
import type { Mods, Size, ToolName } from "../types";

// What React panels send; tests send the same (spec §5.2).
export type UiAction =
  | { type: "createProject"; name: string }
  | { type: "openProject"; id: string }
  | { type: "showProjectList" }
  | { type: "pickTool"; tool: ToolName }
  | { type: "setField"; fieldId: string; value: string }
  | { type: "undo" }
  | { type: "redo" };

export type WorkspaceEvent =
  | { type: "projects"; requestId: string; items: ProjectMeta[] }
  | { type: "created"; requestId: string; meta: ProjectMeta }
  | { type: "failed"; requestId: string | null; message: string };

export type ServerEvent =
  | Extract<ServerMessage, { type: "welcome" | "snapshot" | "openFailed" | "changes" | "ack" | "rejected" | "presence" | "presenceLeft" }>
  | { type: "connection"; state: "open" | "closed" };

export type Event =
  | { type: "pointerDown" | "pointerMove" | "pointerUp"; screen: Point; mods: Mods; button: 0 | 1 | 2 }
  | { type: "wheel"; screen: Point; deltaX: number; deltaY: number; mods: Mods }
  | { type: "key"; key: string; mods: Mods } // KeyboardEvent.key, except digits and "." taken from the physical key code (spec §5.4)
  | { type: "ui"; action: UiAction }
  | { type: "timerFired"; timerId: string }
  | { type: "workspaceEvent"; event: WorkspaceEvent }
  | { type: "saveResult"; writeId: string; ok: boolean; error?: string } // X1: ignored
  | { type: "serverEvent"; event: ServerEvent }
  | { type: "viewportResized"; size: Size; devicePixelRatio: number };

export type PointerInput = Extract<Event, { type: "pointerDown" | "pointerMove" | "pointerUp" }>;
```

- [x] **Step 4: Implement the view and document types.** `packages/editor/src/view/scene-types.ts`:

```ts
import type { Point } from "@fm/protocol";

// What to draw, in world coordinates, in ordered layers (spec §5.9).
export type Color = string;
export type Width = { px: number } | { m: number }; // screen-constant hairlines vs. world-scaled
export type Align = "left" | "center" | "right";

export type Primitive =
  | { kind: "segment"; a: Point; b: Point; width: Width; color: Color; cap: "butt" | "round"; dash?: number[] }
  | { kind: "polygon"; points: readonly Point[]; color: Color } // readonly: zone fills pass cached domain rings (revised in phase 2)
  | { kind: "arc"; center: Point; radius: number; from: number; to: number; width: Width; color: Color }
  | { kind: "disc"; center: Point; radius: Width; color: Color }
  | { kind: "text"; text: string; at: Point; size: number; color: Color; align: Align; rotation: number }; // size in px

export type LayerName = "grid" | "zoneFills" | "walls" | "annotations" | "overlays" | "presence";
export type Layer = { name: LayerName; primitives: Primitive[] };
export type Scene = { layers: Layer[] }; // always all six layers, in LAYER_ORDER
```

`packages/editor/src/view/view-model.ts` (types now; `buildViewModel` arrives in Task 3.9):

```ts
import type { Point, ProjectMeta } from "@fm/protocol";
import type { DocumentStatus } from "../document/types";
import type { SnapKind, ToolName } from "../types";

// What the panels show, not how (spec §5.9).
export type Field = { id: string; label: string; value: string; unit: string | null; readOnly: boolean };

export type ViewModel = {
  activeTool: ToolName;
  commandBar: { prompt: string; value: string; unit: "m" | null };
  properties: { kind: "none" } | { kind: "wall" | "joint" | "zone"; fields: Field[] };
  cursor: "default" | "crosshair" | "move" | "pointer";
  snap: { kind: Exclude<SnapKind, "none">; at: Point } | null;
  presence: { clientId: string; name: string; color: string; at: Point | null }[];
  project: { name: string; status: DocumentStatus; dirty: boolean; canEdit: boolean } | null;
  projectList: { items: ProjectMeta[]; loading: boolean; error: string | null } | null; // only when no document is open
  toast: string | null;
  canUndo: boolean;
  canRedo: boolean;
};
```

`packages/editor/src/document/types.ts`:

```ts
import type { Document } from "@fm/domain";
import type { EntityKey, Patch, RejectReason } from "@fm/protocol";
import type { Effect } from "../ports/effects";
import type { ProjectInfo } from "../types";

// Spec §7.0. Tools, gestures, history and the ViewModel react to notices.
export type Notice =
  | { type: "accepted"; id: string }
  | { type: "rejected"; id: string; reason: RejectReason }
  | { type: "remoteChange"; writes: EntityKey[]; topology: boolean }
  | { type: "resynced" }
  | { type: "offline" };

export type CommitInput = { id: string; patch: Patch; dependencies: EntityKey[] };

export type DocumentStatus =
  | "not saved" | "unsaved changes" | "saving" | "saved" | "save failed" | "waiting for server" | "offline";

export type DocStep<D> = { doc: D; effects: Effect[]; notices: Notice[] };

export type LocalDocument = {
  kind: "local";
  project: ProjectInfo;
  openId: string; // fresh per open
  doc: Document; // the truth
  revision: number; // +1 on every commit, undo and redo
  saving: { kind: "none" }; // X1 adds { kind: "file", … }
};

// Phase 7 widens this to LocalDocument | SharedDocument.
export type OpenDocument = LocalDocument;
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/ports.test.ts && pnpm --filter @fm/editor typecheck`
Expected: PASS (3 tests); typecheck exits 0.

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: ports (host, effects, events), scene, view-model and document types"
```

---

### Task 3.4: Snapping policies, chooser and `snapPoint`

Independent policies return candidates; a pure chooser picks the lowest priority, then the smallest distance, within 10 px (spec §5.8). `Shift` constrains to an orthogonal axis through the origin **before** the chooser: the cursor is projected on the axis and only on-axis candidates remain. `Ctrl` bypasses every policy but keeps the `Shift` constraint.

**Files:** Create `packages/editor/src/snapping/policies.ts`, `snapping/chooser.ts`, `snapping/snap.ts`, `packages/editor/test/builders.ts`, `packages/editor/test/snapping.test.ts`.

- [x] **Step 1: Write the test builders** `packages/editor/test/builders.ts`

```ts
import { EPS, distance, emptyDocument, execute, rectangleRoom, unwrap, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";

/** The demo room (spec §1.4 step 2): 6 × 4 m, corners (0,0) (6,0) (6,4) (0,4), drawn counter-clockwise. */
export function roomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 6, 4)) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

/** The demo room with the step 3 divider from (3,0) to (3,4). */
export function dividedRoomDoc(): Document {
  return unwrap(execute(roomDoc(), { type: "addWall", opId: "div", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } })).doc;
}

/** One free-standing wall. */
export function wallDoc(from: Point, to: Point): Document {
  return unwrap(execute(emptyDocument(), { type: "addWall", opId: "w", from: { at: from }, to: { at: to } })).doc;
}

export function jointAt(doc: Document, p: Point): string {
  const found = Object.values(doc.joints).find((j) => distance(j, p) < EPS);
  if (!found) throw new Error(`No joint at (${p.x}, ${p.y})`);
  return found.id;
}

export function wallBetween(doc: Document, p: Point, q: Point): string {
  const a = jointAt(doc, p);
  const b = jointAt(doc, q);
  const found = Object.values(doc.walls).find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  if (!found) throw new Error(`No wall between (${p.x}, ${p.y}) and (${q.x}, ${q.y})`);
  return found.id;
}

export function pointOf(doc: Document, jointId: string): Point {
  const j = doc.joints[jointId];
  if (!j) throw new Error(`No joint ${jointId}`);
  return { x: j.x, y: j.y };
}
```

- [x] **Step 2: Write the failing test** `packages/editor/test/snapping.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument, incidentWalls, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "../src/camera";
import { choose } from "../src/snapping/chooser";
import { roundTo } from "../src/snapping/policies";
import { gridSpacingFor, orthogonalAxis, snapPoint } from "../src/snapping/snap";
import { NO_MODS, type Mods } from "../src/types";
import { jointAt, roomDoc, wallDoc } from "./builders";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };

function snap(doc: Document, cursor: Point, mods: Partial<Mods> = {}, origin: Point | null = null) {
  return snapPoint({ doc, cursor, camera, mods: { ...NO_MODS, ...mods }, origin, tolerancePx: 10 });
}

describe("grid spacing", () => {
  it("picks the smallest step at least 16 px wide", () => {
    expect(gridSpacingFor(80)).toBe(0.2);
    expect(gridSpacingFor(16)).toBe(1);
    expect(gridSpacingFor(1000)).toBe(0.02);
    expect(gridSpacingFor(5)).toBe(5);
    expect(gridSpacingFor(1)).toBe(10);
  });
});

describe("snapPoint (spec §5.8)", () => {
  it("prefers an endpoint to a closer grid point", () => {
    const doc = wallDoc({ x: 0.33, y: 0.33 }, { x: 2.33, y: 0.33 });
    expect(snap(doc, { x: 0.39, y: 0.39 })).toEqual({ point: { x: 0.33, y: 0.33 }, kind: "endpoint" });
  });

  it("prefers an endpoint to a closer midpoint", () => {
    // Endpoint (0,0) is 0.071 m away, the midpoint (0.1,0) 0.032 m; both are within 0.125 m.
    const doc = wallDoc({ x: 0, y: 0 }, { x: 0.2, y: 0 });
    expect(snap(doc, { x: 0.07, y: 0.01 })).toEqual({ point: { x: 0, y: 0 }, kind: "endpoint" });
  });

  it("gives the exact midpoint of a wall", () => {
    expect(snap(roomDoc(), { x: 3.04, y: 0.03 })).toEqual({ point: { x: 3, y: 0 }, kind: "midpoint" });
  });

  it("prefers the nearest point on a wall to the grid", () => {
    const r = snap(roomDoc(), { x: 1.53, y: 0.04 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(1.53, 9);
    expect(r.point.y).toBe(0);
  });

  it("prefers a point on a wall to a closer grid point (priority, not distance)", () => {
    // Grid (1.6, 0.2) is 0.091 m away, the bottom wall's (1.61, 0) is 0.11 m; both are within 0.125 m.
    const r = snap(roomDoc(), { x: 1.61, y: 0.11 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(1.61, 9);
    expect(r.point.y).toBe(0);
  });

  it("returns the raw cursor when nothing is within 10 px", () => {
    // Nearest grid points are 0.141 m away; the tolerance is 10 px / 80 px per m = 0.125 m.
    expect(snap(roomDoc(), { x: 1.5, y: 2.1 })).toEqual({ point: { x: 1.5, y: 2.1 }, kind: "none" });
  });

  it("with Shift, projects on the orthogonal axis and keeps on-axis candidates", () => {
    expect(snap(roomDoc(), { x: 3.1, y: 3.97 }, { shift: true }, { x: 3, y: 0 })).toEqual({
      point: { x: 3, y: 4 },
      kind: "midpoint",
    });
  });

  it("with Shift, drops candidates off the axis", () => {
    // Axis y = 1 from (1,1): the right wall is crossed at (6,1).
    const r = snap(roomDoc(), { x: 5.95, y: 1.1 }, { shift: true }, { x: 1, y: 1 });
    expect(r.kind).toBe("onWall");
    expect(r.point.x).toBeCloseTo(6, 9);
    expect(r.point.y).toBeCloseTo(1, 9);
    // Axis y = 0.05, 5 cm above the bottom wall: the corner (6,0) and the midpoint (3,0) are within
    // tolerance but off-axis, and the parallel bottom wall is never crossed.
    const origin = { x: 1, y: 0.05 };
    expect(snap(roomDoc(), { x: 5.97, y: 0.06 }, { shift: true }, origin)).toEqual({ point: { x: 6, y: 0.05 }, kind: "onWall" });
    expect(snap(roomDoc(), { x: 3.02, y: 0.06 }, { shift: true }, origin)).toEqual({ point: { x: 3, y: 0.05 }, kind: "grid" });
  });

  it("with Shift, ignores an axis crossing past the end of a wall", () => {
    // Axis y = 4.1 meets the right wall's line at (6, 4.1), 10 cm past its end: only the grid is left.
    const r = snap(roomDoc(), { x: 6.02, y: 4.12 }, { shift: true }, { x: 1.1, y: 4.1 });
    expect(r.kind).toBe("grid");
    expect(r.point.x).toBeCloseTo(6.1, 9);
    expect(r.point.y).toBeCloseTo(4.1, 9);
  });

  it("with Shift, keeps the axis constraint when nothing snaps", () => {
    // Zoom 60: grid step 0.5 m, tolerance 10 / 60 = 0.167 m. The axis steps 0 and 0.5 are 0.25 m away.
    const zoomed: Camera = { ...camera, zoom: 60 };
    const r = snapPoint({
      doc: emptyDocument(), cursor: { x: 0.25, y: 0.05 }, camera: zoomed, mods: { ...NO_MODS, shift: true },
      origin: { x: 0, y: 0 }, tolerancePx: 10,
    });
    expect(r).toEqual({ point: { x: 0.25, y: 0 }, kind: "none" });
  });

  it("with Shift, snaps to grid steps measured from the origin", () => {
    // An absolute grid would give x = 1.2; steps from the origin give 0.33 + 4 × 0.2.
    const r = snap(roomDoc(), { x: 1.13, y: 2.3 }, { shift: true }, { x: 0.33, y: 2 });
    expect(r.kind).toBe("grid");
    expect(r.point.x).toBeCloseTo(1.13, 9);
    expect(r.point.y).toBe(2); // the constrained coordinate stays exact
  });

  it("Ctrl bypasses every policy", () => {
    expect(snap(roomDoc(), { x: 3.04, y: 0.03 }, { ctrl: true })).toEqual({ point: { x: 3.04, y: 0.03 }, kind: "none" });
  });

  it("Ctrl keeps the Shift constraint", () => {
    expect(snap(roomDoc(), { x: 2.5, y: 0.3 }, { shift: true, ctrl: true }, { x: 0, y: 0 })).toEqual({
      point: { x: 2.5, y: 0 },
      kind: "none",
    });
  });

  it("ignores excluded joints and walls (the ones being dragged)", () => {
    const doc = roomDoc();
    const j = jointAt(doc, { x: 6, y: 4 });
    const r = snapPoint({
      doc, cursor: { x: 6.02, y: 4.02 }, camera, mods: NO_MODS, origin: null, tolerancePx: 10,
      excludeJoints: new Set([j]), excludeWalls: new Set(incidentWalls(doc, j)),
    });
    expect(r).toEqual({ point: { x: 6, y: 4 }, kind: "grid" });
  });
});

describe("roundTo", () => {
  it("rounds to the step, cleaned of float noise and -0", () => {
    expect(roundTo(5.99, 0.2)).toBe(6);
    expect(roundTo(0.61, 0.2)).toBe(0.6); // 3 × 0.2 is 0.6000000000000001 before cleaning
    expect(Object.is(roundTo(-0.04, 0.2), 0)).toBe(true);
    expect(roundTo(-0.3, 0.2)).toBe(-0.2); // Math.round(-1.5) is -1
    expect(roundTo(0.29, 0.2)).toBe(0.2);
  });
});

describe("choose", () => {
  it("breaks ties by distance, then x, then y", () => {
    const a = { point: { x: 2, y: 0 }, kind: "grid", priority: 4, distance: 0.1 } as const;
    const b = { point: { x: 1, y: 0 }, kind: "grid", priority: 4, distance: 0.1 } as const;
    const c = { ...b, point: { x: 1, y: -1 } };
    const far = { ...b, distance: 0.15 };
    expect(choose([far, a], 0.2)).toBe(a);
    expect(choose([a, b], 0.2)).toBe(b);
    expect(choose([b, c], 0.2)).toBe(c);
    expect(choose([c, b], 0.2)).toBe(c);
    expect(choose([a, b], 0.05)).toBeNull();
  });
});

describe("orthogonalAxis", () => {
  it("follows the dominant direction", () => {
    expect(orthogonalAxis({ x: 0, y: 0 }, { x: -3, y: 1 }).dir).toEqual({ x: -1, y: 0 });
    expect(orthogonalAxis({ x: 0, y: 0 }, { x: 1, y: -3 }).dir).toEqual({ x: 0, y: -1 });
  });
});
```

The Shift-grid case: origin (0.33, 2), cursor (1.13, 2.3); the axis is horizontal, t = 0.8, which is 4 grid steps of 0.2, so the point is (0.33 + 0.8, 2). The sum is not exactly the literal `1.13` in floating point, hence `toBeCloseTo`.

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/snapping.test.ts`
Expected: FAIL, `Cannot find module '../src/snapping/chooser'`.

- [x] **Step 4: Implement** `packages/editor/src/snapping/policies.ts`

```ts
import {
  EPS, cross, distance, distanceToSegment, dot, lineIntersection, projectOnSegment, sortedIds, sub, wallEnds,
  type Document,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { SnapKind } from "../types";

export type SnapCandidate = { point: Point; kind: Exclude<SnapKind, "none">; priority: 1 | 2 | 3 | 4; distance: number };
export type SnapAxis = { origin: Point; dir: Point }; // dir is (±1, 0) or (0, ±1)
export type SnapContext = {
  doc: Document;
  cursor: Point; // already projected on the axis when there is one
  gridSpacing: number; // metres
  axis: SnapAxis | null;
  excludeJoints: ReadonlySet<string>;
  excludeWalls: ReadonlySet<string>;
};
export type SnapPolicy = (ctx: SnapContext) => SnapCandidate[];

export function onAxis(axis: SnapAxis, p: Point): boolean {
  return Math.abs(cross(sub(p, axis.origin), axis.dir)) < EPS;
}

/** Rounds to the nearest multiple of `step`, cleaned to 1e-6 m so 3 × 0.2 is exactly 0.6. */
export function roundTo(v: number, step: number): number {
  const r = Math.round((Math.round(v / step) * step) * 1e6) / 1e6;
  return r === 0 ? 0 : r; // no -0
}

const PRIORITY: Record<SnapCandidate["kind"], SnapCandidate["priority"]> = { endpoint: 1, midpoint: 2, onWall: 3, grid: 4 };

function candidate(ctx: SnapContext, point: Point, kind: SnapCandidate["kind"]): SnapCandidate {
  return { point, kind, priority: PRIORITY[kind], distance: distance(point, ctx.cursor) };
}

function liveWalls(ctx: SnapContext): { a: Point; b: Point }[] {
  const out: { a: Point; b: Point }[] = [];
  for (const id of sortedIds(ctx.doc.walls)) {
    if (ctx.excludeWalls.has(id)) continue;
    const ends = wallEnds(ctx.doc, id);
    if (ends) out.push(ends);
  }
  return out;
}

export const endpointPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const id of sortedIds(ctx.doc.joints)) {
    const j = ctx.doc.joints[id];
    if (!j || ctx.excludeJoints.has(id)) continue;
    const p = { x: j.x, y: j.y };
    if (ctx.axis && !onAxis(ctx.axis, p)) continue;
    out.push(candidate(ctx, p, "endpoint"));
  }
  return out;
};

export const midpointPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const { a, b } of liveWalls(ctx)) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (ctx.axis && !onAxis(ctx.axis, mid)) continue;
    out.push(candidate(ctx, mid, "midpoint"));
  }
  return out;
};

export const onWallPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const { a, b } of liveWalls(ctx)) {
    if (!ctx.axis) {
      out.push(candidate(ctx, projectOnSegment(ctx.cursor, a, b).point, "onWall"));
      continue;
    }
    // With Shift: where the axis crosses the wall centreline (parallel walls give no point).
    const hit = lineIntersection(ctx.axis.origin, ctx.axis.dir, a, sub(b, a));
    if (hit && distanceToSegment(hit, a, b) < EPS) out.push(candidate(ctx, hit, "onWall"));
  }
  return out;
};

export const gridPolicy: SnapPolicy = (ctx) => {
  const s = ctx.gridSpacing;
  if (!ctx.axis) return [candidate(ctx, { x: roundTo(ctx.cursor.x, s), y: roundTo(ctx.cursor.y, s) }, "grid")];
  // With Shift: whole grid steps along the axis, measured from the origin.
  const k = roundTo(dot(sub(ctx.cursor, ctx.axis.origin), ctx.axis.dir), s);
  const p = { x: ctx.axis.origin.x + ctx.axis.dir.x * k, y: ctx.axis.origin.y + ctx.axis.dir.y * k };
  return [candidate(ctx, p, "grid")];
};

export const POLICIES: readonly SnapPolicy[] = [endpointPolicy, midpointPolicy, onWallPolicy, gridPolicy];
```

`packages/editor/src/snapping/chooser.ts`:

```ts
import type { SnapCandidate } from "./policies";

/** Within tolerance: lowest priority, then smallest distance, then x, then y (deterministic). */
export function choose(cands: SnapCandidate[], tolerance: number): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  for (const c of cands) {
    if (c.distance > tolerance) continue;
    if (!best || better(c, best)) best = c;
  }
  return best;
}

function better(a: SnapCandidate, b: SnapCandidate): boolean {
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.distance !== b.distance) return a.distance < b.distance;
  if (a.point.x !== b.point.x) return a.point.x < b.point.x;
  return a.point.y < b.point.y;
}
```

`packages/editor/src/snapping/snap.ts`:

```ts
import { add, dot, scale, sub, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Mods, SnapResult } from "../types";
import { choose } from "./chooser";
import { POLICIES, type SnapAxis, type SnapContext } from "./policies";

const GRID_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
const NOTHING: ReadonlySet<string> = new Set();

/** Smallest grid step that is at least 16 px wide at this zoom. */
export function gridSpacingFor(zoom: number): number {
  for (const s of GRID_STEPS) if (s * zoom >= 16) return s;
  return 10;
}

export function orthogonalAxis(origin: Point, cursor: Point): SnapAxis {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { origin, dir: { x: dx < 0 ? -1 : 1, y: 0 } };
  return { origin, dir: { x: 0, y: dy < 0 ? -1 : 1 } };
}

export function projectOnAxis(axis: SnapAxis, p: Point): Point {
  return add(axis.origin, scale(axis.dir, dot(sub(p, axis.origin), axis.dir)));
}

export function snapPoint(input: {
  doc: Document;
  cursor: Point;
  camera: Camera;
  mods: Mods;
  origin: Point | null;
  tolerancePx: number;
  excludeJoints?: ReadonlySet<string>;
  excludeWalls?: ReadonlySet<string>;
}): SnapResult {
  const axis = input.mods.shift && input.origin ? orthogonalAxis(input.origin, input.cursor) : null;
  const cursor = axis ? projectOnAxis(axis, input.cursor) : input.cursor;
  if (input.mods.ctrl) return { point: cursor, kind: "none" };
  const tolerance = input.tolerancePx / input.camera.zoom;
  const ctx: SnapContext = {
    doc: input.doc,
    cursor,
    gridSpacing: gridSpacingFor(input.camera.zoom),
    axis,
    excludeJoints: input.excludeJoints ?? NOTHING,
    excludeWalls: input.excludeWalls ?? NOTHING,
  };
  const best = choose(POLICIES.flatMap((policy) => policy(ctx)), tolerance);
  return best ? { point: best.point, kind: best.kind } : { point: cursor, kind: "none" };
}
```

`projectOnAxis` keeps the constrained coordinate exact: for a horizontal axis, `scale(dir, t).y` is `0` and `origin.y + 0` is `origin.y`.

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/snapping.test.ts`
Expected: PASS (18 tests). If "prefers the nearest point on a wall" fails on `y`, check that `projectOnSegment` returns `y: 0` for a horizontal wall; if it returns `-0`, `toBe(0)` fails. In that case normalise `-0` in the policy (`p.y === 0 ? 0 : p.y`) and log it in the sprint log.

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: snapping policies, pure chooser, Shift axis and Ctrl bypass"
```

---

### Task 3.5: Local document and the open-document switch

`LocalDocument` accepts every commit at once and emits `accepted` in the same step (spec §7.0). `open-document.ts` is the only module that switches on `kind`; phase 7 adds the `shared` cases there.

**Files:** Create `packages/editor/src/document/local-document.ts`, `document/open-document.ts`, `packages/editor/test/fake-shell.ts` (the `FakeHost` part), `packages/editor/test/document.test.ts`.

- [x] **Step 1: Write `FakeHost`** in `packages/editor/test/fake-shell.ts` (Task 3.10 adds `FakeShell` to the same file):

```ts
import type { FontSpec, Host } from "../src/ports/host";

/** Deterministic host: ids "id1", "id2", …; a manual clock; text 0.6 × size wide per character. */
export class FakeHost implements Host {
  time = 0;
  private next = 0;

  now(): number {
    return this.time;
  }

  newId(): string {
    this.next += 1;
    return `id${this.next}`;
  }

  textMetrics(text: string, font: FontSpec): { width: number; ascent: number; descent: number } {
    return { width: 0.6 * font.size * text.length, ascent: 0.8 * font.size, descent: 0.2 * font.size };
  }

  advance(ms: number): void {
    this.time += ms;
  }
}
```

- [x] **Step 2: Write the failing test** `packages/editor/test/document.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap } from "@fm/domain";
import { createLocalDocument } from "../src/document/local-document";
import { canCommit, commit, isDirty, onEvent, status, visibleDoc } from "../src/document/open-document";
import { FakeHost } from "./fake-shell";

const project = { id: "local", name: "Untitled" };
const addWall = unwrap(
  execute(emptyDocument(), { type: "addWall", opId: "w", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } }),
);

describe("LocalDocument (spec §7.0)", () => {
  it("starts clean and editable", () => {
    const d = createLocalDocument(project, "open1");
    expect(d.revision).toBe(0);
    expect(visibleDoc(d)).toEqual(emptyDocument());
    expect(status(d)).toBe("not saved");
    expect(isDirty(d)).toBe(false);
    expect(canCommit(d)).toBe(true);
  });

  it("accepts a commit in the same step, with no save effect", () => {
    const d = createLocalDocument(project, "open1");
    const step = commit(d, { id: "c1", patch: addWall.patch, dependencies: addWall.patch.dependencies });
    expect(step.notices).toEqual([{ type: "accepted", id: "c1" }]);
    expect(step.effects).toEqual([]);
    expect(step.doc.kind === "local" && step.doc.revision).toBe(1); // stays valid when phase 7 widens OpenDocument
    expect(visibleDoc(step.doc)).toEqual(addWall.doc);
    expect(isDirty(step.doc)).toBe(true);
  });

  it("throws when a patch fails to apply (callers validate first)", () => {
    const d = createLocalDocument(project, "open1");
    const bad = { puts: [{ table: "joints" as const, entity: { id: "j", x: "a", y: 0 } }], deletes: [] };
    expect(() => commit(d, { id: "c1", patch: bad, dependencies: [] })).toThrow("Local commit c1 failed");
  });

  it("can start from an existing document", () => {
    expect(visibleDoc(createLocalDocument(project, "open1", addWall.doc))).toBe(addWall.doc);
  });

  it("ignores server events", () => {
    const d = createLocalDocument(project, "open1");
    const step = onEvent(d, { type: "connection", state: "open" }, new FakeHost());
    expect(step.doc).toBe(d);
    expect(step.effects).toEqual([]);
    expect(step.notices).toEqual([]);
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/document.test.ts`
Expected: FAIL, `Cannot find module '../src/document/local-document'`.

- [x] **Step 4: Implement** `packages/editor/src/document/local-document.ts`

```ts
import { applyPatch, emptyDocument, type Document } from "@fm/domain";
import type { ProjectInfo } from "../types";
import type { CommitInput, DocStep, LocalDocument } from "./types";

export function createLocalDocument(project: ProjectInfo, openId: string, doc: Document = emptyDocument()): LocalDocument {
  return { kind: "local", project, openId, doc, revision: 0, saving: { kind: "none" } };
}

/**
 * Accepted at once and never rejected: callers validate every patch first (execute for commands,
 * runHistory's tentative check for undo and redo) and nobody else writes to a local document
 * (spec §7.0). A patch that fails to apply is a programming error.
 */
export function localCommit(d: LocalDocument, input: CommitInput): DocStep<LocalDocument> {
  const next = applyPatch(d.doc, input.patch);
  if (!next.ok) throw new Error(`Local commit ${input.id} failed: ${next.error.message}`);
  return {
    doc: { ...d, doc: next.value, revision: d.revision + 1 },
    effects: [],
    notices: [{ type: "accepted", id: input.id }],
  };
}
```

`packages/editor/src/document/open-document.ts`:

```ts
import type { Document } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { ServerEvent } from "../ports/events";
import type { Host } from "../ports/host";
import { localCommit } from "./local-document";
import type { CommitInput, DocStep, DocumentStatus, OpenDocument } from "./types";

// The only module that switches on document kind (spec §7.0). Phase 7 adds the "shared" cases.

export function visibleDoc(d: OpenDocument): Document {
  switch (d.kind) {
    case "local":
      return d.doc;
    default:
      return assertNever(d.kind);
  }
}

export function canCommit(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return true;
    default:
      return assertNever(d.kind);
  }
}

/** Callers check canCommit first; committing while blocked is a programming error. */
export function commit(d: OpenDocument, input: CommitInput): DocStep<OpenDocument> {
  if (!canCommit(d)) throw new Error("commit while the document cannot accept edits");
  switch (d.kind) {
    case "local":
      return localCommit(d, input);
    default:
      return assertNever(d.kind);
  }
}

export function onEvent(d: OpenDocument, _event: ServerEvent, _host: Host): DocStep<OpenDocument> {
  switch (d.kind) {
    case "local":
      return { doc: d, effects: [], notices: [] }; // a local document never talks to the server
    default:
      return assertNever(d.kind);
  }
}

export function status(d: OpenDocument): DocumentStatus {
  switch (d.kind) {
    case "local":
      return "not saved"; // saving: none; X1 adds the file statuses
    default:
      return assertNever(d.kind);
  }
}

export function isDirty(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return d.revision > 0;
    default:
      return assertNever(d.kind);
  }
}
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/document.test.ts`
Expected: PASS (5 tests).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: LocalDocument accepts at once; open-document is the only kind switch"
```

---

### Task 3.6: History (value-based, one code path for both kinds)

A local document runs the shared-document history as a plain stack: each entry is recorded `pending` and becomes `usable` on the `accepted` notice that the local document emits in the same step (spec §7.0, §7.5).

**Files:** Create `packages/editor/src/history/history.ts`, `packages/editor/test/history.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/history.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { applyPatch, execute, unwrap, type Document } from "@fm/domain";
import { patchWrites, type EntityKey, type Point } from "@fm/protocol";
import {
  REMOTE_REDO, REMOTE_UNDO, applyHistoryNotice, canRedo, canUndo, emptyHistory, entryDependencies, prepareRedo, prepareUndo,
  recordCommit, startRequest, type HistoryState,
} from "../src/history/history";
import { jointAt, roomDoc } from "./builders";

const doc0 = roomDoc();
const corner = jointAt(doc0, { x: 6, y: 4 });
const origin = jointAt(doc0, { x: 0, y: 0 });

function move(doc: Document, jointId: string, to: Point) {
  return unwrap(execute(doc, { type: "moveJoints", moves: [{ jointId, to }] }));
}

const m1 = move(doc0, corner, { x: 6, y: 4.6 });
const accepted = (h: HistoryState, id: string) => applyHistoryNotice(h, { type: "accepted", id });

describe("history", () => {
  it("records a pending entry and clears redo", () => {
    const withRedo: HistoryState = { ...emptyHistory, future: [{ id: "old", patch: m1.patch, dependencies: [], status: "usable" }] };
    const h = recordCommit(withRedo, "c1", m1.patch);
    expect(h.past.map((e) => [e.id, e.status])).toEqual([["c1", "pending"]]);
    expect(h.future).toEqual([]);
    expect(canUndo(h)).toBe(false);
  });

  it("makes the entry usable on acceptance", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    expect(h.past[0]?.status).toBe("usable");
    expect(canUndo(h)).toBe(true);
  });

  it("prepares the inverse patch with the entry's dependencies", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const r = unwrap(prepareUndo(h, m1.doc));
    expect(unwrap(applyPatch(m1.doc, r.patch))).toEqual(doc0);
    expect(r.dependencies).toContainEqual({ table: "joints", id: corner });
  });

  it("refuses to undo when the written values changed", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const moved = move(m1.doc, corner, { x: 6, y: 5 }).doc;
    expect(prepareUndo(h, moved)).toEqual({ ok: false, error: REMOTE_UNDO });
  });

  it("moves the entry to redo only when the undo request is accepted", () => {
    const h1 = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const h2 = startRequest(h1, { direction: "undo", id: "u1" });
    expect([h2.past.map((e) => e.id), h2.future]).toEqual([["c1"], []]); // stays on its stack until acceptance (§7.5 step 4)
    expect(canUndo(h2)).toBe(false);
    expect(prepareUndo(h2, m1.doc).ok).toBe(false);
    const h3 = accepted(h2, "u1");
    expect(h3.past).toEqual([]);
    expect(h3.future.map((e) => e.id)).toEqual(["c1"]);
    expect(canRedo(h3)).toBe(true);
    const redo = unwrap(prepareRedo(h3, doc0));
    expect(redo.patch).toEqual({ puts: m1.patch.puts, deletes: m1.patch.deletes }); // no `before`/`dependencies` committed
    expect(redo.dependencies).toEqual(entryDependencies(m1.patch));
    expect(unwrap(applyPatch(doc0, redo.patch))).toEqual(m1.doc);
    expect(prepareRedo(h3, move(doc0, corner, { x: 6, y: 5 }).doc)).toEqual({ ok: false, error: REMOTE_REDO });
  });

  it("moves the entry back to undo only when the redo request is accepted, and discards it on rejection", () => {
    const undone = accepted(startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" }), "u1");
    const redoing = startRequest(undone, { direction: "redo", id: "r1" });
    expect([redoing.past, redoing.future.map((e) => e.id)]).toEqual([[], ["c1"]]);
    const redone = accepted(redoing, "r1");
    expect([redone.past.map((e) => [e.id, e.status]), redone.future, redone.pending]).toEqual([[["c1", "usable"]], [], null]);
    expect(canUndo(redone)).toBe(true);
    const reason = { kind: "conflict" as const, entities: [] };
    expect(applyHistoryNotice(redoing, { type: "rejected", id: "r1", reason })).toEqual({ past: [], future: [], pending: null });
  });

  it("waits for the server before undoing an unconfirmed edit", () => {
    expect(prepareUndo(recordCommit(emptyHistory, "c1", m1.patch), m1.doc)).toEqual({ ok: false, error: "Waiting for server" });
  });

  it("refuses redo while a request is pending or once the entry is invalid", () => {
    const undone = accepted(startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" }), "u1");
    expect(canRedo(undone)).toBe(true);
    const busy = startRequest(undone, { direction: "redo", id: "r1" });
    expect(canRedo(busy)).toBe(false);
    expect(prepareRedo(busy, doc0).ok).toBe(false);
    const invalid = applyHistoryNotice(undone, { type: "remoteChange", writes: [], topology: true });
    expect(canRedo(invalid)).toBe(false);
  });

  it("invalidates an entry when a remote change writes an entity the edit only read", () => {
    const add = unwrap(execute(doc0, { type: "addWall", opId: "w", from: { existing: corner }, to: { at: { x: 9, y: 4 } } }));
    const cornerKey: EntityKey = { table: "joints", id: corner };
    expect(add.patch.dependencies).toContainEqual(cornerKey);
    expect(patchWrites(add.patch)).not.toContainEqual(cornerKey); // only the semantic dependency links the entry to the corner
    const h = accepted(recordCommit(emptyHistory, "a1", add.patch), "a1");
    const after = applyHistoryNotice(h, { type: "remoteChange", writes: [cornerKey], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("refuses to record a commit while a history request is pending", () => {
    const requested = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const m2 = move(m1.doc, origin, { x: -0.4, y: 0 });
    expect(() => recordCommit(requested, "c2", m2.patch)).toThrow("commit while a history request is pending");
  });

  it("checks absence on undo and depends on the entities an edit created", () => {
    const add = unwrap(execute(doc0, { type: "addWall", opId: "w", from: { at: { x: 10, y: 0 } }, to: { at: { x: 12, y: 0 } } }));
    const wall = Object.keys(add.doc.walls).find((id) => !(id in doc0.walls)) ?? "";
    const del = unwrap(execute(add.doc, { type: "deleteEntities", ids: [{ table: "walls", id: wall }] }));
    const h = accepted(recordCommit(emptyHistory, "d1", del.patch), "d1");
    expect(prepareUndo(h, del.doc).ok).toBe(true);
    expect(prepareUndo(h, add.doc)).toEqual({ ok: false, error: REMOTE_UNDO });
    const created = accepted(recordCommit(emptyHistory, "a1", add.patch), "a1");
    const after = applyHistoryNotice(created, { type: "remoteChange", writes: [{ table: "walls", id: wall }], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("invalidates redo entries too, and acceptance never revalidates an entry", () => {
    const h = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const undone = applyHistoryNotice(accepted(h, "u1"), { type: "remoteChange", writes: [{ table: "joints", id: corner }], topology: false });
    expect(undone.future.map((e) => e.status)).toEqual(["invalid"]);
    expect(prepareRedo(undone, doc0)).toEqual({ ok: false, error: REMOTE_REDO });
    const invalidPending = applyHistoryNotice(recordCommit(emptyHistory, "c1", m1.patch), { type: "remoteChange", writes: [], topology: true });
    expect(accepted(invalidPending, "c1").past.map((e) => e.status)).toEqual(["invalid"]);
  });

  it("removes a rejected edit and discards a rejected history request", () => {
    const reason = { kind: "conflict" as const, entities: [] }; // not `as const` on the object: a readonly [] is not an EntityKey[]
    const pending = recordCommit(emptyHistory, "c1", m1.patch);
    expect(applyHistoryNotice(pending, { type: "rejected", id: "c1", reason }).past).toEqual([]);
    const requested = startRequest(accepted(pending, "c1"), { direction: "undo", id: "u1" });
    const after = applyHistoryNotice(requested, { type: "rejected", id: "u1", reason });
    expect(after).toEqual({ past: [], future: [], pending: null });
  });

  it("keeps a usable entry when a stray rejection names it", () => {
    const reason = { kind: "conflict" as const, entities: [] };
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    expect(applyHistoryNotice(h, { type: "rejected", id: "c1", reason })).toEqual(h);
    // The usual conflict: a remote write invalidates the unconfirmed edit, then the server rejects it.
    const invalidated = applyHistoryNotice(recordCommit(h, "c2", m1.patch), { type: "remoteChange", writes: [], topology: true });
    expect(applyHistoryNotice(invalidated, { type: "rejected", id: "c2", reason }).past.map((e) => e.id)).toEqual(["c1"]);
  });

  it("invalidates only entries whose dependencies overlap a remote write", () => {
    const m2 = move(m1.doc, origin, { x: -0.4, y: 0 });
    let h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    h = accepted(recordCommit(h, "c2", m2.patch), "c2");
    const after = applyHistoryNotice(h, { type: "remoteChange", writes: [{ table: "joints", id: corner }], topology: false });
    expect(after.past.map((e) => e.status)).toEqual(["invalid", "usable"]);
  });

  it("invalidates everything on a remote topology change and clears on resync", () => {
    const h = accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1");
    const topo = applyHistoryNotice(h, { type: "remoteChange", writes: [], topology: true });
    expect(topo.past.map((e) => e.status)).toEqual(["invalid"]);
    expect(prepareUndo(topo, m1.doc)).toEqual({ ok: false, error: REMOTE_UNDO });
    expect(applyHistoryNotice(h, { type: "resynced" })).toEqual(emptyHistory);
    expect(applyHistoryNotice(h, { type: "offline" })).toBe(h);
  });

  it("drops an undone entry that was invalidated while its request was pending", () => {
    const h = startRequest(accepted(recordCommit(emptyHistory, "c1", m1.patch), "c1"), { direction: "undo", id: "u1" });
    const invalidated = applyHistoryNotice(h, { type: "remoteChange", writes: [], topology: true });
    expect(accepted(invalidated, "u1")).toEqual({ past: [], future: [], pending: null });
  });

  it("explains an empty stack", () => {
    expect(prepareUndo(emptyHistory, doc0)).toEqual({ ok: false, error: "Nothing to undo" });
    expect(prepareRedo(emptyHistory, doc0)).toEqual({ ok: false, error: "Nothing to redo" });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/history.test.ts`
Expected: FAIL, `Cannot find module '../src/history/history'`.

- [x] **Step 3: Implement** `packages/editor/src/history/history.ts`

```ts
import { entityValue, invertPatch, type Document, type DomainPatch } from "@fm/domain";
import {
  assertNever, deepEqual, err, keyOf, ok, patchWrites, uniqueKeys, type EntityKey, type Patch, type Result,
} from "@fm/protocol";
import type { CommitInput, Notice } from "../document/types";

// Spec §7.5; a LocalDocument runs the same code as a plain stack (§7.0).
export type UndoEntry = {
  id: string;
  patch: DomainPatch;
  dependencies: EntityKey[]; // writes + semantic dependencies (entryDependencies); patch.dependencies holds only the semantic ones
  status: "pending" | "usable" | "invalid";
};
export type UndoRequest = { direction: "undo" | "redo"; id: string }; // id = commit ID of the history request
export type HistoryState = {
  past: UndoEntry[];
  future: UndoEntry[];
  pending: UndoRequest | null; // the undo/redo request in flight, not an unconfirmed edit (status "pending")
};
export type CommitInputWithoutId = Omit<CommitInput, "id">;

export const emptyHistory: HistoryState = { past: [], future: [], pending: null };
export const REMOTE_UNDO = "Can't undo: the drawing changed remotely";
export const REMOTE_REDO = "Can't redo: the drawing changed remotely";

/** The value part of a patch, without `before` and `dependencies` (what gets committed). */
export function patchOnly(p: Patch): Patch {
  return { puts: p.puts, deletes: p.deletes };
}

/** Writes plus semantic dependencies; the writes include entities the edit created (inverse dependencies). */
export function entryDependencies(p: DomainPatch): EntityKey[] {
  return uniqueKeys([...patchWrites(p), ...p.dependencies]);
}

/** Commits are blocked while a history request is pending (spec §7.5 step 4); recording one is a programming error. */
export function recordCommit(h: HistoryState, id: string, patch: DomainPatch): HistoryState {
  if (h.pending) throw new Error("commit while a history request is pending");
  const entry: UndoEntry = { id, patch, dependencies: entryDependencies(patch), status: "pending" };
  return { ...h, past: [...h.past, entry], future: [] };
}

export function isPendingEntry(h: HistoryState, id: string): boolean {
  return h.past.some((e) => e.id === id && e.status === "pending");
}

export function startRequest(h: HistoryState, req: UndoRequest): HistoryState {
  return { ...h, pending: req };
}

export function canUndo(h: HistoryState): boolean {
  return h.pending === null && h.past[h.past.length - 1]?.status === "usable";
}

export function canRedo(h: HistoryState): boolean {
  return h.pending === null && h.future[h.future.length - 1]?.status === "usable";
}

export function prepareUndo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string> {
  if (h.pending) return err("Waiting for the previous undo");
  const entry = h.past[h.past.length - 1];
  if (!entry) return err("Nothing to undo");
  if (entry.status === "pending") return err("Waiting for server");
  if (entry.status === "invalid" || !matchesAfter(doc, entry.patch)) return err(REMOTE_UNDO);
  return ok({ patch: invertPatch(entry.patch), dependencies: entry.dependencies });
}

export function prepareRedo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string> {
  if (h.pending) return err("Waiting for the previous undo");
  const entry = h.future[h.future.length - 1];
  if (!entry) return err("Nothing to redo");
  if (entry.status === "invalid" || !matchesBefore(doc, entry.patch)) return err(REMOTE_REDO);
  return ok({ patch: patchOnly(entry.patch), dependencies: entry.dependencies });
}

export function applyHistoryNotice(h: HistoryState, n: Notice): HistoryState {
  switch (n.type) {
    case "accepted":
      return h.pending?.id === n.id ? settleRequest(h, true) : markUsable(h, n.id);
    case "rejected":
      return h.pending?.id === n.id ? settleRequest(h, false) : removeUnconfirmed(h, n.id);
    case "remoteChange":
      return invalidate(h, n.writes, n.topology);
    case "resynced":
      return emptyHistory;
    case "offline":
      return h;
    default:
      return assertNever(n);
  }
}

// Undo checks after-values, redo checks before-values, including absence (spec §7.5 step 2).
function matchesAfter(doc: Document, p: Patch): boolean {
  return (
    p.puts.every((put) => deepEqual(entityValue(doc, { table: put.table, id: put.entity.id }), put.entity)) &&
    p.deletes.every((key) => entityValue(doc, key) === null)
  );
}

function matchesBefore(doc: Document, p: DomainPatch): boolean {
  return p.before.every((b) => deepEqual(entityValue(doc, { table: b.table, id: b.id }), b.value));
}

function markUsable(h: HistoryState, id: string): HistoryState {
  return {
    ...h,
    past: h.past.map((e): UndoEntry => (e.id === id && e.status === "pending" ? { ...e, status: "usable" } : e)),
  };
}

/**
 * A rejected ordinary edit removes its entry, also when a remote change invalidated it while pending
 * (the usual conflict). A usable entry was accepted, so a rejection naming it is stray and is ignored.
 */
function removeUnconfirmed(h: HistoryState, id: string): HistoryState {
  return { ...h, past: h.past.filter((e) => !(e.id === id && e.status !== "usable")) };
}

/** Accepted: move the entry to the other stack unless it was invalidated meanwhile. Rejected: discard it. */
function settleRequest(h: HistoryState, accepted: boolean): HistoryState {
  const req = h.pending;
  if (!req) return h;
  const from = req.direction === "undo" ? h.past : h.future;
  const entry = from[from.length - 1];
  const rest = from.slice(0, -1);
  const moved = accepted && entry && entry.status !== "invalid" ? [entry] : [];
  return req.direction === "undo"
    ? { past: rest, future: [...h.future, ...moved], pending: null }
    : { past: [...h.past, ...moved], future: rest, pending: null };
}

/** By write overlap, never by value; any remote topology change invalidates everything (spec §7.5). */
function invalidate(h: HistoryState, writes: EntityKey[], topology: boolean): HistoryState {
  const written = new Set(writes.map(keyOf));
  const mark = (e: UndoEntry): UndoEntry =>
    topology || e.dependencies.some((k) => written.has(keyOf(k))) ? { ...e, status: "invalid" } : e;
  return { ...h, past: h.past.map(mark), future: h.future.map(mark) };
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/history.test.ts`
Expected: PASS (18 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: value-based history with pending entries, requests and invalidation"
```

---

### Task 3.7: Editor state, tool states, toasts, colours and fonts

**Files:** Create `packages/editor/src/tools/types.ts`, `src/state.ts`, `src/toast.ts`, `src/view/colors.ts`, `src/view/fonts.ts`, `packages/editor/test/state.test.ts`. Modify `packages/editor/test/builders.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/state.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { execute, unwrap, type EntityRef } from "@fm/domain";
import { emptyHistory } from "../src/history/history";
import { DEFAULT_ME_COLOR, initialState, pruneSelection, switchTool, type EditorState } from "../src/state";
import { TOAST_TIMER, onToastTimer, showToast } from "../src/toast";
import { draggedJoints, type WallPreview } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { jointAt, localState, roomDoc, serverState, wallBetween } from "./builders";
import { FakeHost } from "./fake-shell";

const me = { clientId: "tab1", name: "Alice" };
const viewport = { width: 1200, height: 800 };

describe("initialState", () => {
  it("opens an unsaved local drawing in local mode", () => {
    const s = initialState({ mode: "local", me, viewport, dpr: 1 }, new FakeHost());
    expect(s.mode).toBe("local");
    expect(s.document?.kind).toBe("local");
    expect(s.document?.project).toEqual({ id: "local", name: "Untitled" });
    expect(s.document?.openId).toBe("id1"); // the FakeHost's first ID
    expect(s.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(s.camera).toEqual({ center: { x: 3, y: 2 }, zoom: 80, viewport, dpr: 1 });
    expect(s.snapSettings).toEqual({ tolerancePx: 10 });
    expect(s.selection).toEqual([]);
    expect(s.hover).toBeNull();
    expect(s.pointer).toBeNull();
    expect(s.panDrag).toBeNull();
    expect(s.snap).toBeNull();
    expect(s.undo).toEqual(emptyHistory);
    expect(s.presence).toEqual({});
    expect(s.toast).toBeNull();
    expect(s.workspace).toEqual({ projects: [], loading: false, error: null, opening: null });
    expect(s.me).toEqual({ clientId: "tab1", name: "Alice", color: DEFAULT_ME_COLOR });
  });

  it("starts on the project list in server mode", () => {
    const host = new FakeHost();
    const s = initialState({ mode: "server", me, viewport, dpr: 2 }, host);
    expect(host.newId()).toBe("id1"); // no drawing, so no open ID taken
    expect(s.mode).toBe("server");
    expect(s.document).toBeNull();
    expect(s.camera.dpr).toBe(2);
    expect(s.workspace).toEqual({ projects: [], loading: true, error: null, opening: null });
  });
});

describe("switchTool", () => {
  it("resets the tool, snap and hover but keeps the selection", () => {
    const doc = roomDoc();
    const corner: EntityRef = { table: "joints", id: jointAt(doc, { x: 6, y: 4 }) };
    const s: EditorState = {
      ...localState(new FakeHost(), doc),
      selection: [corner],
      hover: corner,
      snap: { point: { x: 0, y: 0 }, kind: "grid" },
    };
    const next = switchTool(s, "wall");
    expect(next.tool).toEqual({ name: "wall", state: { kind: "idle" } });
    expect(next.snap).toBeNull();
    expect(next.hover).toBeNull();
    expect(next.selection).toEqual(s.selection);
    expect(switchTool(s, "zone").tool).toEqual({ name: "zone", state: { kind: "idle", hoverFaceKey: null } });
  });

  it("resets the gesture when switching to the tool that is already active", () => {
    const s: EditorState = {
      ...localState(new FakeHost()),
      tool: { name: "wall", state: { kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "", preview: null } },
    };
    expect(switchTool(s, "wall").tool).toEqual({ name: "wall", state: { kind: "idle" } });
  });
});

describe("pruneSelection", () => {
  it("drops entities that no longer exist", () => {
    const doc = roomDoc();
    const corner: EntityRef = { table: "joints", id: jointAt(doc, { x: 6, y: 4 }) };
    const missing: EntityRef = { table: "walls", id: "missing" };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [corner, missing], hover: missing };
    const pruned = pruneSelection(s);
    expect(pruned.selection).toEqual([corner]);
    expect(pruned.hover).toBeNull();
    const valid: EditorState = { ...s, selection: [corner], hover: corner };
    expect(pruneSelection(valid)).toBe(valid);
    const noDrawing = pruneSelection({ ...serverState(new FakeHost()), selection: [corner], hover: corner });
    expect(noDrawing.selection).toEqual([]);
    expect(noDrawing.hover).toBeNull();
  });

  it("keeps an existing wall and drops a missing joint", () => {
    const doc = roomDoc();
    const wall: EntityRef = { table: "walls", id: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }) };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [wall, { table: "joints", id: "missing" }] };
    expect(pruneSelection(s).selection).toEqual([wall]);
  });

  it("clears a missing hover even when the selection is unchanged", () => {
    const s: EditorState = { ...localState(new FakeHost(), roomDoc()), selection: [], hover: { table: "walls", id: "missing" } };
    expect(pruneSelection(s).hover).toBeNull();
  });

  it("keeps existing zone labels and drops missing ones", () => {
    const doc = unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room" })).doc;
    const label: EntityRef = { table: "zoneLabels", id: "L1" };
    const s: EditorState = { ...localState(new FakeHost(), doc), selection: [label, { table: "zoneLabels", id: "missing" }] };
    expect(pruneSelection(s).selection).toEqual([label]);
  });

  it("drops IDs that name Object.prototype members", () => {
    const s: EditorState = {
      ...localState(new FakeHost(), roomDoc()),
      selection: [{ table: "walls", id: "constructor" }],
      hover: { table: "joints", id: "__proto__" },
    };
    const pruned = pruneSelection(s);
    expect(pruned.selection).toEqual([]);
    expect(pruned.hover).toBeNull();
  });
});

describe("draggedJoints", () => {
  it("moves the joint itself, both ends of a wall, and nothing for an unknown or prototype-member wall ID", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    expect(draggedJoints(doc, { kind: "joint", jointId: corner })).toEqual([corner]);
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const ends = [jointAt(doc, { x: 0, y: 0 }), jointAt(doc, { x: 6, y: 0 })].sort();
    expect(draggedJoints(doc, { kind: "wall", wallId: wall }).sort()).toEqual(ends);
    expect(draggedJoints(doc, { kind: "wall", wallId: "missing" })).toEqual([]);
    expect(draggedJoints(doc, { kind: "wall", wallId: "constructor" })).toEqual([]);
  });
});

describe("localState builder", () => {
  it("leaves the host's ID sequence untouched", () => {
    const host = new FakeHost();
    localState(host);
    expect(host.newId()).toBe("id1");
  });
});

describe("tool state types", () => {
  it("rules out a successful preview without its document", () => {
    const p = { x: 0, y: 0 };
    // @ts-expect-error a successful preview needs its document
    const bad: WallPreview = { from: p, to: p, ok: true };
    const good: WallPreview = { from: p, to: p, ok: false };
    expect([bad.ok, good.ok]).toEqual([true, false]);
  });
});

describe("colours", () => {
  it("keeps the helper colour distinct from the selection blue", () => {
    expect(COLORS.helper).not.toBe(COLORS.wallSelected);
  });
});

describe("toasts", () => {
  it("shows a toast for 3 s and starts the toast timer", () => {
    const host = new FakeHost();
    host.time = 500;
    const r = showToast(localState(host), "Wall too short", host);
    expect(r.state.toast).toEqual({ text: "Wall too short", until: 3500 });
    expect(r.effects).toEqual([{ type: "startTimer", timerId: TOAST_TIMER, ms: 3000 }]);
  });

  it("clears the toast when its time is up, but keeps a newer one", () => {
    const host = new FakeHost();
    const first = showToast(localState(host), "First", host).state;
    host.advance(3000);
    expect(onToastTimer(first, host).state.toast).toBeNull();
    const second = showToast(first, "Second", host).state;
    expect(onToastTimer(second, host).state.toast?.text).toBe("Second");
  });

  it("re-arms the timer when it fires early, and clears the toast on time", () => {
    const host = new FakeHost();
    const shown = showToast(localState(host), "Wall too short", host).state;
    host.time = 2999;
    const early = onToastTimer(shown, host);
    expect(early.state.toast?.text).toBe("Wall too short");
    expect(early.effects).toEqual([{ type: "startTimer", timerId: TOAST_TIMER, ms: 1 }]);
    host.time = 3000;
    const due = onToastTimer(shown, host);
    expect(due.state.toast).toBeNull();
    expect(due.effects).toEqual([]);
  });

  it("does nothing when no toast is showing", () => {
    const s = localState(new FakeHost());
    expect(onToastTimer(s, new FakeHost())).toEqual({ state: s, effects: [] });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/state.test.ts`
Expected: FAIL, `Cannot find module '../src/state'` (and `localState` is not exported by `./builders`). The two prototype-name tests are red on the plan's original lookups (`doc.walls[id]` finds `Object.prototype.constructor`); the `isValidId` checks below make them green.

- [x] **Step 3: Implement** `packages/editor/src/tools/types.ts`

```ts
import { isValidId, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { ToolName } from "../types";

export const PREVIEW_OP = "preview"; // preview walls get IDs "preview/…"; never committed

export type WallPreview = { from: Point; to: Point } & ({ ok: true; doc: Document } | { ok: false });

// Spec §5.5. Fields not listed in a transition carry over unchanged.
export type WallToolState =
  | { kind: "idle" }
  | { kind: "drawing"; origin: Point; chainStart: Point; value: string; preview: WallPreview | null }
  | { kind: "paused"; origin: Point; chainStart: Point; segment: string }; // segment = commit ID (shared documents)

export type DragTarget = { kind: "joint"; jointId: string } | { kind: "wall"; wallId: string };

export type Moves = { jointId: string; to: Point }[];

// moves = what this attempt tried; release commits exactly these. doc = the preview drawn: the attempt's
// result when ok, else the last valid preview (or baseDoc).
export type MoveAttempt = { ok: boolean; doc: Document; cursor: Point; moves: Moves };

// Spec §5.6 and §5.7.
export type SelectToolState =
  | { kind: "idle" }
  | { kind: "pressing"; pressWorld: Point; target: DragTarget | null }
  | { kind: "moving"; target: DragTarget; pressWorld: Point; baseDoc: Document; attempt: MoveAttempt }
  | { kind: "editingHelper"; wallId: string; value: string }; // entered in phase 5

export type ZoneToolState = { kind: "idle"; hoverFaceKey: string | null }; // behaviour in phase 5

export type ToolState =
  | { name: "select"; state: SelectToolState }
  | { name: "wall"; state: WallToolState }
  | { name: "zone"; state: ZoneToolState };

export function idleTool(name: ToolName): ToolState {
  switch (name) {
    case "select":
      return { name: "select", state: { kind: "idle" } };
    case "wall":
      return { name: "wall", state: { kind: "idle" } };
    case "zone":
      return { name: "zone", state: { kind: "idle", hoverFaceKey: null } };
    default:
      return assertNever(name);
  }
}

/** The joints a drag moves: the joint itself, or both ends of a wall. */
export function draggedJoints(doc: Document, target: DragTarget): string[] {
  switch (target.kind) {
    case "joint":
      return [target.jointId];
    case "wall": {
      const w = isValidId(target.wallId) ? doc.walls[target.wallId] : undefined;
      return w ? [w.a, w.b] : [];
    }
    default:
      return assertNever(target);
  }
}
```

`packages/editor/src/state.ts`:

```ts
import { isValidId, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point, type ProjectMeta } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "./camera";
import { createLocalDocument } from "./document/local-document";
import { visibleDoc } from "./document/open-document";
import type { OpenDocument } from "./document/types";
import { emptyHistory, type HistoryState } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { idleTool, type ToolState } from "./tools/types";
import type { Mods, RemotePresence, Size, SnapResult, ToolName } from "./types";

// Spec §5.3.
export type EditorState = {
  mode: "local" | "server";
  document: OpenDocument | null; // null = no drawing open (the project list)
  tool: ToolState;
  selection: EntityRef[]; // zero or one entity
  hover: EntityRef | null;
  pointer: { screen: Point; world: Point; mods: Mods } | null;
  panDrag: Point | null; // last screen point of a middle-button pan
  snap: SnapResult | null; // current snap (glyph and ViewModel)
  camera: Camera;
  snapSettings: { tolerancePx: number };
  undo: HistoryState;
  presence: Record<string, RemotePresence>;
  workspace: {
    projects: ProjectMeta[];
    loading: boolean;
    error: string | null;
    opening: { projectId: string; generation: string } | null;
  };
  toast: { text: string; until: number } | null;
  me: { clientId: string; name: string; color: string }; // colour comes from the server (phase 7)
};

/** What every handler returns; update appends the render effect. */
export type Step = { state: EditorState; effects: Effect[] };

export type InitOptions = { mode: "local" | "server"; me: { clientId: string; name: string }; viewport: Size; dpr: number };

export const SNAP_TOLERANCE_PX = 10;
export const DEFAULT_ME_COLOR = "#6b6b6b"; // same grey as COLORS.textMuted; until the server's welcome assigns one (phase 7)

export function initialState(opts: InitOptions, host: Host): EditorState {
  return {
    mode: opts.mode,
    document: opts.mode === "local" ? createLocalDocument({ id: "local", name: "Untitled" }, host.newId()) : null,
    tool: idleTool("select"),
    selection: [],
    hover: null,
    pointer: null,
    panDrag: null,
    snap: null,
    camera: { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: opts.viewport, dpr: opts.dpr },
    snapSettings: { tolerancePx: SNAP_TOLERANCE_PX },
    undo: emptyHistory,
    presence: {},
    workspace: { projects: [], loading: opts.mode === "server", error: null, opening: null },
    toast: null,
    me: { clientId: opts.me.clientId, name: opts.me.name, color: DEFAULT_ME_COLOR },
  };
}

/** Switching tools drops any gesture in progress; a submitted edit still settles (spec §7.4). */
export function switchTool(state: EditorState, name: ToolName): EditorState {
  return { ...state, tool: idleTool(name), snap: null, hover: null };
}

export function entityExists(doc: Document, ref: EntityRef): boolean {
  if (!isValidId(ref.id)) return false; // an Object.prototype member name would find the inherited member
  switch (ref.table) {
    case "joints":
      return doc.joints[ref.id] !== undefined;
    case "walls":
      return doc.walls[ref.id] !== undefined;
    case "zoneLabels":
      return doc.zoneLabels[ref.id] !== undefined;
    default:
      return assertNever(ref.table);
  }
}

/** Selection and hover drop any entity that no longer exists (spec §5.7). */
export function pruneSelection(state: EditorState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const selection = doc ? state.selection.filter((r) => entityExists(doc, r)) : [];
  const hover = doc && state.hover && entityExists(doc, state.hover) ? state.hover : null;
  if (selection.length === state.selection.length && hover === state.hover) return state;
  return { ...state, selection, hover };
}
```

`packages/editor/src/toast.ts`:

```ts
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";

export const TOAST_MS = 3000;
export const TOAST_TIMER = "toast";

export function showToast(state: EditorState, text: string, host: Host): Step {
  return {
    state: { ...state, toast: { text, until: host.now() + TOAST_MS } },
    effects: [{ type: "startTimer", timerId: TOAST_TIMER, ms: TOAST_MS }],
  };
}

/** A late timer from an earlier toast leaves a newer toast alone; an early one is re-armed. */
export function onToastTimer(state: EditorState, host: Host): Step {
  if (!state.toast) return { state, effects: [] };
  const left = state.toast.until - host.now();
  if (left <= 0) return { state: { ...state, toast: null }, effects: [] };
  return { state, effects: [{ type: "startTimer", timerId: TOAST_TIMER, ms: left }] };
}
```

`packages/editor/src/view/colors.ts`:

```ts
// One palette for every renderer; phase 8 polishes the values.
export const COLORS = {
  background: "#f7f6f3",
  grid: "#e9e7e2",
  gridMajor: "#d8d5ce",
  wall: "#2b2b2b",
  wallSelected: "#2f6fed",
  wallHover: "#4d4d4d",
  preview: "rgba(47, 111, 237, 0.55)",
  invalid: "#e5484d",
  handle: "#ffffff",
  handleFixed: "#2f6fed",
  snap: "#f59e0b",
  zoneFill: "rgba(214, 204, 181, 0.45)",
  zoneFillSelected: "rgba(47, 111, 237, 0.16)",
  zoneHint: "rgba(47, 111, 237, 0.07)",
  text: "#1f1f1f",
  textMuted: "#6b6b6b",
  helper: "#0f766e", // teal: distinct from the selection blue, so helper text is easy to tell apart (and to filter in tests)
} as const;
```

`packages/editor/src/view/fonts.ts`:

```ts
import type { FontSpec } from "../ports/host";

export const UI_FONT = "Inter, system-ui, sans-serif";
export const TAG_FONT: FontSpec = { family: UI_FONT, size: 12 };
export const HELPER_FONT: FontSpec = { family: UI_FONT, size: 11 };
```

Append to `packages/editor/test/builders.ts`:

```ts
import { createLocalDocument } from "../src/document/local-document";
import { initialState, type EditorState } from "../src/state";
import { FakeHost } from "./fake-shell";

/** A local-mode editor state (viewport 1200 × 800) whose unsaved document starts as `doc`; takes no ID from `host`. */
export function localState(host: FakeHost, doc: Document = emptyDocument()): EditorState {
  const s = initialState({ mode: "local", me: { clientId: "tab1", name: "Alice" }, viewport: { width: 1200, height: 800 }, dpr: 1 }, new FakeHost());
  return { ...s, document: createLocalDocument({ id: "local", name: "Untitled" }, "open1", doc) };
}

/** A server-mode editor state: no document, project list loading. */
export function serverState(host: FakeHost): EditorState {
  return initialState({ mode: "server", me: { clientId: "tab1", name: "Alice" }, viewport: { width: 1200, height: 800 }, dpr: 1 }, host);
}
```

Move these three `import` lines to the top of `builders.ts`, next to the existing imports (ESLint's `import/first` is not enabled, but keep imports together).

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/state.test.ts`
Expected: PASS (17 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: EditorState, initial state, tool states, toasts, colours and fonts"
```

---

### Task 3.8: `runCommand`, `runHistory` and notices

`runCommand` is the only way a tool changes the document: `execute` on the visible document, `commit` with a fresh ID, record history, then apply the notices the commit returned (spec §4.1, §7.0). `runHistory` checks values, validates the tentative document locally and commits the inverse or forward patch as a history request (spec §7.5).

**Files:** Create `packages/editor/src/commit.ts`, `src/notices.ts`, `packages/editor/test/commit.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/commit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES, execute, unwrap } from "@fm/domain";
import { runCommand, runHistory } from "../src/commit";
import { createLocalDocument } from "../src/document/local-document";
import { visibleDoc } from "../src/document/open-document";
import { recordCommit } from "../src/history/history";
import { applyNotices, rejectMessage } from "../src/notices";
import type { EditorState } from "../src/state";
import { jointAt, localState, roomDoc, serverState, wallBetween, wallDoc } from "./builders";
import { FakeHost } from "./fake-shell";

const addWall = { type: "addWall", opId: "w", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } } as const;

/** A FakeHost that logs the IDs it hands out. */
class IdLog extends FakeHost {
  issued: string[] = [];
  override newId(): string {
    const id = super.newId();
    this.issued.push(id);
    return id;
  }
}

function doc(s: EditorState) {
  if (!s.document) throw new Error("no document");
  return visibleDoc(s.document);
}

describe("runCommand", () => {
  it("commits a valid command and records a usable history entry", () => {
    const host = new FakeHost();
    const out = runCommand(localState(host), addWall, host);
    expect(out.committed).not.toBeNull();
    expect(Object.keys(doc(out.state).walls)).toHaveLength(1);
    expect(out.state.undo.past.map((e) => [e.id, e.status])).toEqual([[out.committed, "usable"]]);
    expect(out.state.document?.kind === "local" && out.state.document.revision).toBe(1);
  });

  it("shows the domain error as a toast and changes nothing else", () => {
    const host = new FakeHost();
    const s = localState(host);
    const zero = { ...addWall, to: { at: { x: 0, y: 0 } } };
    const out = runCommand(s, zero, host);
    expect(out.committed).toBeNull();
    expect(out.state.document).toBe(s.document);
    expect(out.state.undo).toBe(s.undo);
    expect(out.state.toast?.text).toBe(MESSAGES.tooShort);
    expect(out.effects).toEqual([{ type: "startTimer", timerId: "toast", ms: 3000 }]);
  });

  it("skips a command that changes nothing", () => {
    const host = new FakeHost();
    const s = localState(host, roomDoc());
    const corner = jointAt(doc(s), { x: 6, y: 4 });
    const out = runCommand(s, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4 } }] }, host);
    expect(out.committed).toBeNull();
    expect(out.state).toBe(s);
  });

  it("does nothing without an open document", () => {
    const host = new FakeHost();
    const s = serverState(host);
    expect(runCommand(s, addWall, host)).toEqual({ state: s, effects: [], committed: null });
  });

  it("drops deleted entities from the selection", () => {
    const host = new FakeHost();
    const base = localState(host, roomDoc());
    const bottom = wallBetween(doc(base), { x: 0, y: 0 }, { x: 6, y: 0 });
    const s: EditorState = { ...base, selection: [{ table: "walls", id: bottom }] };
    const out = runCommand(s, { type: "deleteEntities", ids: s.selection }, host);
    expect(out.state.selection).toEqual([]);
  });
});

describe("runHistory", () => {
  it("undoes and redoes a local edit at once", () => {
    const host = new FakeHost();
    const drawn = runCommand(localState(host), addWall, host).state;
    const undone = runHistory(drawn, "undo", host).state;
    expect(doc(undone).walls).toEqual({});
    expect([undone.undo.past.length, undone.undo.future.length, undone.undo.pending]).toEqual([0, 1, null]);
    const redone = runHistory(undone, "redo", host).state;
    expect(doc(redone)).toEqual(doc(drawn));
    expect([redone.undo.past.length, redone.undo.future.length]).toEqual([1, 0]);
  });

  it("commits each undo and redo under a fresh ID from the host, never the entry's (§7.5 step 3)", () => {
    const host = new IdLog();
    const drawn = runCommand(localState(host), addWall, host);
    host.issued = [];
    const undone = runHistory(drawn.state, "undo", host).state;
    runHistory(undone, "redo", host);
    // With a shared document, reusing the entry's ID would let the server's receipt for it ack the request unapplied.
    expect(host.issued).toHaveLength(2);
    expect(host.issued).not.toContain(drawn.committed);
  });

  it("refuses an undo that would make the drawing invalid", () => {
    const host = new FakeHost();
    const start = unwrap(execute(wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }), { type: "addWall", opId: "v", from: { at: { x: 1, y: 1 } }, to: { at: { x: 1, y: 3 } } })).doc;
    const end = jointAt(start, { x: 2, y: 0 });
    const moved = runCommand(localState(host, start), { type: "moveJoints", moves: [{ jointId: end, to: { x: 2, y: -2 } }] }, host).state;
    // A change outside this history (in phase 7, a remote move sharing no dependency): the vertical wall now reaches y = -0.5.
    const foot = jointAt(doc(moved), { x: 1, y: 1 });
    const other = unwrap(execute(doc(moved), { type: "moveJoints", moves: [{ jointId: foot, to: { x: 1, y: -0.5 } }] })).doc;
    const s: EditorState = { ...moved, document: createLocalDocument({ id: "local", name: "Untitled" }, "open1", other) };
    const out = runHistory(s, "undo", host); // would put the joint back at (2, 0), across the vertical wall
    expect(out.state.toast?.text).toBe(MESSAGES.crossing);
    expect(out.state.document).toBe(s.document);
    expect(out.state.undo).toBe(s.undo);
  });

  it("explains an empty history", () => {
    const host = new FakeHost();
    expect(runHistory(localState(host), "undo", host).state.toast?.text).toBe("Nothing to undo");
  });
});

describe("notices", () => {
  it("a rejection removes the pending entry and explains why", () => {
    const host = new FakeHost();
    const base = localState(host);
    const patch = { puts: [], deletes: [], before: [], dependencies: [] };
    const s: EditorState = { ...base, undo: recordCommit(base.undo, "c1", patch) };
    const reason = { kind: "conflict" as const, entities: [] }; // not `as const` on the object: a readonly [] is not an EntityKey[]
    const out = applyNotices(s, [{ type: "rejected", id: "c1", reason }], host);
    expect(out.state.undo.past).toEqual([]);
    expect(out.state.toast?.text).toBe(rejectMessage(reason));
  });

  it("an invalid rejection explains the broken invariant from the server's violation strings (§8)", () => {
    expect(rejectMessage({ kind: "invalid", violations: ["I5: walls cross"] })).toBe(MESSAGES.crossing);
    expect(rejectMessage({ kind: "invalid", violations: ["I9: whatever", " I2 : too short"] })).toBe(MESSAGES.tooShort);
    expect(rejectMessage({ kind: "invalid", violations: ["I9: whatever"] })).toBe("Rejected: the drawing would become invalid");
    expect(rejectMessage({ kind: "invalid", violations: [] })).toBe("Rejected: the drawing would become invalid");
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/commit.test.ts`
Expected: FAIL, `Cannot find module '../src/commit'`.

- [x] **Step 3: Implement** `packages/editor/src/notices.ts`

```ts
import { invariantsMessage } from "@fm/domain";
import { assertNever, type RejectReason } from "@fm/protocol";
import type { Notice } from "./document/types";
import { applyHistoryNotice } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";

/** For each notice in order: history first, then tools, so history is settled before tools react (our order). */
export function applyNotices(state: EditorState, notices: Notice[], host: Host): Step {
  let s = state;
  const effects: Effect[] = [];
  for (const n of notices) {
    s = { ...s, undo: applyHistoryNotice(s.undo, n) };
    const r = toolNotice(s, n, host);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: pruneSelection(s), effects };
}

// Phase 7 extends this: resume or end a paused wall chain (§5.5) and cancel gestures (§5.7).
function toolNotice(state: EditorState, n: Notice, host: Host): Step {
  switch (n.type) {
    case "accepted":
      return { state, effects: [] };
    case "rejected":
      return showToast(state, rejectMessage(n.reason), host);
    case "remoteChange":
    case "resynced":
    case "offline":
      return { state, effects: [] };
    default:
      return assertNever(n);
  }
}

export function rejectMessage(reason: RejectReason): string {
  switch (reason.kind) {
    case "conflict":
      return "Someone else changed this first";
    case "invalid": {
      // The server formats each violation as "<invariant>: <message>", e.g. "I5: walls cross".
      const ids = new Set(reason.violations.map((v) => (v.split(":")[0] ?? "").trim()));
      return invariantsMessage(ids) ?? "Rejected: the drawing would become invalid";
    }
    case "malformed":
      return "The server refused a malformed change";
    case "tooLarge":
      return "The change is too large";
    case "unknownProject":
      return "The project no longer exists";
    default:
      return assertNever(reason);
  }
}
```

`packages/editor/src/commit.ts`:

```ts
import { applyPatch, execute, topologyMessage, validateDocument, type Command } from "@fm/domain";
import { patchWrites } from "@fm/protocol";
import { canCommit, commit, status, visibleDoc } from "./document/open-document";
import type { DocStep, OpenDocument } from "./document/types";
import { patchOnly, prepareRedo, prepareUndo, recordCommit, startRequest } from "./history/history";
import { applyNotices } from "./notices";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";

// committed: the commit ID, or null when nothing was committed. Set even if the document rejects the commit in
// the same step (phase 7's local tooLarge guard); callers that need an accepted edit check history (phase 7's hasEntry).
export type CommandOutcome = Step & { committed: string | null };

export function blockedMessage(d: OpenDocument): string {
  return status(d) === "offline" ? "Offline: editing resumes when the connection returns" : "Waiting for server";
}

/** execute → commit → history → notices. The only way tools change the document. */
export function runCommand(state: EditorState, cmd: Command, host: Host): CommandOutcome {
  const d = state.document;
  if (!d) return { state, effects: [], committed: null };
  if (!canCommit(d)) return { ...showToast(state, blockedMessage(d), host), committed: null };
  const r = execute(visibleDoc(d), cmd);
  if (!r.ok) return { ...showToast(state, r.error.message, host), committed: null };
  if (patchWrites(r.value.patch).length === 0) return { state, effects: [], committed: null }; // nothing changed
  const id = host.newId();
  const step = commit(d, { id, patch: patchOnly(r.value.patch), dependencies: r.value.patch.dependencies });
  const recorded: EditorState = { ...state, undo: recordCommit(state.undo, id, r.value.patch) };
  return { ...finishCommit(recorded, step, host), committed: id };
}

/** Undo or redo as a history request: value check, local validation, commit (spec §7.5 steps 1–4). */
export function runHistory(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  if (!canCommit(d)) return showToast(state, blockedMessage(d), host);
  const doc = visibleDoc(d);
  const prepared = direction === "undo" ? prepareUndo(state.undo, doc) : prepareRedo(state.undo, doc);
  if (!prepared.ok) return showToast(state, prepared.error, host);
  const tentative = applyPatch(doc, prepared.value.patch);
  if (!tentative.ok) return showToast(state, tentative.error.message, host);
  const valid = validateDocument(tentative.value);
  if (!valid.ok) return showToast(state, topologyMessage(valid.error), host);
  const id = host.newId();
  const step = commit(d, { id, ...prepared.value });
  return finishCommit({ ...state, undo: startRequest(state.undo, { direction, id }) }, step, host);
}

function finishCommit(state: EditorState, step: DocStep<OpenDocument>, host: Host): Step {
  const after = applyNotices({ ...state, document: step.doc }, step.notices, host);
  return { state: pruneSelection(after.state), effects: [...step.effects, ...after.effects] };
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/commit.test.ts`
Expected: PASS (11 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: runCommand and runHistory through the open document; notices drive history"
```

---

### Task 3.9: Scene and ViewModel

The scene is rebuilt from state on every update: the grid, wall outlines (the preview document while a gesture is active), selection handles, the wall-tool preview with its live length and angle, and the snap glyph. The ViewModel carries every README field.

**Files:** Create `packages/editor/src/view/scene.ts`, `src/view/labels.ts`. Modify `packages/editor/src/view/view-model.ts` (add `buildViewModel` below the types). Create `packages/editor/test/view.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/view.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document } from "@fm/domain";
import type { UndoEntry } from "../src/history/history";
import type { EditorState } from "../src/state";
import { PREVIEW_OP, type ToolState } from "../src/tools/types";
import { gridSpacingFor } from "../src/snapping/snap";
import { COLORS } from "../src/view/colors";
import { HELPER_FONT } from "../src/view/fonts";
import { labelBox } from "../src/view/labels";
import { LAYER_ORDER, buildScene, textBox } from "../src/view/scene";
import type { Primitive, Scene } from "../src/view/scene-types";
import { buildViewModel } from "../src/view/view-model";
import { dividedRoomDoc, jointAt, localState, roomDoc, serverState, wallBetween } from "./builders";
import { FakeHost } from "./fake-shell";

const host = new FakeHost();

function layer(scene: Scene, name: (typeof LAYER_ORDER)[number]): Primitive[] {
  return scene.layers.find((l) => l.name === name)?.primitives ?? [];
}

function stateWith(doc: Document, patch: Partial<EditorState> = {}): EditorState {
  return { ...localState(host, doc), ...patch };
}

describe("buildScene", () => {
  it("always has the six layers in order", () => {
    expect(buildScene(stateWith(roomDoc()), host).layers.map((l) => l.name)).toEqual([...LAYER_ORDER]);
  });

  it("draws grid lines as screen-constant hairlines, with major lines", () => {
    const grid = layer(buildScene(stateWith(roomDoc()), host), "grid");
    expect(grid.length).toBeGreaterThan(100);
    expect(grid.every((p) => p.kind === "segment" && "px" in p.width && p.width.px === 1)).toBe(true);
    expect(grid.some((p) => p.kind === "segment" && p.color === COLORS.gridMajor)).toBe(true);
    const s = gridSpacingFor(stateWith(roomDoc()).camera.zoom);
    const vertical = (x: number) => grid.find((p) => p.kind === "segment" && p.a.x === x && p.b.x === x);
    expect(vertical(0)).toMatchObject({ color: COLORS.gridMajor });
    expect(vertical(s)).toMatchObject({ color: COLORS.grid });
  });

  it("draws one wall outline per wall", () => {
    const walls = layer(buildScene(stateWith(roomDoc()), host), "walls");
    expect(walls).toHaveLength(4);
    expect(walls.every((p) => p.kind === "polygon" && p.color === COLORS.wall)).toBe(true);
  });

  it("highlights a selected wall and shows its two joint handles", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const scene = buildScene(stateWith(doc, { selection: [{ table: "walls", id: right }] }), host);
    expect(layer(scene, "walls").filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(4); // two discs per handle
  });

  it("draws the snap glyph", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } }), host);
    expect(layer(scene, "overlays").filter((p) => p.kind === "segment" && p.color === COLORS.snap)).toHaveLength(4);
  });

  it("sizes snap glyphs in screen pixels: their world extent scales with 1 / zoom", () => {
    const extent = (zoom: number): number => {
      const base = stateWith(roomDoc(), { snap: { point: { x: 6, y: 4 }, kind: "endpoint" } });
      const glyph = layer(buildScene({ ...base, camera: { ...base.camera, zoom } }, host), "overlays");
      const xs = glyph.flatMap((p) => (p.kind === "segment" ? [p.a.x, p.b.x] : []));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent(50)).toBeGreaterThan(0);
    expect(extent(100)).toBeCloseTo(extent(50) / 2, 9);
  });

  it("colours a hovered wall, and lets the selection colour win over hover", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const hover = { table: "walls" as const, id: right };
    const walls = (patch: Partial<EditorState>) => layer(buildScene(stateWith(doc, patch), host), "walls");
    const hovered = walls({ hover });
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(1);
    expect(hovered.filter((p) => p.kind === "polygon" && p.color === COLORS.wall)).toHaveLength(3);
    const both = walls({ hover, selection: [hover] });
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallSelected)).toHaveLength(1);
    expect(both.filter((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toHaveLength(0);
  });

  it("sizes a label box from the host's text metrics plus 4 px padding, and textBox draws that box", () => {
    const camera = stateWith(roomDoc()).camera;
    const at = { x: 1, y: 2 };
    const box = labelBox("abc", at, HELPER_FONT, camera, host);
    const hw = (0.6 * HELPER_FONT.size * 3) / 2 + 4; // FakeHost: 0.6 × size per character
    const hh = (0.8 * HELPER_FONT.size + 0.2 * HELPER_FONT.size) / 2 + 2; // ascent + descent, half the padding
    expect(box.min.x).toBeCloseTo(at.x - hw / camera.zoom, 9);
    expect(box.max.x).toBeCloseTo(at.x + hw / camera.zoom, 9);
    expect(box.min.y).toBeCloseTo(at.y - hh / camera.zoom, 9);
    expect(box.max.y).toBeCloseTo(at.y + hh / camera.zoom, 9);
    expect(textBox("abc", at, HELPER_FONT, camera, host)).toEqual({
      kind: "polygon",
      points: [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }],
      color: COLORS.background,
    });
  });
});

describe("buildViewModel", () => {
  it("describes an idle local drawing", () => {
    expect(buildViewModel(stateWith(roomDoc()), host)).toEqual({
      activeTool: "select",
      commandBar: { prompt: "Select", value: "", unit: null },
      properties: { kind: "none" },
      cursor: "default",
      snap: null,
      presence: [],
      project: { name: "Untitled", status: "not saved", dirty: false, canEdit: true },
      projectList: null,
      toast: null,
      canUndo: false,
      canRedo: false,
    });
  });

  it("shows wall properties", () => {
    const doc = roomDoc();
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(buildViewModel(stateWith(doc, { selection: [{ table: "walls", id: bottom }] }), host).properties).toEqual({
      kind: "wall",
      fields: [
        { id: "length", label: "Length", value: "6.00", unit: "m", readOnly: true },
        { id: "thickness", label: "Thickness", value: "0.20", unit: "m", readOnly: true },
      ],
    });
  });

  it("shows joint properties", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const props = buildViewModel(stateWith(doc, { selection: [{ table: "joints", id: corner }] }), host).properties;
    expect(props).toEqual({
      kind: "joint",
      fields: [
        { id: "x", label: "X", value: "6.00", unit: "m", readOnly: true },
        { id: "y", label: "Y", value: "4.00", unit: "m", readOnly: true },
      ],
    });
  });

  it("maps remote presence to cursors", () => {
    const presence = { c2: { clientId: "c2", name: "Bob", color: "#e0457b", cursor: { x: 1, y: 2 }, selection: [] } };
    expect(buildViewModel(stateWith(roomDoc(), { presence }), host).presence).toEqual([
      { clientId: "c2", name: "Bob", color: "#e0457b", at: { x: 1, y: 2 } },
    ]);
  });

  it("shows the project list when no document is open", () => {
    const vm = buildViewModel(serverState(host), host);
    expect(vm.project).toBeNull();
    expect(vm.projectList).toEqual({ items: [], loading: true, error: null });
  });

  it("hides a toast whose time is up even before its timer fires", () => {
    const h = new FakeHost();
    const s = { ...localState(h), toast: { text: "Wall too short", until: 3000 } };
    expect(buildViewModel(s, h).toast).toBe("Wall too short");
    h.advance(3000);
    expect(buildViewModel(s, h).toast).toBeNull();
  });
});

// Added in review: spec rules and README constants the plan's tests above leave unpinned.
describe("buildScene: spec rules", () => {
  const texts = (scene: Scene): Primitive[] => layer(scene, "annotations").filter((p) => p.kind === "text");
  const colored = (ps: Primitive[], color: string): Primitive[] => ps.filter((p) => "color" in p && p.color === color);

  it("orders the layers as §5.9 lists them", () => {
    expect([...LAYER_ORDER]).toEqual(["grid", "zoneFills", "walls", "annotations", "overlays", "presence"]);
  });

  it("draws an ok drag attempt's document normally", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: dividedRoomDoc(), cursor: { x: 6, y: 4 }, moves: [] } },
    };
    const walls = layer(buildScene(stateWith(doc, { tool }), host), "walls");
    expect(walls).toHaveLength(7); // the attempt's document, not the visible one
    expect(colored(walls, COLORS.invalid)).toHaveLength(0);
  });

  it("draws the walls at an invalid drag's joints red, over the selection colour, with a ghost at the cursor (§5.7)", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "wall", wallId: right }, pressWorld: { x: 6, y: 2 }, baseDoc: doc,
        attempt: { ok: false, doc, cursor: { x: 9, y: 2 }, moves: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "walls", id: right }] }), host);
    expect(colored(layer(scene, "walls"), COLORS.invalid)).toHaveLength(3); // the wall and its two neighbours
    expect(colored(layer(scene, "walls"), COLORS.wallSelected)).toHaveLength(0);
    expect(layer(scene, "overlays")).toContainEqual({ kind: "disc", center: { x: 9, y: 2 }, radius: { px: 4 }, color: COLORS.invalid });
  });

  it("draws the wall tool's valid preview from its document, with live length and angle (§5.5)", () => {
    const from = { x: 1, y: 1 };
    const to = { x: 1, y: 3 };
    const previewDoc = unwrap(execute(roomDoc(), { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to } })).doc;
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: true, from, to, doc: previewDoc } },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }), host);
    expect(layer(scene, "walls")).toHaveLength(5);
    expect(colored(layer(scene, "walls"), COLORS.preview)).toHaveLength(1);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  90°", color: COLORS.text })]);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toHaveLength(0);
  });

  it("draws an invalid wall preview red, with a negative angle downwards (§5.5)", () => {
    const from = { x: 1, y: 3 };
    const to = { x: 1, y: 1 };
    const tool: ToolState = {
      name: "wall",
      state: { kind: "drawing", origin: from, chainStart: from, value: "", preview: { ok: false, from, to } },
    };
    const scene = buildScene(stateWith(roomDoc(), { tool }), host);
    expect(layer(scene, "walls")).toHaveLength(4);
    expect(colored(layer(scene, "overlays"), COLORS.invalid)).toEqual([expect.objectContaining({ kind: "segment", a: from, b: to })]);
    expect(texts(scene)).toEqual([expect.objectContaining({ text: "2.00 m  -90°", color: COLORS.invalid })]);
  });

  it("draws a dragged joint's handle at the drag preview, not the visible position (§5.7)", () => {
    const doc = roomDoc();
    const corner = jointAt(doc, { x: 6, y: 4 });
    const moved = unwrap(execute(doc, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 7, y: 5 } }] })).doc;
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: corner }, pressWorld: { x: 6, y: 4 }, baseDoc: doc,
        attempt: { ok: true, doc: moved, cursor: { x: 7, y: 5 }, moves: [] } },
    };
    const scene = buildScene(stateWith(doc, { tool, selection: [{ table: "joints", id: corner }] }), host);
    const discs = layer(scene, "overlays").filter((p) => p.kind === "disc");
    expect(discs.map((p) => p.kind === "disc" && p.center)).toEqual([{ x: 7, y: 5 }, { x: 7, y: 5 }]);
  });

  it("shows one handle for a selected joint", () => {
    const doc = roomDoc();
    const scene = buildScene(stateWith(doc, { selection: [{ table: "joints", id: jointAt(doc, { x: 6, y: 4 }) }] }), host);
    expect(layer(scene, "overlays").filter((p) => p.kind === "disc")).toHaveLength(2);
  });

  it.each(["midpoint", "onWall", "grid"] as const)("draws a %s snap glyph", (kind) => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind } }), host);
    expect(colored(layer(scene, "overlays"), COLORS.snap).length).toBeGreaterThan(0);
  });

  it("draws no glyph when snapping is bypassed", () => {
    const scene = buildScene(stateWith(roomDoc(), { snap: { point: { x: 3, y: 0 }, kind: "none" } }), host);
    expect(colored(layer(scene, "overlays"), COLORS.snap)).toHaveLength(0);
  });
});

describe("buildViewModel: README constants", () => {
  const from = { x: 0, y: 0 };
  it.each<[string, ToolState, EditorState["hover"], object]>([
    ["wall idle", { name: "wall", state: { kind: "idle" } }, null,
      { commandBar: { prompt: "First point", value: "", unit: "m" }, cursor: "crosshair" }],
    ["wall drawing", { name: "wall", state: { kind: "drawing", origin: from, chainStart: from, value: "3.2", preview: null } }, null,
      { commandBar: { prompt: "Next point or length", value: "3.2", unit: "m" }, cursor: "crosshair" }],
    ["wall paused", { name: "wall", state: { kind: "paused", origin: from, chainStart: from, segment: "c1" } }, null,
      { commandBar: { prompt: "Waiting for server", value: "", unit: null }, cursor: "crosshair" }],
    ["helper editing", { name: "select", state: { kind: "editingHelper", wallId: "w", value: "2" } }, null,
      { commandBar: { prompt: "Wall length", value: "2", unit: "m" } }],
    ["zone", { name: "zone", state: { kind: "idle", hoverFaceKey: null } }, null,
      { commandBar: { prompt: "Click inside a room", value: "", unit: null }, cursor: "pointer" }],
    ["select hovering", { name: "select", state: { kind: "idle" } }, { table: "joints", id: "j" },
      { commandBar: { prompt: "Select", value: "", unit: null }, cursor: "pointer" }],
  ])("%s: command bar and cursor", (_name, tool, hover, expected) => {
    expect(buildViewModel(stateWith(roomDoc(), { tool, hover }), host)).toMatchObject(expected);
  });

  it("uses the move cursor while dragging", () => {
    const doc = roomDoc();
    const tool: ToolState = {
      name: "select",
      state: { kind: "moving", target: { kind: "joint", jointId: jointAt(doc, { x: 0, y: 0 }) }, pressWorld: from, baseDoc: doc,
        attempt: { ok: true, doc, cursor: from, moves: [] } },
    };
    expect(buildViewModel(stateWith(doc, { tool }), host).cursor).toBe("move");
  });

  it("enables undo and redo from usable history entries", () => {
    const entry: UndoEntry = { id: "c1", patch: { puts: [], deletes: [], before: [], dependencies: [] }, dependencies: [], status: "usable" };
    const vm = buildViewModel(stateWith(roomDoc(), { undo: { past: [entry], future: [entry], pending: null } }), host);
    expect([vm.canUndo, vm.canRedo]).toEqual([true, true]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/view.test.ts`
Expected: FAIL, `Cannot find module '../src/view/scene'`.

- [x] **Step 3: Implement** `packages/editor/src/view/scene.ts`

```ts
import { EPS, WALL_THICKNESS, add, incidentWalls, length, perpLeft, scale, sub, wallOutlines, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { screenToWorld, type Camera } from "../camera";
import { visibleDoc } from "../document/open-document";
import type { FontSpec, Host } from "../ports/host";
import { gridSpacingFor } from "../snapping/snap";
import type { EditorState } from "../state";
import { PREVIEW_OP, draggedJoints, type WallPreview } from "../tools/types";
import { COLORS } from "./colors";
import { HELPER_FONT } from "./fonts";
import { labelBox } from "./labels";
import type { Layer, LayerName, Primitive, Scene } from "./scene-types";

export const LAYER_ORDER: readonly LayerName[] = ["grid", "zoneFills", "walls", "annotations", "overlays", "presence"];
const MAX_GRID_LINES = 400;
const PREVIEW_WALL = `${PREVIEW_OP}/w0`; // the wall created by the wall tool's preview addWall

type Layers = Record<LayerName, Primitive[]>;

export function buildScene(state: EditorState, host: Host): Scene {
  const layers: Layers = { grid: [], zoneFills: [], walls: [], annotations: [], overlays: [], presence: [] };
  drawGrid(state.camera, layers.grid);
  const doc = sceneDocument(state);
  if (doc) {
    // Phase 5 inserts drawZones(state, doc, layers, host) here, before the walls.
    drawWalls(state, doc, layers.walls);
    drawSelection(state, doc, layers.overlays);
    drawToolOverlay(state, layers, host);
  }
  drawSnap(state, layers.overlays);
  // Phase 7 appends drawPresence(state, layers.presence) here.
  return { layers: LAYER_ORDER.map((name): Layer => ({ name, primitives: layers[name] })) };
}

/** The document to draw: a gesture's preview while one is active, otherwise the visible document. */
export function sceneDocument(state: EditorState): Document | null {
  if (!state.document) return null;
  const tool = state.tool;
  if (tool.name === "select" && tool.state.kind === "moving") return tool.state.attempt.doc;
  if (tool.name === "wall" && tool.state.kind === "drawing") {
    const preview = tool.state.preview;
    if (preview?.ok) return preview.doc;
  }
  return visibleDoc(state.document);
}

/** A background box behind a label. */
export function textBox(text: string, at: Point, font: FontSpec, camera: Camera, host: Host): Primitive {
  const { min, max } = labelBox(text, at, font, camera, host);
  return {
    kind: "polygon",
    points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }],
    color: COLORS.background,
  };
}

function drawGrid(camera: Camera, out: Primitive[]): void {
  const s = gridSpacingFor(camera.zoom);
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: camera.viewport.width, y: camera.viewport.height });
  const x0 = Math.ceil(topLeft.x / s);
  const x1 = Math.floor(bottomRight.x / s);
  const y0 = Math.ceil(bottomRight.y / s);
  const y1 = Math.floor(topLeft.y / s);
  if (x1 - x0 + (y1 - y0) > MAX_GRID_LINES) return;
  const line = (a: Point, b: Point, major: boolean): Primitive => ({
    kind: "segment", a, b, width: { px: 1 }, color: major ? COLORS.gridMajor : COLORS.grid, cap: "butt",
  });
  for (let i = x0; i <= x1; i++) out.push(line({ x: i * s, y: bottomRight.y }, { x: i * s, y: topLeft.y }, i % 5 === 0));
  for (let j = y0; j <= y1; j++) out.push(line({ x: topLeft.x, y: j * s }, { x: bottomRight.x, y: j * s }, j % 5 === 0));
}

function drawWalls(state: EditorState, doc: Document, out: Primitive[]): void {
  const selected = new Set(state.selection.filter((r) => r.table === "walls").map((r) => r.id));
  const hovered = state.hover?.table === "walls" ? state.hover.id : null;
  const invalid = invalidWalls(state, doc);
  for (const [id, points] of wallOutlines(doc)) {
    const color = invalid.has(id)
      ? COLORS.invalid
      : id === PREVIEW_WALL
        ? COLORS.preview
        : selected.has(id)
          ? COLORS.wallSelected
          : id === hovered
            ? COLORS.wallHover
            : COLORS.wall;
    out.push({ kind: "polygon", points, color });
  }
}

/** While a drag is invalid, the walls around the dragged joints are drawn red (spec §5.7). */
function invalidWalls(state: EditorState, doc: Document): Set<string> {
  const tool = state.tool;
  if (tool.name !== "select" || tool.state.kind !== "moving" || tool.state.attempt.ok) return new Set();
  return new Set(draggedJoints(doc, tool.state.target).flatMap((j) => incidentWalls(doc, j)));
}

function drawSelection(state: EditorState, doc: Document, out: Primitive[]): void {
  for (const ref of state.selection) {
    const joints =
      ref.table === "walls" ? draggedJoints(doc, { kind: "wall", wallId: ref.id }) : ref.table === "joints" ? [ref.id] : [];
    for (const id of joints) {
      const j = doc.joints[id];
      if (j) out.push(...handle({ x: j.x, y: j.y }));
    }
  }
}

function handle(p: Point): Primitive[] {
  return [
    { kind: "disc", center: p, radius: { px: 5 }, color: COLORS.wallSelected },
    { kind: "disc", center: p, radius: { px: 3.5 }, color: COLORS.handle },
  ];
}

function drawToolOverlay(state: EditorState, layers: Layers, host: Host): void {
  const tool = state.tool;
  if (tool.name === "wall" && tool.state.kind === "drawing" && tool.state.preview) {
    const p = tool.state.preview;
    if (!p.ok) {
      layers.overlays.push({ kind: "segment", a: p.from, b: p.to, width: { m: WALL_THICKNESS }, color: COLORS.invalid, cap: "butt" });
    }
    drawLengthLabel(p, state.camera, host, layers.annotations);
  }
  if (tool.name === "select" && tool.state.kind === "moving" && !tool.state.attempt.ok) {
    layers.overlays.push({ kind: "disc", center: tool.state.attempt.cursor, radius: { px: 4 }, color: COLORS.invalid }); // ghost
  }
}

/** Live length and angle of the wall being drawn (F1). */
function drawLengthLabel(p: WallPreview, camera: Camera, host: Host, out: Primitive[]): void {
  const d = sub(p.to, p.from);
  const len = length(d);
  if (len < EPS) return;
  const degrees = Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI);
  const text = `${len.toFixed(2)} m  ${degrees}°`;
  const at = add(scale(add(p.from, p.to), 0.5), scale(perpLeft(scale(d, 1 / len)), 16 / camera.zoom));
  out.push(textBox(text, at, HELPER_FONT, camera, host));
  out.push({ kind: "text", text, at, size: HELPER_FONT.size, color: p.ok ? COLORS.text : COLORS.invalid, align: "center", rotation: 0 });
}

function drawSnap(state: EditorState, out: Primitive[]): void {
  const snap = state.snap;
  if (!snap || snap.kind === "none") return;
  const r = 5 / state.camera.zoom;
  const { x, y } = snap.point;
  const seg = (a: Point, b: Point): Primitive => ({ kind: "segment", a, b, width: { px: 1.5 }, color: COLORS.snap, cap: "round" });
  const ring = (pts: Point[]): Primitive[] => pts.map((a, i) => seg(a, pts[(i + 1) % pts.length] ?? a));
  switch (snap.kind) {
    case "endpoint":
      out.push(...ring([{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }]));
      return;
    case "midpoint":
      out.push(...ring([{ x, y: y + r }, { x: x - r, y: y - r }, { x: x + r, y: y - r }]));
      return;
    case "onWall":
      out.push(seg({ x: x - r, y: y - r }, { x: x + r, y: y + r }), seg({ x: x - r, y: y + r }, { x: x + r, y: y - r }));
      return;
    case "grid":
      out.push({ kind: "disc", center: snap.point, radius: { px: 2.5 }, color: COLORS.snap });
      return;
    default:
      assertNever(snap.kind);
  }
}
```

The last `switch` ends in `default: assertNever(snap.kind)`: a function returning `void` gets no missing-case error from TypeScript, so a new `SnapKind` would otherwise draw no glyph silently (wave 5 code review).

`packages/editor/src/view/labels.ts` (its own module so phase 5's `helper.ts`, which `scene.ts` imports, can share it without an import cycle):

```ts
import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { FontSpec, Host } from "../ports/host";

const LABEL_PAD_PX = 4;

/** The world box around a label centred at `at`: the host's text metrics plus padding (screen px → metres). */
export function labelBox(text: string, at: Point, font: FontSpec, camera: Camera, host: Host): { min: Point; max: Point } {
  const m = host.textMetrics(text, font);
  const hw = (m.width / 2 + LABEL_PAD_PX) / camera.zoom;
  const hh = ((m.ascent + m.descent) / 2 + LABEL_PAD_PX / 2) / camera.zoom;
  return { min: { x: at.x - hw, y: at.y - hh }, max: { x: at.x + hw, y: at.y + hh } };
}
```

Append to `packages/editor/src/view/view-model.ts`, below the types, and merge these imports into the existing ones at the top:

```ts
import { WALL_THICKNESS, wallHelperDimension } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { canCommit, isDirty, status, visibleDoc } from "../document/open-document";
import { canRedo, canUndo } from "../history/history";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";

export function buildViewModel(state: EditorState, host: Host): ViewModel {
  const d = state.document;
  return {
    activeTool: state.tool.name,
    commandBar: commandBar(state),
    properties: properties(state),
    cursor: cursorFor(state),
    snap: state.snap && state.snap.kind !== "none" ? { kind: state.snap.kind, at: state.snap.point } : null,
    presence: Object.values(state.presence).map((p) => ({ clientId: p.clientId, name: p.name, color: p.color, at: p.cursor })),
    project: d ? { name: d.project.name, status: status(d), dirty: isDirty(d), canEdit: canCommit(d) } : null,
    projectList: d ? null : { items: state.workspace.projects, loading: state.workspace.loading, error: state.workspace.error },
    toast: state.toast && state.toast.until > host.now() ? state.toast.text : null,
    canUndo: d !== null && canCommit(d) && canUndo(state.undo),
    canRedo: d !== null && canCommit(d) && canRedo(state.undo),
  };
}

function commandBar(state: EditorState): ViewModel["commandBar"] {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      switch (tool.state.kind) {
        case "idle":
          return { prompt: "First point", value: "", unit: "m" };
        case "drawing":
          return { prompt: "Next point or length", value: tool.state.value, unit: "m" };
        case "paused":
          return { prompt: "Waiting for server", value: "", unit: null };
        default:
          return assertNever(tool.state);
      }
    case "select":
      return tool.state.kind === "editingHelper"
        ? { prompt: "Wall length", value: tool.state.value, unit: "m" }
        : { prompt: "Select", value: "", unit: null };
    case "zone":
      return { prompt: "Click inside a room", value: "", unit: null };
    default:
      return assertNever(tool);
  }
}

function field(id: string, label: string, value: string, unit: string | null, readOnly = true): Field {
  return { id, label, value, unit, readOnly };
}

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
    case "zoneLabels":
      return { kind: "none" }; // phase 5: name (editable) and area (read-only)
    default:
      return assertNever(ref.table);
  }
}

function cursorFor(state: EditorState): ViewModel["cursor"] {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return "crosshair";
    case "zone":
      return "pointer";
    case "select":
      return tool.state.kind === "moving" ? "move" : state.hover ? "pointer" : "default";
    default:
      return assertNever(tool);
  }
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/view.test.ts`
Expected: PASS (33 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: Scene (grid, walls, handles, preview, snap glyph) and ViewModel"
```

---

### Task 3.10: `update`, key routing, session stubs and the fake shell

`update` routes each event to a handler and appends exactly one `render` effect built from the final state. Keys follow the spec §5.4 precedence. Tool handlers are stubs in this task; Tasks 3.11 and 3.12 replace the wall and select stubs, phase 5 replaces the zone placeholder, and phase 7 replaces `session.ts`.

**Files:** Create `packages/editor/src/update.ts`, `src/keys.ts`, `src/pointer.ts` (wave 6 review), `src/session.ts`, `src/tools/wall-tool.ts` (stub), `src/tools/select-tool.ts` (stub), `src/tools/zone-tool.ts` (placeholder), `packages/editor/test/update.test.ts`. Modify `packages/editor/test/fake-shell.ts` (add `FakeShell`).

- [x] **Step 1: Add `FakeShell`** to `packages/editor/test/fake-shell.ts`, below `FakeHost`, and merge these imports into the top of the file:

```ts
import type { Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { worldToScreen } from "../src/camera";
import { visibleDoc } from "../src/document/open-document";
import type { Effect } from "../src/ports/effects";
import type { Event, UiAction } from "../src/ports/events";
import type { EditorState } from "../src/state";
import { NO_MODS, type Mods } from "../src/types";
import { update } from "../src/update";
import { buildScene } from "../src/view/scene";
import type { Scene } from "../src/view/scene-types";
import { buildViewModel, type ViewModel } from "../src/view/view-model";
import { localState } from "./builders";

/**
 * Drives the editor like a shell: gestures in world coordinates are converted to screen
 * coordinates with the current camera, because the editor owns the camera (spec §5.2).
 */
export class FakeShell {
  readonly host: FakeHost;
  state: EditorState;
  effects: Effect[] = [];

  constructor(state?: EditorState, host: FakeHost = new FakeHost()) {
    this.host = host;
    this.state = state ?? localState(host);
  }

  /** Unsaved LocalDocument, viewport 1200 × 800, dpr 1. */
  static local(): FakeShell {
    return new FakeShell();
  }

  /** Like local(), but the unsaved document starts as `doc` (a fixture, not a gesture). */
  static withDocument(doc: Document): FakeShell {
    const host = new FakeHost();
    return new FakeShell(localState(host, doc), host);
  }

  send(e: Event): Effect[] {
    const r = update(this.state, e, this.host);
    this.state = r.state;
    this.effects.push(...r.effects);
    return r.effects;
  }

  moveTo(world: Point, mods?: Partial<Mods>): void {
    this.send({ type: "pointerMove", screen: this.screen(world), mods: this.mods(mods), button: 0 });
  }

  down(world: Point, mods?: Partial<Mods>, button: 0 | 1 | 2 = 0): void {
    this.send({ type: "pointerDown", screen: this.screen(world), mods: this.mods(mods), button });
  }

  up(world: Point, mods?: Partial<Mods>, button: 0 | 1 | 2 = 0): void {
    this.send({ type: "pointerUp", screen: this.screen(world), mods: this.mods(mods), button });
  }

  click(world: Point, mods?: Partial<Mods>): void {
    this.moveTo(world, mods);
    this.down(world, mods);
    this.up(world, mods);
  }

  drag(from: Point, to: Point, mods?: Partial<Mods>): void {
    this.moveTo(from, mods);
    this.down(from, mods);
    this.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mods);
    this.moveTo(to, mods);
    this.up(to, mods);
  }

  /** A wheel at the cursor, or at the viewport centre before any pointer event. */
  wheel(deltaX: number, deltaY: number, mods?: Partial<Mods>): Effect[] {
    const v = this.state.camera.viewport;
    const screen = this.state.pointer?.screen ?? { x: v.width / 2, y: v.height / 2 };
    return this.send({ type: "wheel", screen, deltaX, deltaY, mods: this.mods(mods) });
  }

  key(key: string, mods?: Partial<Mods>): void {
    this.send({ type: "key", key, mods: this.mods(mods) });
  }

  type(text: string, mods?: Partial<Mods>): void {
    for (const ch of text) this.key(ch, mods);
  }

  ui(action: UiAction): void {
    this.send({ type: "ui", action });
  }

  fireTimer(timerId: string): void {
    this.send({ type: "timerFired", timerId });
  }

  doc(): Document {
    if (!this.state.document) throw new Error("No document open");
    return visibleDoc(this.state.document);
  }

  /**
   * Built from the current state, so equal to the view of the last render effect only while `host.now()` has not
   * advanced since: toast visibility depends on the clock.
   */
  view(): ViewModel {
    return buildViewModel(this.state, this.host);
  }

  scene(): Scene {
    return buildScene(this.state, this.host);
  }

  effectsOf<T extends Effect["type"]>(type: T): Extract<Effect, { type: T }>[] {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type);
  }

  clearEffects(): void {
    this.effects = [];
  }

  private screen(world: Point): Point {
    return worldToScreen(this.state.camera, world);
  }

  private mods(m?: Partial<Mods>): Mods {
    return { ...NO_MODS, ...m };
  }
}
```

- [x] **Step 2: Write the failing test** `packages/editor/test/update.test.ts`

```ts
import { execute, unwrap, type EntityRef } from "@fm/domain";
import { describe, expect, it } from "vitest";
import { screenToWorld } from "../src/camera";
import type { EditorState } from "../src/state";
import { idleTool } from "../src/tools/types";
import { NO_MODS, type SnapResult } from "../src/types";
import { buildScene } from "../src/view/scene";
import { roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

/** `pointer.world` is always the pointer's screen point under the current camera. */
function expectPointerOnCamera(shell: FakeShell): void {
  const p = shell.state.pointer;
  expect(p).not.toBeNull();
  if (p) expect(p.world).toEqual(screenToWorld(shell.state.camera, p.screen));
}

const GRID_SNAP: SnapResult = { point: { x: 1, y: 1 }, kind: "grid" };
const WALL_DRAWING: EditorState["tool"] = {
  name: "wall",
  state: { kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "12", preview: null },
};

describe("update", () => {
  it("switches tools with V, W and Z in either case", () => {
    const shell = FakeShell.local();
    shell.key("w");
    expect(shell.view().activeTool).toBe("wall");
    shell.key("Z", { shift: true });
    expect(shell.view().activeTool).toBe("zone");
    shell.key("v");
    expect(shell.view().activeTool).toBe("select");
  });

  it("treats Cmd+Z as undo, not as the zone tool", () => {
    const shell = FakeShell.local();
    shell.key("z", { meta: true });
    expect(shell.view().activeTool).toBe("select");
    expect(shell.view().toast).toBe("Nothing to undo");
  });

  it("returns to Select on Esc from the idle wall tool and from the zone tool", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    shell.key("z");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("accepts pickTool from the toolbar", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "pickTool", tool: "wall" });
    expect(shell.view().activeTool).toBe("wall");
  });

  it("clears a toast when its timer fires", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "undo" });
    expect(shell.view().toast).toBe("Nothing to undo");
    expect(shell.effectsOf("startTimer")).toEqual([{ type: "startTimer", timerId: "toast", ms: 3000 }]);
    shell.host.advance(3000);
    shell.fireTimer("toast");
    expect(shell.state.toast).toBeNull();
  });

  it("zooms around the cursor with Ctrl + wheel", () => {
    const shell = FakeShell.local();
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(shell.state.camera, screen);
    shell.send({ type: "wheel", screen, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expect(shell.state.camera.zoom).toBeCloseTo(80 * Math.E, 6);
    const after = screenToWorld(shell.state.camera, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("pans with a plain wheel", () => {
    const shell = FakeShell.local();
    shell.wheel(40, 0);
    expect(shell.state.camera.center).toEqual({ x: 3.5, y: 2 });
  });

  it("follows viewport resizes", () => {
    const shell = FakeShell.local();
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 });
    expect(shell.state.camera.viewport).toEqual({ width: 800, height: 600 });
    expect(shell.state.camera.dpr).toBe(2);
  });

  it("ignores save results and Cmd+S (local files are follow-up X1)", () => {
    const shell = FakeShell.local();
    const before = shell.state;
    shell.send({ type: "saveResult", writeId: "w1", ok: true });
    shell.key("s", { meta: true });
    expect(shell.state).toBe(before);
  });

  // Added in review: each test below kills a routing mutation the plan's tests let survive.
  it("treats Ctrl+Z as undo and Cmd+Shift+Z as redo; Alt+W is not a command code", () => {
    const shell = FakeShell.local();
    shell.key("z", { ctrl: true });
    expect(shell.view().activeTool).toBe("select");
    expect(shell.view().toast).toBe("Nothing to undo");
    shell.key("z", { meta: true, shift: true });
    expect(shell.view().toast).toBe("Nothing to redo");
    shell.key("w", { alt: true });
    expect(shell.view().activeTool).toBe("select");
  });

  it("ends every update with one render effect, after the handler's effects", () => {
    const shell = FakeShell.local();
    const effects = shell.send({ type: "ui", action: { type: "undo" } });
    expect(effects.map((e) => e.type)).toEqual(["startTimer", "render"]);
  });

  it("deletes the selection in the idle Select tool, but not with Cmd held or during a press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wall: EntityRef = { table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection).toEqual([wall]);
    shell.key("Delete", { meta: true });
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    expect(shell.state.tool).toMatchObject({ name: "select", state: { kind: "pressing" } });
    shell.key("Delete");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.up({ x: 3, y: 0 });
    expect(shell.state.tool).toEqual(idleTool("select"));
    shell.key("Delete");
    expect(shell.doc().walls[wall.id]).toBeUndefined();
  });

  it("deletes nothing in the wall tool and only zone labels in the zone tool", () => {
    const doc = unwrap(execute(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room" })).doc;
    const shell = FakeShell.withDocument(doc);
    const wall: EntityRef = { table: "walls", id: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.key("w");
    shell.state = { ...shell.state, selection: [wall] };
    shell.key("Backspace");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.key("z");
    shell.key("Backspace");
    expect(shell.doc().walls[wall.id]).toBeDefined();
    shell.state = { ...shell.state, selection: [{ table: "zoneLabels", id: "L1" }] };
    shell.key("Backspace");
    expect(shell.doc().zoneLabels["L1"]).toBeUndefined();
  });

  it("clears the selection on Esc in the idle Select tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) }] };
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().activeTool).toBe("select");
  });

  it("pans with a middle-button drag in any tool, tracking the pointer", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 100 }, mods: NO_MODS, button: 1 });
    expect(shell.state.pointer?.screen).toEqual({ x: 180, y: 100 });
    expect(shell.state.camera.center).toEqual({ x: 2, y: 2 });
    shell.send({ type: "pointerUp", screen: { x: 180, y: 100 }, mods: NO_MODS, button: 1 });
    expect(shell.state.camera.center).toEqual({ x: 2, y: 2 });
    expect(shell.state.panDrag).toBeNull();
    expect(shell.view().activeTool).toBe("wall");
  });

  it("never passes right-button events to the tool, but tracks the pointer", () => {
    const shell = FakeShell.local();
    shell.key("z");
    const snap: SnapResult = { point: { x: 1, y: 1 }, kind: "grid" };
    shell.state = { ...shell.state, snap };
    shell.send({ type: "pointerDown", screen: { x: 50, y: 60 }, mods: NO_MODS, button: 2 });
    expect(shell.state.snap).toEqual(snap); // the zone tool would clear it
    expect(shell.state.pointer?.screen).toEqual({ x: 50, y: 60 });
  });

  it("zooms with Cmd + wheel", () => {
    const shell = FakeShell.local();
    shell.wheel(0, -100, { meta: true });
    expect(shell.state.camera.zoom).toBeCloseTo(80 * Math.E, 6);
  });

  it("ignores timers other than the toast timer", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "undo" });
    shell.host.advance(3000);
    shell.fireTimer("other");
    expect(shell.state.toast?.text).toBe("Nothing to undo");
  });

  // Added in review (task 3.10): the cursor follows the camera; only an applied undo or redo drops the gesture.
  it("keeps the pointer's world point on the camera after a plain wheel", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.wheel(40, 30);
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera after a Ctrl + wheel zoom", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.send({ type: "wheel", screen: { x: 700, y: 500 }, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera after a viewport resize", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 2 });
    expectPointerOnCamera(shell);
  });

  it("keeps the pointer's world point on the camera during and after a middle-button pan", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expectPointerOnCamera(shell);
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expectPointerOnCamera(shell);
  });

  it("replays the cursor to the tool after a wheel, a resize, and the end of a pan", () => {
    const shell = FakeShell.local();
    shell.key("z"); // the zone placeholder clears `snap` on any pointer event it sees
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.wheel(0, 30);
    expect(shell.state.snap).toBeNull();
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.send({ type: "viewportResized", size: { width: 800, height: 600 }, devicePixelRatio: 1 });
    expect(shell.state.snap).toBeNull();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.state = { ...shell.state, snap: GRID_SNAP };
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toEqual(GRID_SNAP); // pan moves do not reach the tool
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toBeNull();
  });

  it("leaves the pointer unset after a wheel before any pointer event", () => {
    const shell = FakeShell.local();
    shell.wheel(40, 30);
    expect(shell.state.pointer).toBeNull();
  });

  it("moves only the pointer on a wheel during a middle-button pan; the tool is told when the pan ends", () => {
    const shell = FakeShell.local();
    shell.key("z"); // the zone placeholder clears `snap` on any pointer event it sees
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    // A stale pan anchor on purpose: a replay through the pan branch would pan by the difference.
    shell.state = { ...shell.state, snap: GRID_SNAP, panDrag: { x: 0, y: 0 } };
    const center = shell.state.camera.center;
    shell.wheel(40, 0);
    expect(shell.state.camera.center).toEqual({ x: center.x + 0.5, y: center.y });
    expect(shell.state.panDrag).toEqual({ x: 0, y: 0 });
    expectPointerOnCamera(shell);
    expect(shell.state.snap).toEqual(GRID_SNAP);
    shell.send({ type: "pointerUp", screen: { x: 180, y: 140 }, mods: NO_MODS, button: 1 });
    expect(shell.state.snap).toBeNull();
  });

  it("keeps a wall chain, its snap and hover when undo or redo is refused", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const hover: EntityRef = { table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) };
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    shell.state = { ...shell.state, tool: WALL_DRAWING, snap: GRID_SNAP, hover };
    const before = shell.state;
    shell.key("z", { meta: true });
    expect(shell.view().toast).toBe("Nothing to undo");
    expect(shell.state).toEqual({ ...before, toast: shell.state.toast });
    shell.ui({ type: "redo" });
    expect(shell.view().toast).toBe("Nothing to redo");
    expect(shell.state).toEqual({ ...before, toast: shell.state.toast });
  });

  it("drops a wall chain on an applied undo or redo, from the keyboard and the toolbar", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wall = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wall }] };
    shell.key("Delete");
    expect(shell.doc().walls[wall]).toBeUndefined();
    shell.key("w");
    shell.send({ type: "pointerMove", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    const startChain = (): void => {
      shell.state = { ...shell.state, tool: WALL_DRAWING, snap: GRID_SNAP };
    };
    const expectChainDropped = (): void => {
      expect(shell.state.tool).toEqual(idleTool("wall"));
      expect(shell.state.snap).toEqual({ point: { x: -3.2, y: 5.8 }, kind: "grid" }); // the replay rebuilds it at the cursor
      expect(shell.state.toast).toBeNull();
    };
    startChain();
    shell.key("z", { meta: true });
    expect(shell.doc().walls[wall]).toBeDefined();
    expectChainDropped();
    startChain();
    shell.ui({ type: "redo" });
    expect(shell.doc().walls[wall]).toBeUndefined();
    expectChainDropped();
    startChain();
    shell.ui({ type: "undo" });
    expect(shell.doc().walls[wall]).toBeDefined();
    expectChainDropped();
    startChain();
    shell.key("z", { ctrl: true, shift: true });
    expect(shell.doc().walls[wall]).toBeUndefined();
    expectChainDropped();
  });

  // Added in review (task 3.10): each test below kills a mutation of the render effect or the key routing.
  it("builds the render effect's camera and scene from the state after the event", () => {
    const shell = FakeShell.local();
    const effects = shell.wheel(0, -100, { ctrl: true });
    const render = effects[effects.length - 1];
    expect(render?.type).toBe("render");
    if (render?.type !== "render") return;
    expect(render.camera).toEqual(shell.state.camera);
    expect(render.scene).toEqual(buildScene(shell.state, shell.host));
  });

  it("builds the render effect's view from the state after the event", () => {
    const shell = FakeShell.local();
    const effects = shell.send({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    const render = effects[effects.length - 1];
    expect(render?.type === "render" ? render.view.activeTool : null).toBe("wall");
  });

  it("deletes nothing while the Select tool is moving, or with Ctrl held", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const wallId = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: wallId }]);
    shell.key("Delete", { ctrl: true });
    expect(shell.doc().walls[wallId]).toBeDefined();
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: -0.6 });
    expect(shell.state.tool).toMatchObject({ name: "select", state: { kind: "moving" } });
    shell.key("Delete");
    expect(shell.doc().walls[wallId]).toBeDefined();
  });

  it("treats Shift+Z as redo when the key arrives upper-case", () => {
    const shell = FakeShell.local();
    shell.key("Z", { meta: true, shift: true });
    expect(shell.view().toast).toBe("Nothing to redo");
  });

  it("pans vertically with the wheel and with a middle-button drag", () => {
    const shell = FakeShell.local();
    shell.wheel(0, 40);
    expect(shell.state.camera.center).toEqual({ x: 3, y: 1.5 });
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerMove", screen: { x: 100, y: 180 }, mods: NO_MODS, button: 1 });
    expect(shell.state.camera.center).toEqual({ x: 3, y: 2.5 });
  });

  it("ends a middle-button pan on any button's pointerUp", () => {
    const shell = FakeShell.local();
    shell.send({ type: "pointerDown", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 1 });
    shell.send({ type: "pointerUp", screen: { x: 100, y: 100 }, mods: NO_MODS, button: 0 });
    expect(shell.state.panDrag).toBeNull();
  });

  it("ignores modifier-only keys and Space outside a value field (spec §5.4)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }) }] };
    const before = shell.state;
    shell.key("Shift", { shift: true });
    shell.key("Control", { ctrl: true });
    shell.key("Meta", { meta: true });
    shell.key("Alt", { alt: true });
    shell.key(" ");
    expect(shell.state).toBe(before);
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/update.test.ts`
Expected: FAIL, `Cannot find module '../src/update'`.

- [x] **Step 4: Write the handler stubs.** `packages/editor/src/tools/wall-tool.ts` (Task 3.11 replaces this file):

```ts
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { switchTool, type EditorState, type Step } from "../state";
import { idleTool, type WallToolState } from "./types";

// Stub: Task 3.11 replaces this file.
export function wallPointer(state: EditorState, _tool: WallToolState, _e: PointerInput, _host: Host): Step {
  return { state, effects: [] };
}

export function wallKey(_state: EditorState, _tool: WallToolState, _key: string, _host: Host): Step | null {
  return null;
}

export function wallEscape(state: EditorState, tool: WallToolState): EditorState {
  return tool.kind === "idle" ? switchTool(state, "select") : { ...state, tool: idleTool("wall"), snap: null };
}
```

`packages/editor/src/tools/select-tool.ts` (Task 3.12 replaces this file):

```ts
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { idleTool, type SelectToolState } from "./types";

// Stub: Task 3.12 replaces this file.
export function selectPointer(state: EditorState, _tool: SelectToolState, _e: PointerInput, _host: Host): Step {
  return { state, effects: [] };
}

export function selectKey(_state: EditorState, _tool: SelectToolState, _key: string, _host: Host): Step | null {
  return null;
}

export function selectEscape(state: EditorState, tool: SelectToolState): EditorState {
  return tool.kind === "idle" ? { ...state, selection: [] } : { ...state, tool: idleTool("select"), snap: null };
}
```

`packages/editor/src/tools/zone-tool.ts` (phase 5 replaces this file):

```ts
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import type { ZoneToolState } from "./types";

// Placeholder: phase 5 replaces this file with the Zone tool (spec §3.6, §5.6).
export function zonePointer(state: EditorState, _tool: ZoneToolState, _e: PointerInput, _host: Host): Step {
  return { state: { ...state, snap: null }, effects: [] };
}

/** Properties-panel edits (`ui setField`). Phase 5 implements the zone `name` field (renameZone). */
export function setField(state: EditorState, _fieldId: string, _value: string, _host: Host): Step {
  return { state, effects: [] };
}
```

`packages/editor/src/session.ts` (phase 7 replaces this file):

```ts
import type { Effect } from "./ports/effects";
import type { ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";

// Placeholder: phase 7 replaces this file with the project list, opening, connection handling,
// SharedDocument events and presence (spec §7.2.1, §7.4, §7.6).
export type WorkspaceUiAction = Extract<UiAction, { type: "createProject" | "openProject" | "showProjectList" }>;

export function onWorkspaceEvent(state: EditorState, _event: WorkspaceEvent, _host: Host): Step {
  return { state, effects: [] };
}

export function onServerEvent(state: EditorState, _event: ServerEvent, _host: Host): Step {
  return { state, effects: [] };
}

export function onWorkspaceUi(state: EditorState, _action: WorkspaceUiAction, _host: Host): Step {
  return { state, effects: [] };
}

/** Presence effects after a pointer move (shared documents only). */
export function pointerPresence(_state: EditorState): Effect[] {
  return [];
}
```

- [x] **Step 5: Implement** `packages/editor/src/keys.ts`

```ts
import { assertNever } from "@fm/protocol";
import { runCommand, runHistory } from "./commit";
import { followCamera } from "./pointer";
import type { Host } from "./ports/host";
import { switchTool, type EditorState, type Step } from "./state";
import { selectEscape, selectKey } from "./tools/select-tool";
import { wallEscape, wallKey } from "./tools/wall-tool";
import type { Mods, ToolName } from "./types";

/** Precedence (spec §5.4): (1) the active value field, (2) command codes, (3) global shortcuts. */
export function onKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  const captured = valueField(state, key, host);
  if (captured) return captured;
  const tool = commandCode(key, mods);
  if (tool) return { state: switchTool(state, tool), effects: [] };
  return globalKey(state, key, mods, host);
}

export function commandCode(key: string, mods: Mods): ToolName | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  switch (key.toLowerCase()) {
    case "v":
      return "select";
    case "w":
      return "wall";
    case "z":
      return "zone";
    default:
      return null;
  }
}

function valueField(state: EditorState, key: string, host: Host): Step | null {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallKey(state, tool.state, key, host);
    case "select":
      return selectKey(state, tool.state, key, host);
    case "zone":
      return null;
    default:
      return assertNever(tool);
  }
}

function globalKey(state: EditorState, key: string, mods: Mods, host: Host): Step {
  const command = mods.meta || mods.ctrl;
  if (key === "Escape") return { state: escape(state), effects: [] };
  if (command && key.toLowerCase() === "z") return undoRedo(state, mods.shift ? "redo" : "undo", host);
  if (command && key.toLowerCase() === "s") return { state, effects: [] }; // saves a local file with X1; no-op now
  if ((key === "Delete" || key === "Backspace") && !command) return deleteSelection(state, host);
  return { state, effects: [] };
}

/**
 * Undo and redo (keys or toolbar). A refused request only shows its toast. An applied one drops the
 * gesture in progress, since a wall chain's preview or a drag's attempt was built on the document
 * before it and a chain must not continue from an undone joint, then replays the pointer so hover,
 * snap and the idle preview are rebuilt on the new document. Only an applied request replaces the
 * document object.
 */
export function undoRedo(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const r = runHistory(state, direction, host);
  if (r.state.document === state.document) return r;
  const replay = followCamera(switchTool(r.state, r.state.tool.name), host);
  return { state: replay.state, effects: [...r.effects, ...replay.effects] };
}

/** Esc cancels the current operation; a second Esc returns to Select (spec §5.4). */
function escape(state: EditorState): EditorState {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallEscape(state, tool.state);
    case "select":
      return selectEscape(state, tool.state);
    case "zone":
      return switchTool(state, "select");
    default:
      return assertNever(tool);
  }
}

/** In the Select tool (idle) the selection; in the Zone tool only a selected zone (spec §5.4). */
function deleteSelection(state: EditorState, host: Host): Step {
  const tool = state.tool;
  const ids =
    tool.name === "select" && tool.state.kind === "idle"
      ? state.selection
      : tool.name === "zone"
        ? state.selection.filter((r) => r.table === "zoneLabels")
        : [];
  if (ids.length === 0) return { state, effects: [] };
  const out = runCommand(state, { type: "deleteEntities", ids }, host);
  return { state: out.state, effects: out.effects };
}
```

- [x] **Step 5b: Implement** `packages/editor/src/pointer.ts` (added by the wave 6 reviews: pointer routing shared by `update.ts` and `keys.ts`; the cursor follows the camera, spec §5.4)

```ts
import { assertNever } from "@fm/protocol";
import { panBy, screenToWorld } from "./camera";
import type { PointerInput } from "./ports/events";
import type { Host } from "./ports/host";
import { pointerPresence } from "./session";
import type { EditorState, Step } from "./state";
import { selectPointer } from "./tools/select-tool";
import { wallPointer } from "./tools/wall-tool";
import { zonePointer } from "./tools/zone-tool";

export function onPointer(state: EditorState, e: PointerInput, host: Host): Step {
  if (e.type === "pointerDown" && e.button === 1) return { state: { ...withPointer(state, e), panDrag: e.screen }, effects: [] };
  if (state.panDrag) {
    // Any pointerUp ends a pan; the tool missed the pan's moves, so it catches up now.
    if (e.type === "pointerUp") return followCamera({ ...withPointer(state, e), panDrag: null }, host);
    // A grab pan keeps the same world point under the cursor, so there is no presence to send.
    const camera = panBy(state.camera, e.screen.x - state.panDrag.x, e.screen.y - state.panDrag.y);
    return { state: withPointer({ ...state, camera, panDrag: e.screen }, e), effects: [] };
  }
  const s = withPointer(state, e);
  const r = e.button === 2 ? { state: s, effects: [] } : toolPointer(s, e, host); // no context menu in the initial build
  return e.type === "pointerMove" ? { state: r.state, effects: [...r.effects, ...pointerPresence(r.state)] } : r;
}

/**
 * After the camera moves under a still cursor, replays the last pointer position (spec §5.3) as a
 * move, so `pointer.world`, the tool's preview, snap and hover, and presence follow the cursor; a
 * typed length then uses the current cursor direction (spec §5.5). During a middle-drag pan only
 * `pointer.world` and presence follow; the tool is told when the pan ends. Without a pointer yet,
 * nothing changes. An applied undo or redo also replays, so the tool rebuilds on the new document.
 */
export function followCamera(state: EditorState, host: Host): Step {
  const p = state.pointer;
  if (!p) return { state, effects: [] };
  const e: PointerInput = { type: "pointerMove", screen: p.screen, mods: p.mods, button: 0 };
  if (!state.panDrag) return onPointer(state, e, host);
  const s = withPointer(state, e);
  return { state: s, effects: pointerPresence(s) };
}

/** Records the pointer under the current camera; call it after any camera change. */
function withPointer(state: EditorState, e: PointerInput): EditorState {
  return { ...state, pointer: { screen: e.screen, world: screenToWorld(state.camera, e.screen), mods: e.mods } };
}

function toolPointer(state: EditorState, e: PointerInput, host: Host): Step {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallPointer(state, tool.state, e, host);
    case "select":
      return selectPointer(state, tool.state, e, host);
    case "zone":
      return zonePointer(state, tool.state, e, host);
    default:
      return assertNever(tool);
  }
}
```

- [x] **Step 6: Implement** `packages/editor/src/update.ts`

```ts
import { assertNever } from "@fm/protocol";
import { panBy, zoomAt, type Camera } from "./camera";
import { onKey, undoRedo } from "./keys";
import { followCamera, onPointer } from "./pointer";
import type { Effect } from "./ports/effects";
import type { Event, UiAction } from "./ports/events";
import type { Host } from "./ports/host";
import { onServerEvent, onWorkspaceEvent, onWorkspaceUi } from "./session";
import { switchTool, type EditorState, type Step } from "./state";
import { TOAST_TIMER, onToastTimer } from "./toast";
import { setField } from "./tools/zone-tool";
import { buildScene } from "./view/scene";
import { buildViewModel } from "./view/view-model";

/** The core loop (spec §5.1): synchronous, pure given the Host, one trailing render effect. */
export function update(state: EditorState, event: Event, host: Host): Step {
  const r = step(state, event, host);
  const render: Effect = {
    type: "render",
    scene: buildScene(r.state, host),
    view: buildViewModel(r.state, host),
    camera: r.state.camera,
  };
  return { state: r.state, effects: [...r.effects, render] };
}

function step(state: EditorState, event: Event, host: Host): Step {
  switch (event.type) {
    case "pointerDown":
    case "pointerMove":
    case "pointerUp":
      return onPointer(state, event, host);
    case "wheel":
      return followCamera({ ...state, camera: wheelCamera(state.camera, event) }, host);
    case "key":
      return onKey(state, event.key, event.mods, host);
    case "ui":
      return onUi(state, event.action, host);
    case "timerFired":
      return event.timerId === TOAST_TIMER ? onToastTimer(state, host) : { state, effects: [] };
    case "workspaceEvent":
      return onWorkspaceEvent(state, event.event, host);
    case "serverEvent":
      return onServerEvent(state, event.event, host);
    case "saveResult":
      return { state, effects: [] }; // X1 local files
    case "viewportResized":
      return followCamera({ ...state, camera: { ...state.camera, viewport: event.size, dpr: event.devicePixelRatio } }, host);
    default:
      return assertNever(event);
  }
}

/** Ctrl/⌘ or a pinch zooms at the cursor; otherwise the wheel pans (spec §5.4). */
function wheelCamera(camera: Camera, e: Extract<Event, { type: "wheel" }>): Camera {
  return e.mods.ctrl || e.mods.meta ? zoomAt(camera, e.screen, Math.exp(-e.deltaY * 0.01)) : panBy(camera, -e.deltaX, -e.deltaY);
}

function onUi(state: EditorState, action: UiAction, host: Host): Step {
  switch (action.type) {
    case "pickTool":
      return { state: switchTool(state, action.tool), effects: [] };
    case "undo":
    case "redo":
      return undoRedo(state, action.type, host);
    case "setField":
      return setField(state, action.fieldId, action.value, host);
    case "createProject":
    case "openProject":
    case "showProjectList":
      return onWorkspaceUi(state, action, host);
    default:
      return assertNever(action);
  }
}
```

- [x] **Step 7: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/update.test.ts`
Expected: PASS (34 tests: the plan's 11, 9 routing tests from the wave 6 mutation check, 14 from the wave 6 spec review).

- [x] **Step 8: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: update loop, key precedence, fake shell; tool and session stubs"
```

---

### Task 3.11: Wall tool (spec §5.5)

Every row of the first §5.5 table. Placements happen on `pointerDown` ("click at q"). The preview runs `execute(addWall)` on the visible document at each pointer move; an invalid preview is drawn red, and nothing is committed without a new click or `Enter` and a fresh `execute`. A typed length follows the current cursor direction after snapping and `Shift`. The `paused` state is entered only when the committed segment is still pending, which never happens with a `LocalDocument`; phase 7 adds the resume rule.

**Files:** Replace `packages/editor/src/tools/wall-tool.ts`. Create `packages/editor/test/wall-tool.test.ts`.

**Tests carried over from wave 6** (add them to `wall-tool.test.ts` besides the plan's; the wave 6 review found them unpinnable with the stubs): a right-button `pointerDown` leaves the wall tool `idle` (update.test.ts's right-button test only sees the zone placeholder, which phase 5 replaces); in `drawing`, a plain wheel pan then `6 Enter` places the wall along the direction to the cursor's new world point (spec §5.4 "The cursor follows the camera"); `Cmd+Z` while `drawing` after one placed wall removes it and leaves the tool `idle`; after that undo the snap glyph at the unmoved cursor is rebuilt on the new document (the pointer replay in `undoRedo`, unobservable with the stubs; drop the `followCamera` call and it must fail).

- [x] **Step 1: Write the failing test** `packages/editor/test/wall-tool.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { jointAt, wallBetween, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function wall(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "wall") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

const wallCount = (shell: FakeShell) => Object.keys(shell.doc().walls).length;

function drawing(): FakeShell {
  const shell = FakeShell.local();
  shell.key("w");
  shell.click({ x: 0, y: 0 });
  return shell;
}

describe("wall tool (spec §5.5)", () => {
  it("starts a chain on the first click without adding a wall", () => {
    const shell = drawing();
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "" });
    expect(wallCount(shell)).toBe(0);
  });

  it("adds a wall per click and continues from its end; a local document never pauses", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 } });
    expect(shell.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
  });

  it("places a typed length along the Shift-constrained cursor direction", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 0.3 }, { shift: true });
    shell.type("6");
    shell.key("Enter");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 6, y: 0 }, value: "" });
  });

  it("without Shift, uses the raw snapped cursor direction", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 4 });
    shell.type("5");
    shell.key("Enter");
    jointAt(shell.doc(), { x: 3, y: 4 }); // 5 m along (0.6, 0.8)
  });

  it("edits the typed value with Backspace", () => {
    const shell = drawing();
    shell.type("65");
    shell.key("Backspace");
    expect(shell.view().commandBar).toEqual({ prompt: "Next point or length", value: "6", unit: "m" });
  });

  it("finishes the chain on an empty Enter", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.key("Enter");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(wallCount(shell)).toBe(1);
  });

  it("confirms with Space like Enter", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0.1 }, { shift: true });
    shell.type("2");
    shell.key(" ");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
  });

  it("closes the chain when the first joint is clicked", () => {
    const shell = drawing();
    for (const p of [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }]) shell.click(p);
    expect(wallCount(shell)).toBe(4);
    expect(Object.keys(shell.doc().joints)).toHaveLength(4);
    expect(wall(shell)).toEqual({ kind: "idle" });
  });

  it("leaves the tool unchanged and shows a toast when addWall is rejected", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    shell.key("w");
    shell.click({ x: 1, y: 0 });
    shell.click({ x: 5, y: 0 }); // collinear with the existing wall
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 1, y: 0 } });
    expect(shell.view().toast).toBe(MESSAGES.overlap);
  });

  it("refuses a length that is not a positive number", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0.1 });
    shell.type(".");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(wallCount(shell)).toBe(0);
  });

  it("previews the new wall with its live length, and draws an invalid preview red", () => {
    const shell = drawing();
    shell.moveTo({ x: 2, y: 0.05 });
    const scene = shell.scene();
    const layer = (name: string) => scene.layers.find((l) => l.name === name)?.primitives ?? [];
    expect(layer("walls").some((p) => p.kind === "polygon" && p.color === COLORS.preview)).toBe(true);
    expect(layer("annotations").some((p) => p.kind === "text" && p.text.startsWith("2.00 m"))).toBe(true);

    const blocked = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    blocked.key("w");
    blocked.click({ x: 1, y: 0 });
    blocked.moveTo({ x: 5, y: 0 });
    const overlays = blocked.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "segment" && p.color === COLORS.invalid && "m" in p.width)).toBe(true);
  });

  it("ends the chain on Esc but keeps its walls; a second Esc returns to Select", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.key("Escape");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(wallCount(shell)).toBe(1);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("prompts for the next step in the command bar", () => {
    const shell = FakeShell.local();
    shell.key("w");
    expect(shell.view().commandBar.prompt).toBe("First point");
    shell.click({ x: 0, y: 0 });
    expect(shell.view().commandBar.prompt).toBe("Next point or length");
  });
});

describe("wall tool: routing carried over from wave 6 (spec §5.4)", () => {
  it("ignores a right-button press", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.down({ x: 0, y: 0 }, {}, 2);
    expect(wall(shell)).toEqual({ kind: "idle" });
  });

  it("types a length along the direction to the cursor's world point after a wheel pan", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 0 });
    shell.wheel(0, -320); // pans 4 m at zoom 80: the still cursor is now over (3, 4)
    shell.type("6");
    shell.key("Enter");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 3.6, y: 4.8 });
  });

  it("drops the chain on an applied undo and rebuilds the snap at the unmoved cursor", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    expect(shell.view().snap).toEqual({ kind: "endpoint", at: { x: 2, y: 0 } });
    shell.key("z", { meta: true });
    expect(wallCount(shell)).toBe(0);
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(shell.view().snap).toEqual({ kind: "grid", at: { x: 2, y: 0 } });
  });
});

describe("wall tool: further §5.5 rules", () => {
  it("places points on the press, before any release", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.down({ x: 0, y: 0 });
    shell.moveTo({ x: 2, y: 0 });
    shell.down({ x: 2, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
  });

  it("snaps clicked points, and places them raw while Ctrl is held", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0.03, y: -0.02 }); // within 10 px of the grid point (0, 0)
    shell.click({ x: 2.03, y: 0.07 }, { ctrl: true });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2.03, y: 0.07 });
  });

  it("refuses a zero length", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0 });
    shell.type("0");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(wallCount(shell)).toBe(0);
  });

  it("keeps the typed value when the typed wall is rejected", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    shell.key("w");
    shell.click({ x: 1, y: 0 });
    shell.moveTo({ x: 4, y: 0 });
    shell.type("2");
    shell.key("Enter"); // (1, 0) → (3, 0) overlaps the existing wall
    expect(shell.view().toast).toBe(MESSAGES.overlap);
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 1, y: 0 }, value: "2" });
  });

  it("does not close the chain when a typed length lands on its first joint", () => {
    const shell = drawing();
    shell.click({ x: 3, y: 0 });
    shell.click({ x: 3, y: 4 });
    shell.moveTo({ x: 0, y: 0 });
    shell.type("5");
    shell.key("Enter");
    expect(wallCount(shell)).toBe(3);
    expect(Object.keys(shell.doc().joints)).toHaveLength(3);
    expect(wall(shell)).toMatchObject({ kind: "drawing", chainStart: { x: 0, y: 0 }, value: "" });
  });

  it("previews from the new origin to the cursor right after a typed placement", () => {
    const shell = drawing();
    shell.moveTo({ x: 0, y: 4 });
    shell.type("2");
    shell.key("Enter");
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 2 }, preview: { ok: true, from: { x: 0, y: 2 }, to: { x: 0, y: 4 } } });
  });

  // Review fix: each test below kills a named mutant.
  it("places a click at the clicked point and clears a typed value", () => {
    const shell = drawing();
    shell.type("3");
    shell.click({ x: 2, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, value: "" });
  });

  it("clears the snap glyph on Esc", () => {
    const shell = drawing();
    shell.moveTo({ x: 2, y: 0 });
    expect(shell.state.snap).not.toBeNull();
    shell.key("Escape");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(shell.state.snap).toBeNull();
  });

  // Wave 7 code review: each test below is red on the reviewed code or kills a named mutant.
  it("refuses a typed length while the cursor rests on the origin", () => {
    const shell = drawing(); // the cursor is still on the origin
    shell.type("5");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Move the cursor to set a direction");
    expect(wallCount(shell)).toBe(0);
  });

  it("refuses a typed length exactly when there is no preview: cursor within 1 mm of the origin", () => {
    const shell = drawing();
    shell.moveTo({ x: 0.0005, y: 0 }, { ctrl: true }); // raw cursor 0.5 mm from the origin
    expect(wall(shell)).toMatchObject({ kind: "drawing", preview: null });
    shell.type("3");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Move the cursor to set a direction");
    expect(wallCount(shell)).toBe(0);
  });

  it("ignores a click on the chain's last point: no wall, no toast, value and preview kept", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.type("3");
    const before = wall(shell);
    shell.click({ x: 2, y: 0 });
    expect(wall(shell)).toEqual(before);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, value: "3" });
    expect(wallCount(shell)).toBe(1);
    expect(shell.state.toast).toBeNull();

    const first = drawing();
    first.click({ x: 0, y: 0 }); // the chain's first point is also its last
    expect(wall(first)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 } });
    expect(first.state.toast).toBeNull();
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/wall-tool.test.ts`
Expected: FAIL; the stub never leaves `idle` (first failure: `expected { kind: 'idle' } to match object { kind: 'drawing', … }`).

- [x] **Step 3: Replace** `packages/editor/src/tools/wall-tool.ts`

```ts
import { EPS, add, distance, execute, normalize, scale, sub, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import { isPendingEntry } from "../history/history";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { snapPoint } from "../snapping/snap";
import { switchTool, type EditorState, type Step } from "../state";
import { showToast } from "../toast";
import type { SnapResult } from "../types";
import { PREVIEW_OP, type WallPreview, type WallToolState } from "./types";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;

/** Spec §5.5. A click is a pointerDown at the snapped point. */
export function wallPointer(state: EditorState, tool: WallToolState, e: PointerInput, host: Host): Step {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc) return { state, effects: [] };
  switch (tool.kind) {
    case "idle": {
      const snap = snapCursor(state, doc, null);
      const next: WallToolState =
        e.type === "pointerDown" ? { kind: "drawing", origin: snap.point, chainStart: snap.point, value: "", preview: null } : tool;
      return { state: withWall(state, next, snap), effects: [] };
    }
    case "drawing": {
      const snap = snapCursor(state, doc, tool.origin);
      if (e.type === "pointerDown") {
        // A click on the origin (e.g. a double click) is ignored: no wall, no toast, value and preview kept.
        if (onOrigin(tool.origin, snap.point)) return { state: withWall(state, tool, snap), effects: [] };
        return placePoint(withWall(state, tool, snap), tool, snap.point, true, host);
      }
      const preview = e.type === "pointerMove" ? previewWall(doc, tool.origin, snap.point) : tool.preview;
      return { state: withWall(state, { ...tool, preview }, snap), effects: [] };
    }
    case "paused":
      // Shared documents (phase 7): the cursor is tracked, there is no preview, clicks are ignored and never queued.
      return { state: withWall(state, tool, null), effects: [] };
    default:
      return assertNever(tool);
  }
}

/** The value field of the wall tool (spec §5.4 precedence 1). Returns null when the key is not captured. */
export function wallKey(state: EditorState, tool: WallToolState, key: string, host: Host): Step | null {
  switch (tool.kind) {
    case "idle":
      return null;
    case "paused":
      return isValueKey(key) ? { state, effects: [] } : null; // ignored, never queued
    case "drawing":
      if (/^[0-9]$/.test(key) || key === ".") return { state: withWall(state, { ...tool, value: tool.value + key }, state.snap), effects: [] };
      if (key === "Backspace") return { state: withWall(state, { ...tool, value: tool.value.slice(0, -1) }, state.snap), effects: [] };
      if (key === "Enter" || key === " ") {
        return tool.value === "" ? { state: withWall(state, { kind: "idle" }, state.snap), effects: [] } : placeTyped(state, tool, host);
      }
      return null;
    default:
      return assertNever(tool);
  }
}

/** Esc: drawing or paused → idle (walls already added stay; a submitted wall still settles); idle → Select. */
export function wallEscape(state: EditorState, tool: WallToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return switchTool(state, "select");
    case "drawing":
    case "paused":
      return withWall(state, { kind: "idle" }, null);
    default:
      return assertNever(tool);
  }
}

/** Preview of the wall from `from` to `to` on the visible document; null while the cursor is on the origin. */
export function previewWall(doc: Document, from: Point, to: Point): WallPreview | null {
  if (onOrigin(from, to)) return null;
  const r = execute(doc, { type: "addWall", opId: PREVIEW_OP, from: { at: from }, to: { at: to } });
  return r.ok
    ? { from, to, ok: true, doc: r.value.doc }
    : { from, to, ok: false };
}

/**
 * Enters drawing at `origin` with a preview to the current cursor, exactly as on a pointer move.
 * Phase 7's resume rule (spec §5.5) calls this after checking the anchor joint.
 */
export function drawingAt(state: EditorState, origin: Point, chainStart: Point): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc || !state.pointer) return withWall(state, { kind: "drawing", origin, chainStart, value: "", preview: null }, null);
  const snap = snapCursor(state, doc, origin);
  return withWall(state, { kind: "drawing", origin, chainStart, value: "", preview: previewWall(doc, origin, snap.point) }, snap);
}

function placePoint(state: EditorState, tool: Drawing, q: Point, isClick: boolean, host: Host): Step {
  const closes = isClick && distance(q, tool.chainStart) < EPS;
  const to = closes ? tool.chainStart : q;
  const out = runCommand(state, { type: "addWall", opId: host.newId(), from: { at: tool.origin }, to: { at: to } }, host);
  if (out.committed === null) return { state: out.state, effects: out.effects }; // rejected: tool unchanged, toast shown
  if (closes) return { state: withWall(out.state, { kind: "idle" }, out.state.snap), effects: out.effects };
  const next = isPendingEntry(out.state.undo, out.committed)
    ? withWall(out.state, { kind: "paused", origin: to, chainStart: tool.chainStart, segment: out.committed }, null)
    : drawingAt(out.state, to, tool.chainStart);
  return { state: next, effects: out.effects };
}

/** Enter/Space with a value: q = origin + v · direction, where direction comes from the snapped cursor. */
function placeTyped(state: EditorState, tool: Drawing, host: Host): Step {
  const length = Number(tool.value);
  if (!Number.isFinite(length) || length <= 0) return showToast(state, "Type a length in metres", host);
  const doc = state.document ? visibleDoc(state.document) : null;
  const cursor = doc ? snapCursor(state, doc, tool.origin).point : tool.origin; // no pointer yet: snapCursor gives the origin
  const dir = onOrigin(tool.origin, cursor) ? null : normalize(sub(cursor, tool.origin)); // as previewWall
  if (!dir) return showToast(state, "Move the cursor to set a direction", host);
  return placePoint(state, tool, add(tool.origin, scale(dir, length)), false, host);
}

function snapCursor(state: EditorState, doc: Document, origin: Point | null): SnapResult {
  const p = state.pointer;
  if (!p) return { point: origin ?? { x: 0, y: 0 }, kind: "none" };
  return snapPoint({ doc, cursor: p.world, camera: state.camera, mods: p.mods, origin, tolerancePx: state.snapSettings.tolerancePx });
}

/** The cursor is on the origin: no preview, no direction, and a click there is ignored. */
function onOrigin(origin: Point, p: Point): boolean {
  return distance(p, origin) < EPS;
}

function withWall(state: EditorState, tool: WallToolState, snap: SnapResult | null): EditorState {
  return { ...state, tool: { name: "wall", state: tool }, snap };
}

function isValueKey(key: string): boolean {
  return /^[0-9]$/.test(key) || key === "." || key === "Backspace" || key === "Enter" || key === " ";
}
```

Decisions this task codes (record them in `editor-interaction.md` if review changes any):

- Only a **click** on `chainStart` closes a chain, as the §5.5 table says; a typed length that happens to land on `chainStart` adds the wall and stays in `drawing`.
- A typed length uses the modifiers of the last pointer event (the `Shift` state the preview showed), not the modifiers of the `Enter` key event.

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/wall-tool.test.ts`
Expected: PASS (27 tests: the plan's 13, 3 carried from wave 6, 6 from the wave 7 mutation check, 2 from the wave 7 spec review, 3 from the wave 7 code review).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: wall tool with chained clicks, typed lengths, preview, closing and Esc"
```

---

### Task 3.12: Hit-testing and the Select tool (spec §5.6, §5.7)

A press hit-tests (handles of the selected wall first, then joints, then walls) and selects the hit at once (P10). Moving more than 4 px starts a drag. Every pointer move re-runs `moveJoints` on `baseDoc` as a preview; an invalid attempt keeps the last valid preview, draws the affected walls red and puts a ghost at the cursor. Release commits once through `runCommand`, a fresh `execute` on the visible document: an invalid result is refused with a toast and nothing is committed. A joint drag snaps the joint to the cursor (ignoring the joint and its walls); a wall drag moves both ends by a grid-rounded delta (`Shift` keeps one axis, `Ctrl` skips rounding).

**Files:** Create `packages/editor/src/tools/hit-test.ts`. Replace `packages/editor/src/tools/select-tool.ts`. Create `packages/editor/test/select-tool.test.ts`.

**Planned deviation (wave 6 code review).** The drag threshold is measured in world units at the current zoom, `distance(world, tool.pressWorld) * state.camera.zoom > DRAG_THRESHOLD_PX`, not between screen points: since the cursor follows the camera (spec §5.4), a scroll during `pressing` otherwise leaves the press "still" and the next 5 px move jumps the entity back under the cursor (2.4 m after a 200 px scroll), while in `moving` a scroll moves it at once. A scroll mid-press now starts the drag; a zoom at the cursor does not. `pressScreen` goes from `SelectToolState` (`tools/types.ts`, the Task 3.7 block, README contract, update.test.ts's hand-built `pressing` state and phase 5's copies of `press`/`move`). Red test first: press on a wall, wheel 200 px, move 5 px: the wall's joints move by the scroll, not by 2.4 m in the other direction.

**Tests carried over from wave 6:** `Cmd+Z` mid-drag (`moving`, after an earlier committed edit) undoes that edit, returns the tool to `idle`, and the following `pointerUp` commits nothing; rewrite update.test.ts's hand-built `pressing`/`moving` states as gestures if they get in the way.

- [x] **Step 1: Write the failing test** `packages/editor/test/select-tool.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { NO_MODS } from "../src/types";
import { COLORS } from "../src/view/colors";
import { dividedRoomDoc, jointAt, localState, pointOf, roomDoc, wallBetween, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function selectState(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "select") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

function wallsLayer(shell: FakeShell) {
  return shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
}

describe("select tool (spec §5.6)", () => {
  it("selects a wall on click, shows its properties, and clears on empty space", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("4.00");
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([]);
  });

  it("selects a joint on click", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 4 });
    expect(shell.state.selection).toEqual([{ table: "joints", id: corner }]);
  });

  it("selects and drags an unselected wall in one press, as one undo entry", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const doc = shell.doc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const top = jointAt(doc, { x: 6, y: 4 });
    const bottom = jointAt(doc, { x: 6, y: 0 });
    shell.drag({ x: 6, y: 2 }, { x: 6.6, y: 2 });
    expect(pointOf(shell.doc(), top).x).toBeCloseTo(6.6, 9);
    expect(pointOf(shell.doc(), bottom).x).toBeCloseTo(6.6, 9);
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("drags a handle of the selected wall and keeps the wall selected", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("does not drag below the 4 px threshold", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 6.03, y: 2 }); // 2.4 px at 80 px/m
    shell.up({ x: 6.03, y: 2 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("draws an invalid drag red, reverts on release, adds no history and explains why", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 }); // still valid
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    const moving = selectState(shell);
    expect(moving.kind === "moving" && moving.attempt.ok).toBe(false);
    expect(wallsLayer(shell).some((p) => p.kind === "polygon" && p.color === COLORS.invalid)).toBe(true);
    shell.up({ x: 2, y: 2 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("cancels a drag on Esc", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 5 });
    expect(shell.state.snap).not.toBeNull(); // added in self-review: Esc clears the snap glyph
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.snap).toBeNull();
    shell.up({ x: 6, y: 5 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("deletes the selected wall and the joints it leaves unused", () => {
    const single = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }));
    single.click({ x: 1, y: 0 });
    single.key("Delete");
    expect(single.doc()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });

    const room = FakeShell.withDocument(roomDoc());
    room.click({ x: 6, y: 2 });
    room.key("Backspace");
    expect(Object.keys(room.doc().walls)).toHaveLength(3);
    expect(Object.keys(room.doc().joints)).toHaveLength(4); // both ends still belong to other walls
  });

  it("highlights the wall under the cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 2 });
    expect(shell.state.hover).toEqual({ table: "walls", id: right });
    expect(shell.view().cursor).toBe("pointer");
    expect(wallsLayer(shell).some((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toBe(true);
  });

  it("clears the selection on Esc when idle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 2 });
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
  });

  // Added in self-review: each test below kills a mutation the plan's tests let survive.
  it("moves a wall by the grid-rounded delta; Shift keeps the larger axis; Ctrl skips rounding", () => {
    const corner = { x: 6, y: 4 };
    const plain = FakeShell.withDocument(roomDoc());
    plain.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.05 }); // 0.2 m grid at 80 px/m
    expect(pointOf(plain.doc(), jointAt(roomDoc(), corner))).toEqual({ x: 6.6, y: 4 });

    const shift = FakeShell.withDocument(roomDoc());
    shift.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.3 }, { shift: true });
    expect(pointOf(shift.doc(), jointAt(roomDoc(), corner))).toEqual({ x: 6.6, y: 4 });

    const ctrl = FakeShell.withDocument(roomDoc());
    ctrl.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.05 }, { ctrl: true });
    const moved = pointOf(ctrl.doc(), jointAt(roomDoc(), corner));
    expect(moved.x).toBeCloseTo(6.63, 9);
    expect(moved.y).toBeCloseTo(4.05, 9);
  });

  it("snaps a dragged joint, ignoring the joint itself and its own walls", () => {
    // Off-grid joint: dragged 7 px away, it would snap back onto itself if not excluded.
    const single = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 2.03, y: 1 }));
    const end = jointAt(single.doc(), { x: 2.03, y: 1 });
    single.drag({ x: 2.03, y: 1 }, { x: 2.12, y: 1.02 }); // 10.6 and 5.1 grid steps: no rounding tie
    expect(pointOf(single.doc(), end)).toEqual({ x: 2.2, y: 1 }); // the grid

    // 4 px above its own top wall: it would snap onto that wall (5.45, 4) instead of the grid (5.4, 4).
    const room = FakeShell.withDocument(roomDoc());
    const corner = jointAt(room.doc(), { x: 6, y: 4 });
    room.drag({ x: 6, y: 4 }, { x: 5.45, y: 4.05 });
    expect(pointOf(room.doc(), corner)).toEqual({ x: 5.4, y: 4 });
  });

  it("keeps the last valid preview while the attempt is invalid, and clears the snap on release", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 });
    shell.moveTo({ x: 2, y: 2 });
    const moving = selectState(shell);
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, corner)).toEqual({ x: 4, y: 3 });
    expect(shell.state.snap).not.toBeNull();
    shell.up({ x: 2, y: 2 });
    expect(shell.state.snap).toBeNull();
  });

  // Planned deviation (wave 6 code review): the threshold is in world units at the current zoom.
  it("starts a drag when a scroll moves the camera under a still press, so the wall follows the cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    const bottom = jointAt(shell.doc(), { x: 6, y: 0 });
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.wheel(0, 204); // the content moves 204 px up: the cursor is now 2.55 m lower, over (6, -0.55)
    const moving = selectState(shell);
    expect(moving.kind).toBe("moving");
    // -2.55 m rounded to the 0.2 m grid at 80 px/m (-12.75 steps: no rounding tie)
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, top)).toEqual({ x: 6, y: 1.4 });
    const cursor = shell.state.pointer?.world ?? { x: 0, y: 0 };
    shell.moveTo({ x: cursor.x + 5 / 80, y: cursor.y }); // 5 px to the right
    shell.up({ x: cursor.x + 5 / 80, y: cursor.y });
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 1.4 });
    expect(pointOf(shell.doc(), bottom)).toEqual({ x: 6, y: -2.6 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("does not start a drag on a zoom at the cursor, and measures the threshold at the current zoom", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.wheel(0, -100, { ctrl: true }); // zoom in at the cursor: the world point under it stays put
    expect(selectState(shell).kind).toBe("pressing");
    shell.wheel(0, 100 + 100 * Math.log(2), { ctrl: true }); // back out to 40 px/m
    expect(shell.state.camera.zoom).toBeCloseTo(40, 6);
    expect(selectState(shell).kind).toBe("pressing");
    shell.moveTo({ x: 6 + 3 / 40, y: 2 }); // 3 px at 40 px/m (6 px at the default zoom)
    expect(selectState(shell).kind).toBe("pressing");
    shell.moveTo({ x: 6 + 5 / 40, y: 2 }); // 5 px
    expect(selectState(shell).kind).toBe("moving");
  });

  // Carried from wave 6: an applied undo drops the drag, so its release commits nothing.
  it("undoes the previous edit on Cmd+Z mid-drag, drops the drag, and commits nothing on release", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 2 }, { x: 6.6, y: 2 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.moveTo({ x: 6.6, y: 2 });
    shell.down({ x: 6.6, y: 2 });
    shell.moveTo({ x: 7.2, y: 2 });
    expect(selectState(shell).kind).toBe("moving");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(roomDoc());
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.up({ x: 7.2, y: 2 });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.undo.future).toHaveLength(1);
  });

  // Review fix: release commits the moves of the last attempt, whatever the release point and mods.
  it("commits exactly what was last previewed when Shift is released before the button", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    const bottom = jointAt(shell.doc(), { x: 6, y: 0 });
    shell.moveTo({ x: 6, y: 2 }, { shift: true });
    shell.down({ x: 6, y: 2 }, { shift: true });
    shell.moveTo({ x: 7, y: 2.6 }, { shift: true });
    const moving = selectState(shell);
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, top)).toEqual({ x: 7, y: 4 });
    shell.up({ x: 7, y: 2.6 }); // without Shift
    expect(pointOf(shell.doc(), top)).toEqual({ x: 7, y: 4 });
    expect(pointOf(shell.doc(), bottom)).toEqual({ x: 7, y: 0 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("commits the last preview when the release arrives at another point", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 6.6, y: 2 });
    shell.up({ x: 7.2, y: 2 }); // no move to the release point
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6.6, y: 4 });
  });

  it("refuses a red last attempt on release with its toast, even if the release point is valid", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 });
    shell.moveTo({ x: 2, y: 2 }); // red: the right wall would cross the divider
    shell.up({ x: 4, y: 3 }); // valid there, but the last attempt was (2, 2)
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  // Review fix: each test below kills a named mutant.
  it("keeps a Shift joint drag on the axis through the joint's start", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 4 }, { x: 7.03, y: 4.25 }, { shift: true }); // x dominates, so y stays 4
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 7, y: 4 });
  });

  it("places a Ctrl joint drag at the raw cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 4 }, { x: 6.63, y: 4.07 }, { ctrl: true });
    const moved = pointOf(shell.doc(), corner);
    expect(moved.x).toBeCloseTo(6.63, 9);
    expect(moved.y).toBeCloseTo(4.07, 9);
  });

  it("keeps y on a Shift wall drag when y dominates", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 2 }, { x: 6.05, y: 2.63 }, { shift: true });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
  });

  it("cancels a press on Esc, so a following move and release do nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.moveTo({ x: 6.6, y: 2 });
    shell.up({ x: 6.6, y: 2 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("clears the hover when the cursor leaves the entity", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    expect(shell.state.hover).not.toBeNull();
    shell.moveTo({ x: 3, y: 2 });
    expect(shell.state.hover).toBeNull();
  });

  it("stays pressing at exactly 4 px", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, camera: { ...shell.state.camera, center: { x: 0, y: 0 }, zoom: 80 } };
    shell.send({ type: "pointerDown", screen: { x: 600, y: 400 }, mods: NO_MODS, button: 0 }); // the joint at (0, 0)
    expect(selectState(shell).kind).toBe("pressing");
    shell.send({ type: "pointerMove", screen: { x: 604, y: 400 }, mods: NO_MODS, button: 0 }); // 0.05 m · 80 = 4 px
    expect(selectState(shell).kind).toBe("pressing");
  });

  it("grabs a handle of the selected wall 7 px from its joint (handles 8 px, other hits 6 px)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.drag({ x: 6, y: 4 + 7 / 80 }, { x: 6, y: 4.6 + 7 / 80 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 0, y: 4 }))).toEqual({ x: 0, y: 4 });
  });

  // Wave 7 code review: each test below is red on the reviewed code or kills a named mutant.
  it("grabs the nearest handle when both are in range", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 0.15, y: 0 }));
    const a = jointAt(shell.doc(), { x: 0, y: 0 });
    const b = jointAt(shell.doc(), { x: 0.15, y: 0 });
    shell.click({ x: 0.075, y: 0.05 }); // the wall: 4 px from it, 7.2 px from each joint
    shell.drag({ x: 0.09, y: 0 }, { x: 0.09, y: 1 }); // 7.2 px from a, 4.8 px from b
    expect(pointOf(shell.doc(), a)).toEqual({ x: 0, y: 0 });
    expect(pointOf(shell.doc(), b)).toEqual({ x: 0, y: 1 }); // the grid: 0.45 and 5 steps of 0.2 m
  });

  it("grabs endpoint a on an exact handle tie", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: -0.05, y: 0 }, { x: 0.05, y: 0 }));
    const a = jointAt(shell.doc(), { x: -0.05, y: 0 });
    const b = jointAt(shell.doc(), { x: 0.05, y: 0 });
    const wallId = wallBetween(shell.doc(), { x: -0.05, y: 0 }, { x: 0.05, y: 0 });
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallId }], camera: { ...shell.state.camera, center: { x: 0, y: 0 }, zoom: 80 } };
    shell.send({ type: "pointerDown", screen: { x: 600, y: 400 }, mods: NO_MODS, button: 0 }); // (0, 0): 4 px from each joint
    shell.send({ type: "pointerMove", screen: { x: 600, y: 320 }, mods: NO_MODS, button: 0 }); // 1 m away
    shell.send({ type: "pointerUp", screen: { x: 600, y: 320 }, mods: NO_MODS, button: 0 });
    expect(pointOf(shell.doc(), a)).toEqual({ x: 0, y: 1 }); // the grid
    expect(pointOf(shell.doc(), b)).toEqual({ x: 0.05, y: 0 });
  });

  it("keeps a Shift joint drag on the axis through the joint, not through an off-centre press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    // The press is 5.7 px from the joint; x dominates, so the axis is y = 4 and 1.03 m is 5.15 grid steps.
    // Through the press point it would be y = 4.05, 0.98 m from x = 6.05: the joint would land at (7.05, 4.05).
    shell.drag({ x: 6.05, y: 4.05 }, { x: 7.03, y: 4.3 }, { shift: true });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 7, y: 4 });
  });

  it("hits a free joint 5 px away but not 7 px away (6 px tolerance)", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 });
    const joint = jointAt(doc, { x: 0, y: 0 });
    const wallId = wallBetween(doc, { x: 0, y: 0 }, { x: 2, y: 0 });
    const near = FakeShell.withDocument(doc);
    near.click({ x: -5 / 80, y: 0 });
    expect(near.state.selection).toEqual([{ table: "joints", id: joint }]);
    const far = FakeShell.withDocument(doc);
    far.click({ x: -7 / 80, y: 0 }); // the wall still hits: its body adds half the thickness
    expect(far.state.selection).toEqual([{ table: "walls", id: wallId }]);
  });

  it("ends a press whose target left the document before the drag starts (phase 7: a remote delete)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    expect(selectState(shell)).toMatchObject({ kind: "pressing", target: { kind: "joint", jointId: corner } });
    const other = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }); // unreachable locally: state surgery
    expect(other.joints[corner]).toBeUndefined();
    shell.state = { ...shell.state, document: localState(shell.host, other).document };
    shell.moveTo({ x: 7, y: 4 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.up({ x: 7, y: 4 });
    expect(shell.doc()).toEqual(other);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.toast).toBeNull();
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test test/select-tool.test.ts`
Expected: FAIL; the stub selects nothing (first failure: `expected [] to deeply equal [ { table: 'walls', … } ]`).

- [x] **Step 3: Implement** `packages/editor/src/tools/hit-test.ts`

```ts
import { distance, hitCandidates, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { draggedJoints } from "./types";

export const DRAG_THRESHOLD_PX = 4; // spec §5.7
export const HIT_TOLERANCE_PX = 6;
export const HANDLE_HIT_PX = 8;

export type Hit = { ref: EntityRef; handle: boolean };

/** Handles of the selected wall win, then joints, then walls (spec §5.6). Phase 5 adds zone tags and floors. */
export function hitTest(state: EditorState, world: Point): Hit | null {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  const handle = handleHit(state, doc, world);
  if (handle) return handle;
  const first = hitCandidates(doc, world, HIT_TOLERANCE_PX / state.camera.zoom)[0];
  return first ? { ref: first, handle: false } : null;
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

- [x] **Step 4: Replace** `packages/editor/src/tools/select-tool.ts`

```ts
import { add, distance, execute, incidentWalls, sub, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { canCommit, visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { roundTo } from "../snapping/policies";
import { gridSpacingFor, orthogonalAxis, projectOnAxis, snapPoint } from "../snapping/snap";
import type { EditorState, Step } from "../state";
import { NO_MODS, type Mods, type SnapResult } from "../types";
import { DRAG_THRESHOLD_PX, hitTest } from "./hit-test";
import { draggedJoints, type DragTarget, type MoveAttempt, type Moves, type SelectToolState } from "./types";

type Moving = Extract<SelectToolState, { kind: "moving" }>;

/** Spec §5.6 and §5.7: press selects, a drag previews on baseDoc, release commits once. */
export function selectPointer(state: EditorState, tool: SelectToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  switch (e.type) {
    case "pointerDown":
      return { state: press(state, pointer.world), effects: [] };
    case "pointerMove":
      return { state: move(state, tool, pointer.world), effects: [] };
    case "pointerUp":
      return release(state, tool, host);
    default:
      return assertNever(e.type);
  }
}

/** The helper-dimension value field; phase 5 implements it for `editingHelper`. */
export function selectKey(_state: EditorState, _tool: SelectToolState, _key: string, _host: Host): Step | null {
  return null;
}

/** Esc: cancel a press, drag or helper edit; when idle, clear the selection. */
export function selectEscape(state: EditorState, tool: SelectToolState): EditorState {
  switch (tool.kind) {
    case "idle":
      return { ...state, selection: [] };
    case "pressing":
    case "moving":
    case "editingHelper":
      return withSelect({ ...state, snap: null }, { kind: "idle" });
    default:
      return assertNever(tool);
  }
}

function press(state: EditorState, world: Point): EditorState {
  const hit = hitTest(state, world);
  if (!hit) return withSelect({ ...state, selection: [] }, { kind: "idle" });
  const selection = hit.handle ? state.selection : [hit.ref]; // a handle keeps its wall selected
  return withSelect({ ...state, selection }, { kind: "pressing", pressWorld: world, target: dragTarget(hit.ref) });
}

function move(state: EditorState, tool: SelectToolState, world: Point): EditorState {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
      return { ...state, hover: hitTest(state, world)?.ref ?? null };
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
        attempt: { ok: false, doc: baseDoc, cursor: world, moves: [] }, // replaced by the first attempt below, or the press ends
      };
      return attemptMove(state, start, world);
    }
    case "moving":
      return attemptMove(state, tool, world);
    default:
      return assertNever(tool);
  }
}

/** Commits the last attempt's moves, as previewed; the release point and mods play no part. */
function release(state: EditorState, tool: SelectToolState, host: Host): Step {
  switch (tool.kind) {
    case "idle":
    case "editingHelper":
      return { state, effects: [] };
    case "pressing":
      return { state: withSelect(state, { kind: "idle" }), effects: [] };
    case "moving": {
      const idle = withSelect({ ...state, snap: null }, { kind: "idle" });
      const { moves } = tool.attempt;
      if (moves.length === 0) return { state: idle, effects: [] }; // unreachable (see attemptMove); moveJoints would toast
      // A fresh execute on the visible document: an invalid (red) attempt is a toast and no commit.
      const out = runCommand(idle, { type: "moveJoints", moves }, host);
      return { state: out.state, effects: out.effects };
    }
    default:
      return assertNever(tool);
  }
}

/** Each pointer move re-runs the command on baseDoc (spec §5.7). */
function attemptMove(state: EditorState, tool: Moving, world: Point): EditorState {
  const { moves, snap } = dragMoves(state, tool, world);
  // The target is not in baseDoc: it vanished during the press (phase 7: a remote delete). Nothing to drag.
  if (moves.length === 0) return withSelect({ ...state, snap: null }, { kind: "idle" });
  const r = execute(tool.baseDoc, { type: "moveJoints", moves });
  const attempt: MoveAttempt = { ok: r.ok, doc: r.ok ? r.value.doc : tool.attempt.doc, cursor: world, moves };
  return withSelect({ ...state, snap }, { ...tool, attempt });
}

/** A joint snaps to the cursor, ignoring itself and its walls; a wall moves by a grid-rounded delta. */
function dragMoves(state: EditorState, tool: Moving, world: Point): { moves: Moves; snap: SnapResult | null } {
  const doc = tool.baseDoc;
  const mods = state.pointer?.mods ?? NO_MODS;
  switch (tool.target.kind) {
    case "joint": {
      const id = tool.target.jointId;
      const j = doc.joints[id];
      if (!j) return { moves: [], snap: null };
      const snap = snapPoint({
        doc,
        cursor: world,
        camera: state.camera,
        mods,
        origin: { x: j.x, y: j.y },
        tolerancePx: state.snapSettings.tolerancePx,
        excludeJoints: new Set([id]),
        excludeWalls: new Set(incidentWalls(doc, id)),
      });
      return { moves: [{ jointId: id, to: snap.point }], snap };
    }
    case "wall": {
      const delta = gridDelta(sub(world, tool.pressWorld), gridSpacingFor(state.camera.zoom), mods);
      const moves: Moves = [];
      for (const id of draggedJoints(doc, tool.target)) {
        const j = doc.joints[id];
        if (j) moves.push({ jointId: id, to: add(j, delta) });
      }
      return { moves, snap: null };
    }
    default:
      return assertNever(tool.target);
  }
}

function gridDelta(d: Point, spacing: number, mods: Mods): Point {
  const constrained = mods.shift ? projectOnAxis(orthogonalAxis({ x: 0, y: 0 }, d), d) : d; // the larger axis
  return mods.ctrl ? constrained : { x: roundTo(constrained.x, spacing), y: roundTo(constrained.y, spacing) };
}

function dragTarget(ref: EntityRef): DragTarget | null {
  switch (ref.table) {
    case "joints":
      return { kind: "joint", jointId: ref.id };
    case "walls":
      return { kind: "wall", wallId: ref.id };
    case "zoneLabels":
      return null; // zone selection does not move walls (spec §5.6)
    default:
      return assertNever(ref.table);
  }
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
```

Note `assertNever(e.type)`, not `assertNever(e)`: `PointerInput` is one object type whose `type` is a union of three literals, so only `e.type` narrows to `never`.

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test test/select-tool.test.ts`
Expected: PASS (31 tests: the plan's 10, the wave 6 threshold and undo-mid-drag tests, 4 from the wave 7 mutation check, 10 from the wave 7 spec review, 5 from the wave 7 code review).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: select tool with hit-testing, handle drags, preview/commit gestures and delete"
```

---

### Task 3.13: Undo and redo scenarios

The wiring already exists: `Cmd+Z` / `Cmd+Shift+Z` and `ui undo`/`redo` call `undoRedo`, which runs `runHistory` (Tasks 3.8, 3.10). These scenarios pin the §9 editor rows and the §9 acceptance scenario "two moves, two undos, two redos restore each intermediate state". They should pass at once; a failure is a bug in Tasks 3.6, 3.8 or 3.12, fixed there and logged in the sprint log.

**Files:** Create `packages/editor/test/undo.test.ts`.

- [x] **Step 1: Write the test** `packages/editor/test/undo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument } from "@fm/domain";
import { jointAt, pointOf, roomDoc, wallBetween, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function corner(shell: FakeShell): string {
  return jointAt(shell.doc(), { x: 6, y: 4 });
}

describe("undo and redo (spec §7.5; a local document runs the plain stack)", () => {
  it("undoes a drag as one step", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const id = corner(shell);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(pointOf(shell.doc(), id)).toEqual({ x: 6, y: 4 });
  });

  it("restores each intermediate state across two moves, two undos and two redos", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const id = corner(shell);
    const at = () => pointOf(shell.doc(), id);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    expect(at()).toEqual({ x: 6, y: 5.2 });
    shell.key("z", { meta: true });
    expect(at()).toEqual({ x: 6, y: 4.6 });
    shell.key("z", { meta: true });
    expect(at()).toEqual({ x: 6, y: 4 });
    shell.key("z", { meta: true, shift: true });
    expect(at()).toEqual({ x: 6, y: 4.6 });
    shell.key("Z", { meta: true, shift: true });
    expect(at()).toEqual({ x: 6, y: 5.2 });
  });

  it("drives the toolbar buttons through canUndo and canRedo", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([false, false]);
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([true, false]);
    shell.ui({ type: "undo" });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([false, true]);
    shell.ui({ type: "redo" });
    expect([shell.view().canUndo, shell.view().canRedo]).toEqual([true, false]);
  });

  it("clears redo on a new edit", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    shell.key("z", { meta: true });
    shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    expect(shell.state.undo.future).toEqual([]);
    expect(shell.view().canRedo).toBe(false);
  });

  it("restores a deleted wall exactly", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 2 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().walls)).toHaveLength(3);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(roomDoc());
  });

  // Added in Task 3.13: whole-changeset undo of a delete that also removes joints, and of wall placements.
  it("restores a deleted free-standing wall with its joints and IDs, and redo deletes all three again", () => {
    const original = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    const shell = FakeShell.withDocument(original);
    shell.click({ x: 2, y: 0 });
    shell.key("Delete");
    expect(shell.doc()).toEqual(emptyDocument());
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(original);
    shell.key("z", { meta: true, shift: true });
    expect(shell.doc()).toEqual(emptyDocument());
  });

  it("undoes wall placements one at a time and drops an undone wall from the selection", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.click({ x: 2, y: 0 });
    const first = shell.doc();
    shell.click({ x: 2, y: 2 });
    const second = wallBetween(shell.doc(), { x: 2, y: 0 }, { x: 2, y: 2 });
    shell.key("Escape");
    shell.key("Escape");
    shell.click({ x: 2, y: 1 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: second }]);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(first);
    expect(shell.state.selection).toEqual([]);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(emptyDocument());
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/editor test test/undo.test.ts`
Expected: PASS (7 tests: the plan's 5 and 2 from the wave 8 mutation check). If one fails, fix the cause in the task that owns it, add a sprint-log row, and re-run the whole editor suite.

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: undo/redo scenarios for drags, deletes and the toolbar flags"
```

---

### Task 3.14: Demo scenario, public index and scene cost

**Files:** Create `packages/editor/test/scenarios/demo-steps.ts`, `packages/editor/test/scenarios/demo.test.ts`, `packages/editor/test/index.test.ts`, `packages/editor/test/perf.test.ts`. Replace `packages/editor/src/index.ts`.

- [x] **Step 1: Write the demo steps** `packages/editor/test/scenarios/demo-steps.ts` (plain helpers, not a test file, so phases 5 and 8 can reuse them):

```ts
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

/**
 * Demo step 3: with Shift held, from the bottom wall's midpoint to the top wall's midpoint, then finish.
 * Needs the Wall tool active and idle, as `drawRoom` leaves it.
 */
export function drawDivider(shell: FakeShell): void {
  const shift = { shift: true };
  shell.click({ x: 3.04, y: 0.03 }, shift); // midpoint snap → (3, 0)
  shell.click({ x: 3.1, y: 3.97 }, shift); // vertical axis + midpoint snap → (3, 4)
  shell.key("Enter");
}
```

- [x] **Step 2: Write the scenario test** `packages/editor/test/scenarios/demo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { COLORS } from "../../src/view/colors";
import { jointAt, pointOf, wallBetween } from "../builders";
import { FakeShell } from "../fake-shell";
import { drawDivider, drawRoom } from "./demo-steps";

const count = (o: object) => Object.keys(o).length;

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
    // A local document talks to no server, and this run shows no toast: nothing but renders along the way.
    expect(shell.effects.filter((e) => e.type !== "render")).toEqual([]);
    expect(shell.effectsOf("render").length).toBeGreaterThan(0);
  });

  it("step 3, undone: removing the divider restores the unsplit room exactly", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    const room = shell.doc();
    drawDivider(shell);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(room);
  });

  it("step 6: dragging the top-right joint across the divider is drawn red and refused", () => {
    // Phase 5 inserts step 5 (resize the right wall to 3.5 m) before this drag; the crossing is the same.
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    const entries = shell.state.undo.past.length;
    shell.key("v");
    shell.click({ x: 6, y: 2 }); // select the right wall: its joints get handles
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 });
    shell.moveTo({ x: 2, y: 2 });
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(walls.some((p) => p.kind === "polygon" && p.color === COLORS.invalid)).toBe(true);
    shell.up({ x: 2, y: 2 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(entries);
  });
});

describe("demo step 6, recovered (spec §5.7)", () => {
  it("dragging back from red to a valid spot commits the valid position", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    const entries = shell.state.undo.past.length;
    shell.key("v");
    shell.click({ x: 6, y: 2 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 2, y: 2 }); // across the divider: red
    shell.moveTo({ x: 4, y: 3 }); // back inside the right room
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(walls.some((p) => p.kind === "polygon" && p.color === COLORS.invalid)).toBe(false);
    shell.up({ x: 4, y: 3 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 4, y: 3 });
    expect(shell.state.undo.past).toHaveLength(entries + 1);
    expect(shell.view().toast).toBeNull();
  });
});
```

- [x] **Step 3: Write the index and cost tests.** `packages/editor/test/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as editor from "../src/index";
import type * as api from "../src/index";
import { FakeHost } from "./fake-shell";

// Every type the public index exports, written once; the typecheck fails if one goes missing. The README `@fm/editor`
// contract and the phase 4 web shell import most of them. Module-internal contract types (Moves, SnapContext,
// SnapPolicy, CommandOutcome, CommitInputWithoutId) are not public; SharedDocument arrives in phase 7.
// Exported only so lint counts it as used.
export type PublicTypes = [
  api.Align, api.Camera, api.Color, api.CommitInput, api.DocStep<unknown>, api.DocumentStatus, api.DragTarget,
  api.EditorState, api.Effect, api.Event, api.Field, api.FontSpec, api.HistoryState, api.Host, api.InitOptions,
  api.Layer, api.LayerName, api.LocalDocument, api.Mods, api.MoveAttempt, api.Notice, api.OpenDocument,
  api.PointerInput, api.Primitive, api.ProjectInfo, api.RemotePresence, api.Scene, api.SelectToolState,
  api.ServerEvent, api.Size, api.SnapAxis, api.SnapCandidate, api.SnapKind, api.SnapResult, api.Step, api.ToolName,
  api.ToolState, api.UiAction, api.UndoEntry, api.UndoRequest, api.ViewModel, api.WallPreview, api.WallToolState,
  api.Width, api.WorkspaceEvent, api.WorkspaceOp, api.ZoneToolState,
];

describe("@fm/editor public API", () => {
  it("exports what the web shell needs", () => {
    for (const name of ["update", "initialState", "buildViewModel", "buildScene", "worldToScreen", "screenToWorld"] as const) {
      expect(typeof editor[name]).toBe("function");
    }
    expect(editor.COLORS.wall).toMatch(/^#/);
    expect(editor.UI_FONT).toContain("sans-serif");
    expect([editor.TAG_FONT.family, editor.HELPER_FONT.family]).toEqual([editor.UI_FONT, editor.UI_FONT]);
    expect(editor.NO_MODS.shift).toBe(false);
  });

  it("offers no way to change state except update: no document, history or camera writes", () => {
    for (const name of ["commit", "onEvent", "createLocalDocument", "emptyHistory", "zoomAt", "panBy"]) {
      expect(name in editor, name).toBe(false);
    }
  });

  it("runs headless through the public API alone", () => {
    const host = new FakeHost();
    const opts = { mode: "local", me: { clientId: "t", name: "A" }, viewport: { width: 800, height: 600 }, dpr: 1 } as const;
    const r = editor.update(editor.initialState(opts, host), { type: "key", key: "w", mods: editor.NO_MODS }, host);
    expect(r.state.tool.name).toBe("wall");
    expect(r.effects.at(-1)?.type).toBe("render");
  });
});
```

`packages/editor/test/perf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dividedRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The core tsconfig has no DOM or Node lib; vitest runs in Node, where `performance` is a global.
declare const performance: { now(): number };

const WARM_UP = 20;
const MOVES = 200;

describe("scene rebuild cost (gate 3 question)", () => {
  // Core cost only: update + scene + ViewModel per move, with the fake host's text measurement.
  // Canvas2D drawing and real text measurement are the web shell's and are not timed here.
  it("handles 200 pointer moves with a live wall preview on the demo document", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    const seen = new Set<string>();
    const move = (i: number): void => {
      shell.moveTo({ x: 1 + (i % 40) * 0.1, y: 2.5 }); // valid and invalid previews
      const tool = shell.state.tool;
      seen.add(tool.name === "wall" && tool.state.kind === "drawing" && tool.state.preview ? String(tool.state.preview.ok) : "none");
    };
    for (let i = 0; i < WARM_UP; i++) move(i); // JIT warm-up, not measured
    const start = performance.now();
    for (let i = 0; i < MOVES; i++) move(i);
    const perMove = (performance.now() - start) / MOVES;
    expect(seen).toEqual(new Set(["true", "false"])); // every move had a live preview, both valid and red
    expect(perMove).toBeLessThan(16); // one 60 Hz frame; the gate report records the measured duration
  });
});
```

- [x] **Step 4: Run them and see the index test fail**

Run: `pnpm --filter @fm/editor test test/scenarios test/index.test.ts test/perf.test.ts`
Expected: the scenario and cost tests PASS (they use existing modules); `index.test.ts` FAILS because `src/index.ts` still exports nothing (`expected 'undefined' to be 'function'`). A failing scenario is a real bug: fix it in the owning task and log it.

- [x] **Step 5: Replace** `packages/editor/src/index.ts`

```ts
// Public API of @fm/editor. Shells import only from here, and change state only through `update`: the document,
// history and camera helpers are internal. Named exports only, so a new module export is not public by accident.
export {
  NO_MODS, type Mods, type ProjectInfo, type RemotePresence, type Size, type SnapKind, type SnapResult, type ToolName,
} from "./types";
export { screenToWorld, worldToScreen, type Camera } from "./camera";
export type { FontSpec, Host } from "./ports/host";
export type { Effect, WorkspaceOp } from "./ports/effects";
export type { Event, PointerInput, ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
export type { Align, Color, Layer, LayerName, Primitive, Scene, Width } from "./view/scene-types";
export { buildViewModel, type Field, type ViewModel } from "./view/view-model";
export { buildScene } from "./view/scene";
export { COLORS } from "./view/colors";
export { HELPER_FONT, TAG_FONT, UI_FONT } from "./view/fonts";
// Types only: they describe what `EditorState` holds.
export type { CommitInput, DocStep, DocumentStatus, LocalDocument, Notice, OpenDocument } from "./document/types";
export type { HistoryState, UndoEntry, UndoRequest } from "./history/history";
export type { SnapAxis, SnapCandidate } from "./snapping/policies";
export type {
  DragTarget, MoveAttempt, SelectToolState, ToolState, WallPreview, WallToolState, ZoneToolState,
} from "./tools/types";
export { initialState, type EditorState, type InitOptions, type Step } from "./state";
export { update } from "./update";
```

- [x] **Step 6: Run the whole editor suite**

Run: `pnpm --filter @fm/editor test --reporter verbose`
Expected: PASS, every file listed, including `scenarios/demo.test.ts` (5 tests after the wave 8 review), `index.test.ts` (3) and `perf.test.ts` (1). Note the duration printed for the perf test; divide by 200 for the per-move cost.

- [x] **Step 7: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: headless demo steps 2, 3 and 6, public index, scene cost check"
```

---

## Extension points

Later phases replace or extend these, keeping the signatures.

**Phase 5 (zones and helper dimensions):**

- `tools/zone-tool.ts`: replace `zonePointer` (hover face, click to label or select a zone) and `setField` (the zone `name` field → `renameZone`).
- `tools/hit-test.ts`: in `hitTest`, after joints and walls, add zone tags (sized with `host.textMetrics`; add a `host` parameter) and labelled floors (`faceAt`).
- `tools/select-tool.ts`:
  - `press`: a click on the selected wall's helper dimension enters `editingHelper`;
  - `selectKey`: the helper value field (digits, `.`, `Backspace`, `Enter` → `setWallLength` with `keep: "a"`);
  - `selectEscape` already cancels `editingHelper`.
- `view/scene.ts`:
  - insert `drawZones(state, doc, layers, host)` in `buildScene` before `drawWalls`;
  - draw the helper dimension and the fixed-endpoint marker in `drawSelection`;
  - `textBox` backs the live length label only; phase 5 sizes tag and helper boxes itself so hit-testing and drawing share one box.
- `view/view-model.ts`: `properties` case `"zoneLabels"` returns the name (editable) and area (read-only) fields.
- `keys.ts`: `deleteSelection` already deletes a selected zone label in the Zone tool.
- `test/scenarios/demo-steps.ts` and `demo.test.ts`: add steps 4 and 5; step 6 starts from (6, 3.5).

**Phase 7 (shared documents):**

- `document/types.ts`: add `SharedDocument` and widen `OpenDocument`.
- `document/open-document.ts`: add a `"shared"` case in every function.
- `session.ts`: replace `onWorkspaceEvent`, `onServerEvent`, `onWorkspaceUi` and `pointerPresence`.
- `notices.ts`, `toolNotice`:
  - `accepted` resumes a paused chain through `drawingAt` after the anchor check;
  - `rejected` ends a paused chain;
  - `remoteChange`, `resynced` and `offline` cancel or rerun gestures (§5.7).
- `tools/wall-tool.ts`: nothing to add for entering `paused`; `placePoint` pauses whenever the committed entry is still pending, and the paused pointer, key and Esc handling already exist.
- `view/scene.ts`: append `drawPresence(state, layers.presence)`. The ViewModel already maps `state.presence`.
- `commit.ts`: `blockedMessage` already distinguishes offline from waiting.

## Completion criteria

- [x] `pnpm check` passes. `@fm/editor/src` has no `async`, `await`, `Promise`, timers, `Date`, `Math.random`, `window`, `globalThis` or `console` (gate grep).
- [x] `update` appends exactly one `render` effect per event, and that effect carries the camera.
- [x] Every row of the first §5.5 table has a test: first click, click-click, typed `Enter`/`Space`, empty `Enter`, a click on `chainStart` closes, `Esc` twice. A rejected `addWall` leaves the tool unchanged and shows a toast.
- [x] §9 editor rows for snapping pass:
  - endpoint beats grid;
  - the midpoint is exact;
  - on-wall outranks grid;
  - `Shift` constrains to the axis and filters candidates;
  - `Ctrl` bypasses snapping;
  - dragged entities are excluded.
- [x] The Select tool passes:
  - a press selects (P10);
  - the 4 px threshold holds;
  - a handle drag keeps the wall selected;
  - a drag is one changeset;
  - an invalid drag is red, reverts, adds zero history entries and shows a toast;
  - `Esc` cancels;
  - `Delete`/`Backspace` removes a wall and its unused joints.
- [x] Undo passes:
  - a drag is one entry;
  - two moves, two undos and two redos restore each state (§9 acceptance);
  - a new edit clears redo;
  - `canUndo`/`canRedo` drive the toolbar.
- [x] Demo steps 2, 3 and 6 pass headless (`test/scenarios/demo.test.ts`), with exact corner and midpoint coordinates. Undoing the divider restores the unsplit room exactly.
- [x] A `LocalDocument` never enters `paused`, emits `accepted` in the same update, and no `saveSnapshot`, `submit` or `presence` effect is emitted in local mode.
- [x] The public index exports what phase 4 lists (`update`, `initialState`, `buildViewModel`, `worldToScreen`, `COLORS`, `UI_FONT`, and the types).
- [x] Every extension point above exists with its final signature.
- [x] The sprint log is complete and every finding is in design memory.

## Gate 3

Follow the [gate protocol](README.md#gate-protocol). Phase-specific verification:

```bash
pnpm check
pnpm --filter @fm/editor test --reporter verbose
pnpm --filter @fm/editor test test/perf.test.ts --reporter verbose      # duration ÷ 200 = cost per pointer move
grep -rnwE "async|await|Promise|setTimeout|setInterval|Date|Math\.random|window|globalThis|console" packages/editor/src   # expect no output
wc -l packages/editor/src/*.ts packages/editor/src/*/*.ts | sort -n | tail -8
```

There is no browser yet: demo steps 2, 3 and 6 are checked through `scenarios/demo.test.ts`.

The gate report (`docs/reports/gate-3-editor.md`) must answer:

1. **Purity.** Did `update` stay pure and synchronous everywhere? Quote the grep result. Name any place that wanted the clock, randomness or I/O, and how it went through `Host` or an effect instead.
2. **Size.** Give the line counts of `update.ts`, `keys.ts`, `tools/*.ts` and `view/scene.ts`. Split any file over about 300 lines before phase 5 adds to it, and record the split as a plan change.
3. **Ambiguous rules.** Which §5.5/§5.6 rules were ambiguous when coded? At least these planned readings, each confirmed or changed and recorded in `editor-interaction.md`:
   - only a click on `chainStart` closes a chain;
   - a typed length uses the modifiers of the last pointer event;
   - one press selects and can drag;
   - a wall drag moves by a grid-rounded delta;
   - a joint drag snaps the joint itself and ignores its own walls;
   - digits, `Enter`, `Space` and `Backspace` are swallowed while a chain is paused.
4. **Scene cost.** What is the measured cost per pointer move on the demo document? Does anything need memoizing (`wallOutlines`, preview `execute`) before phase 5 adds zones to every frame?
5. **Extension points.** Is anything missing that phase 5 or phase 7 will need? If so, revise those phase files now.

## Contract extensions

Additions to the README's `@fm/editor` contract. Nothing is renamed.

- **Protocol:** `messages.ts` is created in this phase with the **types only** (`ProjectMeta`, `RejectReason`, `ClientMessage`, `ServerMessage`, `MAX_MESSAGE_BYTES`), because the editor's `WorkspaceEvent`, `ServerEvent` and `Notice` need them. Phase 6 Task 6.1 replaces the file with a version whose type section is identical and adds the parsers (reconciled while planning).
- **Tooling:** `eslint.config.js` allows unused parameters and variables prefixed with `_` (stubs keep their final signatures).
- `types.ts`: `NO_MODS`.
- `camera.ts`: `MIN_ZOOM`, `MAX_ZOOM`.
- `ports/events.ts`: `PointerInput`.
- `snapping/policies.ts`:
  - the snap types live here (`SnapCandidate`, `SnapAxis`, `SnapContext`, `SnapPolicy`);
  - `onAxis`, `roundTo` and `POLICIES`.
- `snapping/snap.ts`: `projectOnAxis`.
- `document/local-document.ts`: `localCommit`.
- `history/history.ts`: `patchOnly`, `entryDependencies`, `isPendingEntry`, `REMOTE_UNDO`, `REMOTE_REDO`.
- `state.ts`: `Step`, `SNAP_TOLERANCE_PX`, `DEFAULT_ME_COLOR`, `switchTool`, `entityExists`, `pruneSelection`.
- `toast.ts`: `TOAST_TIMER`, `onToastTimer`.
- `commit.ts`: `CommandOutcome`, `blockedMessage`, `runHistory`.
- `notices.ts`: `rejectMessage`.
- `keys.ts`: `onKey`, `commandCode`, `undoRedo` (runs history; only an applied request drops the gesture and replays the pointer; wave 6 reviews).
- `pointer.ts`: `onPointer`, `followCamera` (wave 6 reviews).
- `session.ts`: `WorkspaceUiAction` and four stubs (phase 7).
- `tools/types.ts`: `idleTool`, `draggedJoints`, `PREVIEW_OP` (moved from wall-tool.ts in wave 7), `Moves` (moved from select-tool.ts; `MoveAttempt.moves`, wave 7 review).
- `tools/hit-test.ts`: `Hit`, `hitTest`, `DRAG_THRESHOLD_PX`, `HIT_TOLERANCE_PX`, `HANDLE_HIT_PX`.
- `tools/wall-tool.ts`: `wallPointer`, `wallKey`, `wallEscape`, `previewWall`, `drawingAt`.
- `tools/select-tool.ts`: `selectPointer`, `selectKey`, `selectEscape`.
- `tools/zone-tool.ts`: `zonePointer`, `setField` (placeholders until phase 5).
- `view/scene.ts`: `LAYER_ORDER`, `sceneDocument`, `textBox`.
- `view/labels.ts`: `labelBox` (shared with phase 5's `helperBox`).
- `@fm/domain` `errors.ts`: `invariantsMessage` (shared by `topologyMessage` and `rejectMessage`).
- **Test harness:**
  - the `FakeShell` constructor takes `(state?, host?)`;
  - `FakeShell.wheel(deltaX, deltaY, mods?)` at the current pointer (wave 6 code review);
  - `FakeShell.withDocument(doc)`;
  - `test/builders.ts` has `roomDoc`, `dividedRoomDoc`, `wallDoc`, `jointAt`, `wallBetween`, `pointOf`, `localState`, `serverState`;
  - `test/scenarios/demo-steps.ts` has `drawRoom` and `drawDivider`.
- **Behaviour the contract did not state:**
  - the wall tool places on `pointerDown`;
  - the live length and angle label is drawn in the `annotations` layer;
  - a wall drag moves by a grid-rounded delta;
  - a joint drag snaps with its own joint and incident walls excluded;
  - a command whose patch has no writes is skipped (no commit, no history, no toast);
  - the ViewModel hides a toast once `host.now()` passes `until`, even before its timer fires;
  - after a wheel, a viewport resize or the end of a middle-drag pan, `update` replays the last pointer move to the active tool (spec §5.4, wave 6 review);
  - an undo or redo that applies drops the gesture in progress; a refused one only shows its toast (spec §5.4, wave 6 reviews).

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-28 | 3.1, 3.2 | process | Wave 1: two parallel Opus agents from `daa72b8`. Both red for the expected reason (3.1: `expected undefined to be 1000000`; 3.2: module `../src/camera` missing), green with the plan's counts (2, 6), no lint or type fixes, code identical to the plan. 3.2's lint rule checked with scratch files: only the unused `y` reported, not `_x`. Cherry-picked `f723242`, `ef4767b`; protocol 3 files / 20 tests, editor 2 / 7. | Worktrees removed. | none |
| 2026-09-28 | 3.1 | spec change | The spec §7.2 table said `openProject { id, generation }`; the contract, the code and §7.2.1 ("project messages carry `projectId`") use `projectId`. The table abbreviates other fields too: §7.2.1 covers `requestId`, `projectId` and `generation`; `malformed.message` and `conflict.entities` are in the README contract only; `meta` on `snapshot` was in neither the table nor §7.2.1. | Table row fixed to `projectId` so phase 6's parsers are not written against `id`; `snapshot` row gains `meta` (wave 1 spec review). | none (wording) |
| 2026-09-28 | 3.2 | note | The `_` unused-name rule has no `files` filter (whole repo) and also covers variables (`varsIgnorePattern`), as planned. | None. | none |
| 2026-09-28 | wave 1 review | spec change | Spec reviewer: COMPLIANT; all six files identical to the plan; phase 6's copy of the types identical; P7 routing consistent in phases 6–7. Minor: camera round trip only at trivially exact values (exact in 19 of 60 probed cases); no anchor test at the clamp; a NaN factor poisons the camera; `varsIgnorePattern` broader than needed; `snapshot.meta` missing from the spec table; sprint-log wording. | Spec §7.2 `snapshot { meta, … }`; sprint-log row corrected; code items went to the fix below. | none |
| 2026-09-28 | wave 1 code review | issue / spec change | Approve with fixes. Important: an unknown project on `openProject` was answered with an uncorrelated `error { requestId: null }`, and phase 7's `failed` cleared `workspace.opening` whatever it answered. Opening a missing project and then another let the late error cancel the second open (its snapshot was then dropped); a malformed-message `error` did the same. Minor: mutable shared `NO_MODS`; camera comment ambiguous about CSS vs device pixels; message test proved only literals (value is the typecheck); no clamp-anchor test. | Controller decision (favour correctness, small fix): wire message `openFailed { projectId, generation, message }`, matched against `opening` like a snapshot; `error` never ends an open. Code fix `d627aa7`: `openFailed` (typecheck red first), `@ts-expect-error` for `openProject { id }`, exhaustive `ServerMessage` switch, frozen `NO_MODS`, `zoomAt` returns `c` for a non-finite or non-positive factor (NaN red first), round-trip and clamped-anchor tests (mutation-checked), lint exempts `_` parameters only. Protocol 3 files / 22 tests, editor 2 / 10. Plan revision `c885d9a`: spec §5.2, §7.0, §7.2, §7.2.1; README P7, P11 and contracts; phase 3 Task 3.3 `ServerEvent`; phase 6 Tasks 6.1, 6.3 (+2 tests), 6.7; phase 7 Tasks 7.2, 7.4, 7.5 (+2 tests; `failed` no longer touches `opening`); phase 4 `NO_DOM_MODS`. The controller corrected the comment's wording (a malformed message gets `error` whenever it cannot be answered with `rejected`, even inside an open project) and synced Tasks 3.1/3.2 code blocks. | collaboration.md (decision, Don't), process.md lesson 26, INDEX.md |
| 2026-09-28 | wave 1 code review | note | Left as is: `RemotePresence` repeats the wire `presence` fields by hand (the contract spells them out); `ProjectInfo` equals `ProjectMeta` in shape (local mode name); `violations: string[]` is right-sized (the editor shows one toast); the server never actually sends `error` with a `requestId` (list/create failures crash the server); `openFailed` never needs a toast (`opening` is non-null only while no document is open). | None. | none |
| 2026-09-28 | 3.3, 3.4 | process | Wave 2: two parallel Opus agents from `31e9439`. 3.3: code identical to the plan, 2 tests; the planned red step was wrong, since the test imports only types and Vitest erases them, so `vitest` passed before the sources existed and the red was the typecheck (TS2307). 3.4: red `Cannot find module '../src/snapping/chooser'`, green 13, code and builders identical to the plan, no `-0` from `projectOnSegment`. Cherry-picked `d12f884`, `6f6d5d1`; editor 4 files / 25 tests. | Plan Step 2 of 3.3 now runs the typecheck. | process.md lesson 27 |
| 2026-09-28 | 3.4 | issue | Mutation checks: 11 of 17 mutations caught by the plan's tests. "With Shift, drops candidates off the axis" never exercised the axis filter (its off-axis corner was ~1 m away, outside the 0.125 m tolerance), so dropping the endpoint or midpoint axis filter, or using projection for on-wall under Shift, passed; the chooser's distance tie-break had no test. Still uncaught (per the agent): the on-wall segment check under Shift (an axis would snap past a wall's end) and `roundTo`'s `-0` cleanup; the spec review found more (next row). | Agent added two assertions with an axis 5 cm above the bottom wall (corner and midpoint within tolerance but off-axis) and a distance tie-break assertion; still 13 tests; plan's test block synced. Segment-check test goes to the review fix. | process.md lesson 27 |
| 2026-09-28 | 3.3 | note | The effects test builds an `Effect[]` and compares `type` strings, so it catches a misspelled or removed variant (the array literal no longer typechecks) but not a newly added one (the events test has an exhaustive switch). `Scene`'s comment names `LAYER_ORDER`, which a later task adds. | Effects exhaustiveness goes to the review fix. | none |
| 2026-09-28 | wave 2 spec review | issue | Spec reviewer: COMPLIANT WITH MINORS; all 12 code blocks byte-identical to the files; spec §5.2 and §5.8 matched; contracts consistent with phases 3–7. Minors: the Shift segment check untested (origin (1.1, 4.1), cursor (6.02, 4.12) snapped to (6, 4.1) on the wall's line, 10 cm past its end, with the check removed); "on-wall outranks grid" passed with equal priorities (its on-wall point was also closer); `roundTo` untested; a new `Effect` variant or a dropped `openFailed` in `ServerEvent` still typechecked; the `key` comment said `KeyboardEvent.key` verbatim (§5.4 takes digits and `.` from `code`); plan-only snapping rules missing from memory; two sprint-log wording errors. | Fix `dbe5649` (merged `149d3a9`), each assertion mutation-checked red: segment-check test, a priority-only on-wall case (cursor (1.61, 0.11): grid 0.091 m, on-wall 0.11 m), `roundTo` tests (the 1e-6 cleanup shows on `3 × 0.2`, not the comment's `30 × 0.2`, which is exact), an exhaustive `effectLabel` switch and a `Record<ServerEvent["type"], true>` pin; `key` comment fixed in code and the README contract. Snapping 16 tests, ports 3, editor 29. Plan code blocks and counts synced; sprint-log wording corrected. | editor-interaction.md (snapping details row) |
| 2026-09-28 | wave 2 code review | issue | Ready with fixes, no correctness bug (29 mutations, 22 killed; 300-wall `snapPoint` ≈0.17 ms; zero-length walls, NaN zoom and proto keys checked). Important: endpoint-over-midpoint priority untested (common when zoomed out: at zoom 5 the tolerance is 2 m); the y tie-break asserted nowhere although the title claims it; the Shift "nothing snapped" fallback untested (at zoom 60 the axis grid step is 0.5 m, so returning the raw cursor would draw an off-axis wall). Minor: `roundTo` comment's `30 × 0.2` example is exact without cleaning; `SnapContext.tolerance` never read; `ViewModel.snap` allowed `"none"` although it is mapped to `null`; `kind` and `priority` independent on `SnapCandidate`; `UiAction`, `WorkspaceEvent`, `WorkspaceOp`, `Notice` unpinned; `onAxis` EPS unpinned; `sortedIds` in the policies does not affect the result. | Fix `1abfd27` (merged `cc89187`), each assertion mutation-checked red: endpoint-vs-midpoint test, y tie-break assertions, a zoom-60 Shift fallback test, `PRIORITY` table (priority derived from kind), `tolerance` removed from `SnapContext`, `ViewModel.snap` excludes `"none"`, `Record<…["type"], true>` pins for the four unions, comment `3 × 0.2 = 0.6`. Snapping 18 tests, ports 3, editor 31. Left: `onAxis` EPS (shared domain constant) and the sorted iteration (harmless). README contract and plan code blocks synced. | implementation.md deviation row |
| 2026-09-29 | 3.5, 3.6 | process | Wave 3: two parallel Opus agents from `765b08e`. Both red for the expected reason (missing `local-document`, missing `history`), code identical to the plan, no lint or type fixes. 3.5: 4 tests; 7 of 8 mutations caught; the survivor is the `canCommit` guard in `commit`, which cannot fire while `OpenDocument = LocalDocument` (phase 7 should test it with a blocked shared document). Cherry-picked `6067d3e`, `cce8f13`; editor 6 files / 47 tests. An agent's sandbox refused a compound command (heredoc writes chained with `&&`); single commands and the Write tool worked. | Worktrees removed. | none |
| 2026-09-29 | 3.6 | issue | 6 of 9 mutations survived the plan's history tests, each breaking a §7.5 rule: undo ignoring absence (deletes), redo skipping its before-value check, invalidation ignoring the redo stack, `accepted` revalidating an invalidated pending entry, entries not depending on what they created, redo committing the full `DomainPatch`. `addWall`'s `DomainPatch.dependencies` does not list the entities it creates, so `patchWrites` in `entryDependencies` is what gives an undo of an add its dependency on the new wall. | Agent strengthened the tests (src unchanged): redo patch is `{ puts, deletes }` and refused with `REMOTE_REDO` after a remote move; new tests for absence on undo plus created-entity dependencies, and for redo-stack invalidation plus no revalidation on `accepted`. The agent's 9 mutations are all caught (the spec review found more gaps, below); 12 tests; plan's test block synced. | undo-history.md (applies lesson 25) |
| 2026-09-29 | wave 3 spec review | issue | Spec reviewer: COMPLIANT WITH MINORS; all 6 code blocks identical to the files; every §7.0/§7.5 rule is in `history.ts` or owned by 3.8, 3.9 or phase 7; contracts match every later call. Gaps shown by mutations: semantic-dependency invalidation untested anywhere (phase 7 too); redo dependencies, the redo-request path, `prepareUndo` on a pending entry, `canRedo`/`prepareRedo` with a pending request or an invalid entry untested. Probes: a stray `rejected` for an accepted entry dropped it (filter by id, any status); recording a commit while a history request is pending made the request move the wrong entry (c1 → undo u1 → c2 → accepted u1 left past [c1], future [c2]), prevented only indirectly by `canCommit`. Docs: file count, lesson-25 reference, INDEX date, "usable at commit" wording. | Fix `0e4435b` (merged `d04b878`): tests for each gap, each mutation-checked red; `rejected` now drops only an unconfirmed (pending or invalid) entry with that id; `recordCommit` throws while a request is pending (every call site in 3.8 and phase 7 audited: only `runCommand` calls it, after `canCommit`). The brief's pending-only filter was wrong: an edit invalidated by a remote change and then rejected (the usual conflict path) would have stayed on the stack as a dead entry blocking undo; the agent caught it with a test. 18 history tests, editor 53. Phase 7 Task 7.7 gains a test for an ordinary edit during a pending undo request (7 → 8). Docs fixed. | undo-history.md (two rows), open-documents.md, INDEX.md |
| 2026-09-29 | wave 3 code review | issue | Ready with small fixes, no correctness bug (30 mutants, 25 killed; 3 survivors equivalent in context; six commands committed, undone and redone on a local document end to end). Important: no test checked where the entry sits while a request is pending (§7.5 step 4); a mutant that moves the entry at `startRequest` passed all 18 history tests. Minor: `localCommit`'s throw untested; its comment credited only `execute`, though undo and redo patches are guarded by `runHistory`'s tentative check; `UndoEntry.dependencies` vs `patch.dependencies` and `HistoryState.pending` vs status `"pending"` read alike; phase 7's private `entryDependencies(state, id)` shadowed the exported name; `emptyHistory` is one shared object; `settleRequest` trusts the stack top. | Fix `dda4e7c` (merged `e94fac9`): stack assertions during undo and redo requests (red on the mutant), a `localCommit` throw test, reworded comment, field comments. Document tests 5, history 18, editor 54. Phase 7's helper renamed `segmentDependencies`. Left: `emptyHistory` stays a constant (nothing mutates it; changing it touches every plan); `settleRequest` keeps trusting the top (guarded by `recordCommit`'s throw and `canCommit`). | none |
| 2026-09-29 | 3.7 | issue / deviation | Wave 4: one Opus agent from `003a7e7`, red `Cannot find module '../src/state'`. Planned deviation (domain-geometry Don't on unchecked lookups): the plan's `entityExists` and `draggedJoints` indexed `doc.walls[id]` directly, so a `constructor` wall "existed" and survived `pruneSelection`, and dragging it returned `[undefined, undefined]`; both red first, fixed with `isValidId`. Mutation check: 26 mutants, 5 survived the plan's tests (`pruneSelection` returning a new object when nothing changed, keeping the selection with no drawing open, camera ignoring `dpr`, `draggedJoints` empty for a joint, tolerance not 10) and gained assertions; `me.color` left untested (phase 7 sets it). 8 tests; cherry-picked `0a6fe8d`; editor 7 files / 62 tests. | Plan code blocks, red note and count synced. The spec review narrowed the rule for later tasks (next row). | domain-geometry.md Don't (applies); implementation.md deviation row |
| 2026-09-29 | wave 4 spec review | issue | Spec reviewer: COMPLIANT WITH MINORS; code blocks identical; §5.3, §5.5–§5.8, §7.0, §7.4 consistent; contracts and every later `COLORS` key match. Important: the initial state was barely tested (13 more mutants survived: seeded toast, `undo.pending`, selection, hover, pointer, pan, snap or presence; `mode` always local; `clientId` ignored; `openId` not from the host). Minor: `COLORS.helper` equalled the selection blue (memory says they differ; phase 5's helper-text filters would match selected text); `entityExists`'s zone-label branch and a same-tool `switchTool` untested; `me.color` a bare literal; `mode`, `panDrag`, `snap` recorded nowhere. ID sweep: 10 later sites (3.9 `drawSelection`/`properties`, 3.12 `dragMoves`, phase 5 `tagLayout`/`properties`/`drawSelection`, phase 7 `helperDependencies`) index tables with IDs from selection or tool state; none can hold a prototype name, since those IDs came from a validated document's keys (I8). | Fix `97fe3c9` (merged `c87e6dd`), each assertion mutation-checked red: full initial-state assertions, zone-label pruning, same-tool switch resets the gesture, `DEFAULT_ME_COLOR`, teal `helper` (`#0f766e`, phase 8's value) with a test that it differs from `wallSelected`. 11 state tests, editor 65. The Don't now says what counts as checked (IDs from a validated document's own keys) instead of listing sites; phase 5's exported `tagLayout` takes any string and needs `isValidId` (brief at phase 5). | domain-geometry.md (Don't clarified), editor-interaction.md (state fields, same-tool switch) |
| 2026-09-29 | wave 4 code review | issue | Ready once one test gap is fixed; no correctness defect. Important: `pruneSelection`'s wall and joint branches and hover-only pruning untested (a mutant that drops every selected wall, one that keeps a deleted joint, and one that keeps a stale hover when nothing is selected all passed 65 tests). Minor: server mode's "takes no host ID" unpinned (phase 7's `requestId: "id1"` relies on it); a toast timer that fires even 1 ms early kept the toast with nothing re-arming it (1 of 300 Node timers fired 0.57 ms early); `WallPreview`'s independent `ok`/`doc`/`message` allowed `{ ok: true, doc: null }`, and its readers disagreed on which field is the truth; `WallPreview.message`, `MoveAttempt.patch` and `.message` read by no one; `localState` burned the host's first ID; `DEFAULT_ME_COLOR` repeats `textMuted`; colour contrast (`wallHover` 1.67:1, red label text 3.62:1) for phase 8. Kept: `selection: EntityRef[]` (spec §5.3). | Fix `d817c63` (merged `4de9707`), each red first or mutation-checked: wall/joint/hover pruning tests, server host-ID test, `onToastTimer` returns a `Step` and re-arms with the time left (Task 3.10's `timerFired` returns it), `WallPreview = { from; to } & ({ ok: true; doc } | { ok: false })` with a `@ts-expect-error` test, `MoveAttempt` without `patch`/`message`, `localState` uses its own host, comment. 17 state tests, editor 71. Plan revised: Tasks 3.9 (`preview?.ok`), 3.10, 3.11 (`previewWall`), 3.12 and phase 5 (`attempt` literals), README contract (`WallPreview`, `MoveAttempt`, `onToastTimer`). Contrast left to phase 8's palette. | implementation.md deviation row |
| 2026-09-29 | 3.8, 3.9 | process | Wave 5: two parallel Opus agents from `a6d637d`. Both red for the expected reason (missing `commit`, missing `view/scene`), src identical to the plan, no lint or type fixes. Cherry-picked `c36237f`, `42cdb2e`; editor 9 files / 108 tests. `invertPatch` builds a fresh `{ puts, deletes }`, so undo commits the same shape as redo's `patchOnly`. | Worktrees removed. | none |
| 2026-09-29 | 3.8 | issue | Removing `validateDocument` from `runHistory` (spec §7.5 step 3) passed the plan's 8 tests: an invalid undo is only reachable after a change outside history. Survivors not testable with a local document: committing the full `DomainPatch` or empty dependencies, committing before `canCommit`, history-before-tools order in `applyNotices`; each prune (`finishCommit`, `applyNotices`) covers the other; `rejectMessage` texts are plan constants. | Agent added "refuses an undo that would make the drawing invalid" (a joint moved outside history makes the undo cross a wall; toast `MESSAGES.crossing`, nothing changes); 9 tests. Phase 7 gains a "Tests carried over from phase 3" list. | phase-7 plan |
| 2026-09-29 | 3.9 | issue | Only 10 plan tests: the layer-order test compared `buildScene` with `LAYER_ORDER` itself (circular), and nothing pinned the invalid-drag red walls (§5.7), the preview wall and its label (§5.5), snap glyphs other than endpoint, the README command-bar prompts, cursors, or `canUndo`/`canRedo`. With 18 added tests, 33 of 37 mutations are caught; survivors: major-line interval, `MAX_GRID_LINES`, hover colour (cosmetic), and `canUndo` without `canCommit` (phase 7). | 28 tests, src unchanged; plan's test block synced. | phase-7 plan (carried test) |
| 2026-09-29 | wave 5 spec review | issue | Spec reviewer: COMPLIANT WITH MINORS; code identical to the plan; §4.1, §5.2, §5.5–§5.9, §7.0, §7.4, §7.5 steps 1–4 followed; the `preview/w0` id matches the domain's `${opId}/w0`; the grid cut-off never triggers at supported zooms. Mutants passing all 108 tests: undo committed under the entry's own ID (a shared server would ack it without applying it, §7.5 step 3), selection handles drawn from the visible document during a drag (cosmetic survivors ignored). Minors: `PREVIEW_WALL` copies the wall tool's `PREVIEW_OP`; stale "reuse `textBox`" extension point; README `runCommand` comment wrong (no document → nothing, no-op skipped); `committed` comment silent on same-step rejection; `applyNotices` order cited §7.0, which sets none; memory missing the plan-time readings; wrong file count; phase 7 carried list partly covered and one item (notice order) untestable. | Fix `c9ad781` (merged `749b49a`): a fresh-ID test (a host that logs IDs; together with the undo/redo test, which fails if the commit ID differs from the request ID, it pins §7.5 step 3) and a handles-follow-the-drag test, both red on their mutants; comments corrected. Commit tests 10, view 29, editor 110. README, extension point, count and phase 7 list corrected; rendering.md and editor-interaction.md record the readings. Task 3.11 will derive the preview wall ID from `PREVIEW_OP` (planned deviation, wave 7). | rendering.md, editor-interaction.md |
| 2026-09-29 | wave 5 code review | issue | Ready after one Important fix; grid math, colour precedence, presence typing, Length = centreline (F5) all correct; `buildScene` ≈0.6 ms at 312 walls, 1.4 ms at 840. Important: `drawSnap`'s switch had no `assertNever` (a `void` function gets no missing-case error; a new `SnapKind` compiled and drew nothing). Minor: a server `invalid` rejection always showed a vague toast though the walkthrough says it explains why; the properties panel shows committed values while handles follow the drag; unpinned: red overlay on a valid preview, screen-sized glyphs, hover colour, presence mapping, the major-line claim; `textBox` math duplicated by phase 5's `helperBox`; major lines at 2.5 m for some zooms. | Fix `0258743` (merged `5b88110`) and `866ea71` (merged `4c311d6`): `assertNever` in `drawSnap`; domain `invariantsMessage` shared by `topologyMessage` and `rejectMessage` (server violations "I5: …" → "Walls can't cross"; unknown → generic), domain test; five view assertions, each red on its mutant; `labelBox` in `view/labels.ts` (no import cycle once phase 5's helper uses it), `textBox` without the unused `padPx`. Domain 187 tests, commit 11, view 33, editor 115. Phase 5's `helperBox` now calls `labelBox`; phase 7's carried list gains "`finishCommit` keeps the document's effects"; memory records the panel and rejection readings and the 2.5 m majors. | editor-interaction.md, rendering.md |
| 2026-09-29 | 3.10 | process | Wave 6: one Opus agent from `f81b347`, red `Cannot find module '../src/update'`, code identical to the plan, no lint or type fixes; the builders ↔ fake-shell circular import is harmless (neither uses the other at load time). Cherry-picked `0fce761` as `35801d3`; editor 10 files / 135 tests. | Worktree removed. | none |
| 2026-09-29 | 3.10 | issue | The plan's 11 tests killed 6 of 25 routing mutations (spec §5.4): command codes accepted with Ctrl or Alt, Cmd+Shift+Z undoing, Ctrl+Z ignored, render placed before the handler's effects, Delete ignoring tool/state/Cmd, zone Delete removing non-zone entities, Esc keeping the selection, middle-button pan only in Select, `pointer` not tracked while panning, right-button events reaching the tool, Cmd+wheel panning, any `timerFired` clearing the toast all passed. Survivors: globals before command codes (the key sets do not overlap), a skipped value field (stubs return null; Task 3.11's "edits the typed value with Backspace" pins it, since without the value field no digit is ever typed), the Cmd+S line (falls through to the same no-op). The right-button test sees the tool only because the zone placeholder clears `snap`; Task 3.11 adds a wall-tool version that stays meaningful after phase 5. | Agent added 9 tests, each red on its mutant; 20 tests; plan's test block and count synced. | none |
| 2026-09-29 | wave 6 spec review | issue / spec change | Spec reviewer: COMPLIANT WITH MINORS; code identical to the plan; §5.4 precedence, command codes, Delete and Esc rules correct; every later use of `update`, `FakeShell`, the stubs and `session.ts` matches. Important: `pointer.world` went stale when the camera moved without a pointer event (a 160 px wheel pan left it 2 m off; a middle-drag pan used the camera from before the move), so after a two-finger scroll Task 3.11's typed length and preview would follow the old point; the render effect was barely pinned (camera, scene and view built from the input state passed all tests; the README said `FakeShell.view()` reads the last render, but it rebuilds from state). Minor: undo mid-gesture left the chain or drag preview on the pre-undo document (a chain could continue from an undone joint); surviving mutants (Delete while `moving`, Ctrl+Delete, uppercase `Z` redo, vertical pan signs, which button ends a pan, modifier-only keys, `Space`); right-button test vacuous after phase 5; value fields get no modifiers; 2.7× zoom per mouse-wheel notch; routing readings missing from memory; one sprint-log reason wrong. | Controller decisions (favour correctness): the cursor follows the camera (spec §5.4 paragraph) and undo/redo drop the gesture in progress (spec §5.4 row). Fix `e4a43b4`, `c6ed54c` (merged `ad225a4`, `4d7e738`), each assertion red on the old code or its mutant: `withPointer`, `followCamera` (replays the last pointer move after a wheel, a resize and a pan's end; pan moves send presence), `undoRedo` in keys.ts used by keys and toolbar, render-effect tests, one test per surviving mutant. 34 update tests, editor 149. Plan code blocks and count synced; README `view()` comment corrected; Task 3.11 gains three carried tests (right button leaves the wall tool idle, scroll then typed length, `Cmd+Z` mid-chain). Left: zoom speed for a mouse (phase 4 or 8); value fields without modifiers (recorded). | editor-interaction.md (two decisions, two Don'ts, routing readings) |
| 2026-09-29 | wave 6 code review | issue / spec change | Ready with small fixes, nothing critical; the reviewer ran the plan's Task 3.11/3.12 code against this wave (a scroll mid-chain then `6 Enter` follows the new direction; a pinch zoom keeps snapping since the replay uses the stored mods; replay depth ≤ 2). Important: a refused undo ("Nothing to undo", or "Waiting for server" on a paused shared chain) also dropped the chain and cleared hover and snap, and the test pinned exactly that; for Task 3.12, the drag threshold compared screen points, so after a 200 px scroll during `pressing` a 5 px move jumped the wall 2.4 m back under the cursor, while in `moving` a scroll moved it at once. Minor: preview lags during a middle-drag pan interrupted by a wheel (tool told at pan end); pan-move presence redundant (grab pan keeps the world point); the replay relied on `panDrag` equalling `pointer.screen`; right-button moves sent no presence; duplicate tests; pan moves sent with `button: 0` (the web shell sends the held button); no `FakeShell` wheel helper; phase 7 presence test lacks a wheel case. Left: `commandCode` export (contract), a `WheelInput` alias. | Fix `e9dc552` (merged `7e41cc5`), each red on the old code or its mutant: `undoRedo` runs history first and only an applied request (new document object; every refused path in `runHistory` keeps it) drops the gesture and replays the pointer; `pointer.ts` holds `onPointer`/`followCamera` (no keys ↔ update cycle); `followCamera` during a pan only moves the pointer and sends presence; no presence on pan moves; right-button moves send presence; duplicates merged, pan moves use `button: 1`, `FakeShell.wheel`. 34 update tests, editor 149. Spec §5.4 row revised; Task 3.12 gains a planned deviation (threshold in world units, `pressScreen` removed) and a carried undo-mid-drag test; Task 3.11 a carried undo-replay test; phase 5 note on `pressScreen`; phase 7 carried tests (wheel presence, refused undo on a paused chain, `sharedCommit` returns a new object). Plan code blocks, Files table, README harness (`wheel`) and file tree synced. | editor-interaction.md (decisions and Don'ts revised), process.md lesson 28, INDEX.md |
| 2026-09-29 | 3.11, 3.12 | process | Wave 7: two parallel Opus agents from `08d69c6`. Both red for the expected reason (3.11: `expected { kind: 'idle' } to match object { kind: 'drawing', … }`; 3.12: `expected [] to deeply equal [ { table: 'walls', id: 'room-2/w0' } ]`), plan src green unchanged, no lint or type fixes. Both touched `tools/types.ts` and update.test.ts on different lines; cherry-picked `fb777ca`, `22c3727` as `0201ce1`, `dc7f0fe` without conflicts; editor 12 files / 187 tests. | Worktrees removed. Plan code blocks of Tasks 3.7 (`tools/types.ts`), 3.9 (scene, view test), 3.10 (update test), 3.11 and 3.12 synced with the files. | none |
| 2026-09-29 | 3.11 | issue / deviation | Planned: `PREVIEW_OP` in `tools/types.ts`, scene's `PREVIEW_WALL` built from it, view test uses it. The plan's 13 tests left six §5.5/§5.4 rules unpinned (placement on release, Ctrl bypass, zero length or a leading-`0` regex, a rejected typed wall clearing its value, a typed length closing the chain, no preview right after a typed placement); 28 mutations, none survive now. Carried wave 6 tests added (right button, scroll then `6 Enter`, `Cmd+Z` mid-chain rebuilds the snap). The wave 6 update test asserting `snap` null after an applied undo held only because the stub never set `snap`; with the real tool the replay rebuilds it. | 9 tests added (22); update.test.ts asserts the rebuilt grid snap at the cursor instead (red if the replay is removed). | none |
| 2026-09-29 | 3.12 | issue / deviation / spec change | Planned: threshold `distance(world, pressWorld) · zoom ≤ 4` px, `pressScreen` removed, `press`/`move` lose `screen`. Correction to the wave 6 reading: after the first 5 px move the plan's code and the fix end at the same place; the defect is the visible jump on that move, and a press, scroll and release with no move committed nothing (now it commits the drag). Mutation check: 30 mutations; the plan's tests missed wall-drag rounding, Shift and Ctrl, joint-snap exclusions, keeping the last valid preview, clearing the snap on release and on Esc. Survivors per the agent: `<=` vs `<` at exactly 4 px, the `canCommit` guard (phase 7), handle 8 px vs hit 6 px; the spec review showed the first and third are testable and found six more (next rows). Grid rounding of exact halves goes toward +∞ (`Math.round`: −2.5 → −2.4, +2.5 → +2.6; `−2.5 / 0.2` itself is exact); the wheel-mid-press test sat on such a half (moved off it in the review fix). | 6 tests added (16). Spec §5.7 now says "4 px at the current zoom, measured in world units"; README contract and phase 5's `press`/`move` copies synced. | editor-interaction.md (row landed) |
| 2026-09-29 | wave 7 spec review | issue / spec change | Spec reviewer: COMPLIANT WITH MINORS; all five code blocks identical to the files; every §5.5 first-table row, §5.6 hit order and §5.7–§5.8 rule correct; wave 6 interactions probed (wheel mid-chain/press/drag, pan mid-press, applied and refused undo, Delete and tool switch mid-drag, right button, stray pointerUp) all correct; later phases use the exports consistently. Important: `release` recomputed the moves from the pointer-up's position and mods, so releasing Shift a moment before the button committed (7, 4.6) after a preview at (7, 4); a red last attempt could commit a valid state never shown, and an ok preview could be refused. Minor: §5.5's click row carried the typed value over, the code clears it, nothing pinned either; six more surviving mutants (joint-drag Shift and Ctrl, wall-drag Shift with y dominant, Esc in `pressing`, hover not clearing, wall Esc keeping the snap); the 4 px `<=` and the 8 px handle radius are testable after all; the rounding explanation was wrong and a test sat on a half; a handle click keeps the wall selected (unrecorded); `PREVIEW_OP` listed under wall-tool.ts in Contract extensions. | Controller decisions: the release commits the last attempt's moves (spec §5.7 sentence); a click clears the typed value (spec §5.5 row). Fix `5e070ef` (merged `ddb6389`), each assertion red on the old code or its mutant: `MoveAttempt` carries `moves` on both variants (`Moves` moved to tools/types.ts), `release` commits them through `runCommand` and ignores the pointer-up; 10 select-tool tests (26) and 2 wall-tool tests (24); the wheel test moved off the half (204 px), and a second tie (x 2.1) found and moved. Hand-built attempts in update and view tests gained `moves: []`. Editor 199. Plan code blocks, README `MoveAttempt`, phase 5 `release` call and placeholder attempt, Contract extensions and the 3.12 sprint row corrected. | editor-interaction.md (tool readings) |
| 2026-09-29 | wave 7 code review | issue / spec change | Ready with fixes, nothing critical. Important: `handleHit` took the first handle in range, not the nearest (a selected 0.15 m wall at zoom 80, press 4.8 px from `b`: `a` moved); surviving mutants hid the Shift axis origin of a joint drag (the test pressed exactly on the joint), the 6 px hit tolerance and the missing-direction toast; a press whose target vanished (phase 7 remote delete) became a silent red drag committing nothing. Minor: the typed direction and the preview used different cursor-on-origin tests (with Ctrl 0.5 mm off the origin: no preview, but `3 Enter` placed a wall); a dead closing guard; a double click toasted "Wall too short"; a document with `preview/…` IDs turns every preview red; duplicated axis and joint logic; `MoveAttempt`'s two identical arms; hand-built gesture states in update tests; cost per move 5 ms at 220 walls and 19 ms at 480, dominated by the domain's whole-document validation. Left: `DRAG_THRESHOLD_PX` stays in hit-test.ts (contract), a shared value-field helper (phase 5 copies the regex). | Controller decision: a click on the chain's origin is ignored (spec §5.5 row). Fix `646ec24` (merged `6ec4607`), each red on the old code or its mutant: nearest handle with `a` on exact ties (phase 5's copy synced), vanished target → `idle` in `attemptMove` (the release guard stays: an empty `moveJoints` is refused with "Nothing to move"), one `onOrigin` test for preview, typed length and clicks, the dead guard removed, `MoveAttempt` one object type, `dragMoves` uses `draggedJoints`, `gridDelta` uses `projectOnAxis(orthogonalAxis(…))`, update tests use real gestures, tests for Shift origin, hit tolerance, direction toast and handle ties. Wall 27, select 31, editor 207. README `MoveAttempt` and plan code blocks synced; the preview-ID collision accepted and the cost recorded as a risk for Gate 3. | editor-interaction.md, domain-geometry.md (risk row) |
| 2026-09-29 | 3.13, 3.14 | process | Wave 8: two parallel Opus agents from `f7e2b60`. 3.13 green at once as planned; 3.14 red on `index.test.ts` (`expected 'undefined' to be 'function'`), scenario and cost tests green at once; code identical to the plan. Cherry-picked `b83e3e9`, `18d1d93` as `fa2f5f9`, `7aac2cb`; editor 16 files / 221 tests. The per-move cost on the demo document is about 0.13 ms (26 ms for 200 moves plus setup, three runs), against the 16 ms budget; larger documents are the wave 7 risk row. | Worktrees removed. | none |
| 2026-09-29 | 3.13 | issue | 30 mutations; the plan's 5 tests killed 17, 6 more died in the other suites, and two survived the whole editor suite: undo not restoring deleted joints (the plan's delete test used the room, whose joints survive) and undo/redo keeping an undone wall selected (`finishCommit` and `applyNotices` both prune, so only removing both shows it). | Agent added "restores a deleted free-standing wall with its joints and IDs, and redo deletes all three again" and "undoes wall placements one at a time and drops an undone wall from the selection"; 7 tests; plan's test block synced. | none |
| 2026-09-29 | 3.14 | note | 7 mutations of the listed demo rules (midpoint snap, Shift axis, closing click, red invalid colour, committing an invalid move, refusal toast, undo of the divider) all killed (the spec review found two more demo rules unpinned, next row); index is the plan's list. `REMOTE_REDO` already exists and phase 7 imports it from `@fm/editor`, but phase 7 Task 7.9 appends the export itself, so adding it now would be a duplicate export; left to phase 7. Phase 5 (`helperLabelAt`, `formatArea`) and phase 7 (`ServerEffect`, `clientMessageFor`, `serverMessageEvent`) export their own names; phase 4's imports are covered. | None. | none |
| 2026-09-29 | wave 8 spec review | issue | Spec reviewer: COMPLIANT WITH MINORS; code identical to the plan; every §9 editor row mapped to a test (project list and delayed shared documents are phase 7's); no duplicate-export conflict with phase 5's or Task 7.9's appends; phase 7 first imports `REMOTE_REDO` in Task 7.12, after 7.9. Important: nothing pinned "passing through an invalid position and ending valid remains allowed" (§1.4 step 6: an attempt that stays red once red passed all 221 tests); `drawRoom` typed digits and Enter without Shift although the demo holds it (§5.4; a value field that ignores Shift-held keys passed everything, and only phase 8's browser run would catch it: lesson 18). Minor: type exports unpinned (removing `Host` etc. from the index still typechecked); the Gate 3 purity grep matched the word "async" in a host.ts comment; the perf test would pass with no preview; no check that a local run emits only render/timer effects; the index exports document functions no later plan imports (`commit`, `onEvent`, …; left, the plan specifies them); the 3.14 row said "demo-critical". | Fix `dcbc46b` (merged `867ce93`), each red on its mutant: "demo step 6, recovered" (red at (2,2), valid at (4,3), commits); `FakeShell.type(text, mods?)` and `drawRoom` holds Shift on digits and Enter (5 demo tests red on a value field skipping Shift); `PublicTypes` pins 45 exported types (lint ignores `_` only for arguments, hence an exported alias); host.ts comment reworded, grep empty; perf test asserts valid and red previews; demo step 3 asserts only render/startTimer effects. Editor 222. Phase 5's `drawRoom` copy and phase 8's narrated step 2 now type with Shift; README `type` signature; plan blocks synced; 3.14 row reworded. | none (lesson 18 applied) |
| 2026-09-29 | wave 8 code review | issue | Ready for Gate 3 with fixes, nothing critical; scenario fixtures avoid rounding ties; src has no casts, no `!`, exhaustive switches; largest src file `select-tool.ts` 171 lines. Important: the index exported write paths and internals no consumer uses (`commit`, `onEvent`, `createLocalDocument`, `emptyHistory`, `canCommit`, `status`, `isDirty`, `visibleDoc`, `snapPoint`, `gridSpacingFor`, `LAYER_ORDER`, and via `export *` `zoomAt`, `panBy`, zoom constants): a shell could commit into the state it holds, skipping `execute`, history and notices, or move the camera. Minor: `PublicTypes` wrote 45 names twice and missed `PointerInput`, `Step`; the perf figure from the vitest duration included setup and cold JIT (≈1.5 ms vs ≈0.15–0.5 ms warm) and its comment overclaimed a frame; the local-effects filter allowed an absent `startTimer`; `drawDivider`'s precondition and the Shift-typing claim unstated; "pure" without "given the Host"; `view()` equals the last render only while the clock stands. Left: a `grabCorner` helper (phase 5 replaces demo-steps.ts), `localState`'s unused host parameter (many call sites), exports used only in their own file (contract extension points). | Fix `1795f85` (merged `881cc01`): index trimmed to the 11 values later plans import (each traced to a plan line), named exports only, header comment, a test that `commit`, `onEvent`, `createLocalDocument`, `emptyHistory`, `zoomAt`, `panBy` are not exported (red before); `PublicTypes` as one `api.X` list incl. `PointerInput`, `Step`; perf test warms up 20 moves and times 200 with `performance.now()` (0.41–0.61 ms per move over three runs), comment says core cost only; comments fixed; `update` returns `Step`. Editor 223. README index line, architecture.md decision and Don't, phase 7 Task 7.9 note; plan code blocks synced. | architecture.md |
