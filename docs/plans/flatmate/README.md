# Flatmate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every phase ends in a gate: stop there, write the gate report, update design memory, and wait for the user's approval before starting the next phase.**

**Goal:** Build the demo-critical tier of Flatmate (spec §1.2 F1–F10, demo script §1.4 steps 1–9): a keyboard-first 2D wall editor with zones, helper dimensions, undo and two-client collaboration, on a portable hexagonal TypeScript core.

**Architecture:** Three rings (spec §2.2). `@fm/domain` is pure synchronous functions over a document of joints, walls and zone labels. `@fm/editor` is a Crux-style reducer `update(state, event, host) → { state, effects }` that owns tools, snapping, camera, history and the open document. Shells (React + Canvas2D web app, Node WebSocket server, test fake shell) turn the real world into events and effects into I/O. `@fm/protocol` holds the wire types shared by everyone.

**Tech stack:** Node 22, pnpm 10 workspaces, TypeScript 6 (`~6.0`, strict; not 7, which typescript-eslint does not support yet), Vitest 5, Vite 8 + React, Canvas2D, `ws`, `tsx`, Playwright, dependency-cruiser 18, ESLint 10 (typescript-eslint 8).

**Resuming:** read [EXECUTION.md](EXECUTION.md) first: current position, how parallel agent waves run, and the prompt template.

**Sources of truth:** the spec `docs/specs/flatmate-design.md` defines *what*; design memory `docs/design-memory/INDEX.md` records *why* and the Don'ts. Read both before each phase (AGENTS.md rules 1–7). If this plan and the spec disagree, the spec wins: fix the plan and note it in the next gate report.

---

## Phases and gates

Each phase maps to a build-order step (spec §10) and ends in something runnable. Tick a phase only when its gate report is committed and the user has approved it.

| Phase | File | Spec §10 step | Ends with | Gate |
|-------|------|---------------|-----------|------|
| 1 | [phase-1-skeleton.md](phase-1-skeleton.md) | 1 | Workspace, tooling, boundary enforcement, `@fm/protocol` basics | G1 |
| 2 | [phase-2-domain.md](phase-2-domain.md) | 2 | Complete domain kernel; demo geometry (steps 2–6) scripted through the domain API | G2 |
| 3 | [phase-3-editor.md](phase-3-editor.md) | 3 | Headless editor on an unsaved `LocalDocument`: wall tool, select tool, snapping, undo | G3 |
| 4 | [phase-4-web-shell.md](phase-4-web-shell.md) | 4 | Browser app drawing walls with Canvas2D, no server | G4 |
| 5 | [phase-5-zones-helpers.md](phase-5-zones-helpers.md) | 5 | Zone tool, zone selection/rename/delete, helper dimension editing; demo steps 2–6 in the browser | G5 |
| 6 | [phase-6-server.md](phase-6-server.md) | 6 (server half) | Protocol messages, server app, JSON repository, crash-only restart | G6 |
| 7 | [phase-7-collaboration.md](phase-7-collaboration.md) | 6 (client half) | `SharedDocument`, project list, presence, shared undo, sync tests; demo steps 1–8 | G7 |
| 8 | [phase-8-demo-polish.md](phase-8-demo-polish.md) | 7 | Visual polish, demo scripts (step 9), README, rehearsal; final report | G8 |

Progress:

- [x] G1 approved: skeleton
- [x] G2 approved: domain
- [x] G3 approved: headless editor
- [x] G4 approved: web shell
- [x] G5 approved: zones and helpers
- [x] G6 approved: server
- [x] G7 approved: collaboration
- [x] G8 approved: demo complete (final report)

The WebGL2 SDF renderer (S1) and the §11 follow-ups are **not** in this plan. After G8, write a separate plan for S1.

---

## Working rules for every task

1. **Tests first.** For domain and editor logic, write the failing test, run it and see it fail for the expected reason, then write the minimal code, then run it green. Headless editor scenarios drive gestures through the fake shell (`packages/editor/test/fake-shell.ts`), never by poking state.
2. **Commands.** From the repo root:
   - `pnpm test`: every package's Vitest suite.
   - `pnpm --filter @fm/domain test <file-or-pattern>`: one package or one file (no `--`: pnpm would pass it through and Vitest would run every file).
   - `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`.
   - `pnpm check`: all four; it must pass before every commit.
   - `pnpm e2e`: Playwright, from phase 4.
3. **Commits.** One commit per task, after `pnpm check` passes. Message style: `domain: addWall splits a wall at a T-junction`. The user's approval of this plan authorizes these commits; never push.
4. **Core rules** (AGENTS.md): no DOM, no Node built-ins and no `as` or `!` assertions in `protocol`, `domain`, `editor` (`as const` is allowed); exhaustive `switch` with `assertNever`; dependencies point inward only.
5. **Findings go to design memory immediately.** When a task reveals a design gap, a spec ambiguity, a bug whose cause is a wrong assumption, a tooling gotcha or a deviation from this plan:
   - record it in the same commit as the fix, in the matching area file under `docs/design-memory/`, with date and spec §;
   - put implementation-level findings (tooling, library behaviour, deviations from the plan) in `docs/design-memory/implementation.md`;
   - put recurring lessons in `process.md`, and open issues under "Open issues" there;
   - if the spec changes, edit the spec in the same commit (AGENTS.md rule 2);
   - list the finding in the running log at the bottom of the current phase file (`## Sprint log`), so the gate report can be assembled from it.
6. **Keep the plan executable.** When a change affects later tasks, edit those tasks at once and mark them `(revised: <reason>)`. Tick each step's checkbox as you complete it.
7. **Scope guard.** If a task grows because of an edge case, prefer a hard constraint and a toast over new machinery (AGENTS.md working style). Record the constraint in the spec and memory.

---

## Gate protocol

Every phase ends with a gate. At a gate, do the following in order:

- [ ] **1. Completion criteria.** Tick each bullet in the phase's `## Completion criteria`. An unmet bullet is either fixed now or recorded as an open issue with a reason and a target phase.
- [ ] **2. Verify.** Run `pnpm check` and the phase's extra commands (listed in the phase file). Record test counts and results.
- [ ] **3. Write the report** `docs/reports/gate-<N>-<slug>.md` from [`docs/reports/TEMPLATE.md`](../../reports/TEMPLATE.md). It covers: outcome in demo-script terms, completion bullets, verification, implementation issues, changes to the plan, changes to the spec, design-memory updates, risks for the next phase, and demo status. Build it from the phase's `## Sprint log`.
- [ ] **4. Memory.** Every issue, plan change and spec change in the report must already be in design memory; check and fill gaps now. Update `INDEX.md` summaries and its "Last updated" date. Remove resolved open issues from `process.md`.
- [ ] **5. Plan upkeep.** Tick this README's progress line and revise later phase files affected by the report's plan changes.
- [ ] **6. Commit** `gate <N>: <phase> report, memory and plan updates`.
- [ ] **7. Stop.** Present a short summary of the report to the user (outcome, issues, plan/spec changes, risks) and wait for approval before the next phase.

---

## Decisions made while planning (2026-09-27)

These fill gaps the spec left open. Clarifications are already applied to the spec and design memory. Implementation details are recorded in `docs/design-memory/implementation.md`.

| # | Decision | Where |
|---|----------|-------|
| P1 | Packages import each other's TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`); no build step. Vite, Vitest and `tsx` compile on the fly. | implementation.md |
| P2 | Each core package typechecks `src` with `lib: ["ES2022"]` and `types: []`; tests typecheck through a separate `tsconfig.test.json`, so Vitest's Node typings never leak into core sources. | implementation.md |
| P3 | `Result`, `ok`, `err`, `unwrap`, `assertNever`, `deepEqual`, `Point` live in `@fm/protocol` so every package, including `server/src/app`, can use them. Scripts use `unwrap(execute(doc, cmd))`. | spec §2.4, §3.1 |
| P4 | `addWall` IDs: the new wall is `${opId}/w0`; split fragments `w1`, `w2`; new joints `j0`, `j1`, all in `from`-then-`to` order. | spec §3.4 |
| P5 | Degree-1 wall ends are flat at the joint. | spec §3.5 |
| P6 | Commands build their patch by diffing the document before and after (`diffPatch`), so `puts`, `deletes` and `before` are always consistent. | implementation.md |
| P7 | The shared project's first `snapshot` for `workspace.opening` creates the `SharedDocument`. The WebSocket adapter only translates messages: `projects`/`projectCreated`/`error` become `workspaceEvent`s, everything else a `serverEvent` (including `openFailed`, which, like a snapshot, is matched against `workspace.opening`; revised 2026-09-28). Reconnect backoff lives in the adapter; the editor reopens the project with a new generation on `connection open`. | spec §5.2, §7.0, §8 |
| P8 | `Notice` gains `offline` (disconnect cancels gestures, including a paused chain). | spec §7.0 |
| P9 | `commit(d, { id, patch, dependencies })`: the caller creates the ID (it becomes the changeset ID for shared documents and the history entry ID). | spec §7.0 |
| P10 | Pressing an unselected entity selects it at once, so one press can select and drag. | spec §5.6 |
| P11 | Protocol adds `hello`/`welcome` (identity and colour), `presenceLeft`, and `openFailed { projectId, generation, message }` for an unknown project (revised 2026-09-28: was an uncorrelated `error`, whose late arrival cancelled a newer open). | spec §7.2 |
| P12 | Two-client sync tests live in `packages/sync-tests` (tests only), because `@fm/editor` must not depend on the server. | spec §2.4, §9 |
| P13 | Crash-only: the server app calls an injected `onFatal(error)` on any repository error; `main.ts` exits the process; tests assert that nothing was sent. | implementation.md |
| P14 | The area label for Playwright is read from the properties panel (DOM), not the canvas; collaborators are listed in the status bar (DOM). | implementation.md |
| P15 | TypeScript is pinned to `~6.0` (typescript-eslint does not support 7). | implementation.md |
| P16 | Typed digits and `.` come from the physical key (`KeyboardEvent.code`), so `Shift`+`6` types `6`; the typed direction uses the last pointer event's modifiers; modifier-only key events are ignored. | spec §5.4 |
| P17 | The `render` effect carries the camera; the web effect runner hands server effects to a `ServerEffectSink` (null in local mode). | spec §5.2 |
| P18 | Scene units: dashes in screen px, arc radius in metres, angles in world radians CCW, text upright with a middle baseline. | spec §5.9 |
| P19 | Server config: `PORT` (8787), `DATA_DIR` (`./data`); web server mode from `?server=` or `VITE_SERVER_URL`, `?server=off` forces local mode. | implementation.md, architecture.md |
| P20 | Server session rules (hello first, stale generation ignored, `unknownProject` for an unopened project, presence not queued) and crash-only for any error in a queued task. | spec §7.2, §7.2.1 |
| P21 | A submission over `MAX_MESSAGE_BYTES` is refused locally with `rejected{tooLarge}`; per-tool gesture dependency sets for remote changes; `labelZone` refuses a labelled face; wall drag snaps a grid-rounded delta. | spec §3.6, §5.6, §5.7, §7.4 |

---

## File structure

```
flatmate/
├─ package.json                  root scripts: test, typecheck, lint, depcruise, check, e2e, dev, dev:server
├─ pnpm-workspace.yaml           packages/*
├─ tsconfig.base.json            strict, noUncheckedIndexedAccess, lib ES2022, types []
├─ eslint.config.js              no assertions in cores
├─ .dependency-cruiser.cjs       ring rules (spec §2.4)
├─ packages/
│  ├─ protocol/                  @fm/protocol: shared types and pure helpers, no dependencies
│  │  └─ src/ util.ts · patch.ts · messages.ts (phase 6) · index.ts
│  ├─ domain/                    @fm/domain: document kernel
│  │  └─ src/ model.ts · geometry.ts · errors.ts · shape.ts · validate.ts · patch.ts · graph.ts
│  │          commands/ add-wall.ts · move-joints.ts · set-wall-length.ts · labels.ts · delete-entities.ts · execute.ts
│  │          queries/ outlines.ts · faces.ts · area.ts · zones.ts · helpers.ts · hit.ts
│  │          serialize.ts · scripts.ts · index.ts
│  ├─ editor/                    @fm/editor: platform-neutral interaction core
│  │  ├─ src/ ports/ host.ts · effects.ts · events.ts · wire.ts (phase 7: protocol ↔ events mapping)
│  │  │       types.ts · state.ts · update.ts · pointer.ts · camera.ts · keys.ts · toast.ts · commit.ts · notices.ts · gestures.ts (phase 7)
│  │  │       snapping/ policies.ts · chooser.ts · snap.ts
│  │  │       document/ types.ts · local-document.ts · shared-document.ts (phase 7) · open-document.ts
│  │  │       history/ history.ts
│  │  │       tools/ types.ts · wall-tool.ts · select-tool.ts · zone-tool.ts (phase 5) · hit-test.ts · helper-edit.ts (phase 5)
│  │  │       view/ scene-types.ts · colors.ts · fonts.ts · scene.ts · view-model.ts · tags.ts · zones-layer.ts · helper.ts (phase 5)
│  │  │       session.ts (phase 7: workspace, connection, presence) · index.ts
│  │  └─ test/ fake-shell.ts · builders.ts · fake-remote.ts · shared-builders.ts · testing.ts (phase 7) · *.test.ts
│  │           (test/testing.ts is published as `@fm/editor/testing` so sync-tests can reuse FakeShell and builders)
│  │           scenarios/ demo-steps.ts (shared step helpers) · demo.test.ts · demo-narrated.test.ts (phase 8)
│  ├─ web/                       @fm/web: React + Canvas2D + browser adapters (phase 4)
│  │  ├─ index.html · vite.config.ts · playwright.config.ts
│  │  ├─ src/ main.tsx · app.tsx · store.ts
│  │  │       adapters/ web-host.ts · input.ts · timers.ts · renderer.ts · canvas2d-renderer.ts · effect-runner.ts · ws-server.ts (phase 7)
│  │  │       panels/ Toolbar.tsx · CommandBar.tsx · PropertiesPanel.tsx · StatusBar.tsx · Toast.tsx · ProjectList.tsx (phase 7)
│  │  └─ e2e/ *.spec.ts · support/canvas.ts (phase 5; phase 7 appends) · support/demo-driver.ts (phase 8)
│  ├─ server/                    @fm/server (phase 6)
│  │  ├─ src/app/ ports.ts · queue.ts · decide-submit.ts · server-app.ts
│  │  ├─ src/adapters/ json-file-repository.ts · domain-validator.ts · ws-transport.ts
│  │  ├─ src/main.ts
│  │  ├─ scripts/dev-server.sh    restart loop (crash-only, spec §7.2) · smoke.ts · seed-demo.ts (phase 8)
│  │  └─ test/
│  └─ sync-tests/                @fm/sync-tests: two headless editors + in-memory server app (phase 7)
├─ scripts/                      @fm/scripts workspace package (phase 8): build-room.ts (domain-only demo step 9b) · demo.sh (`pnpm demo`)
└─ docs/ specs/ · plans/ · reports/ · design-memory/
```

---

## Shared contracts

Phase files implement these names and shapes exactly. A phase that needs something more adds it (never renames) and lists it under `## Contract extensions` at the end of its file; those sections are part of the contract. Later phases build on the earlier phase files' actual code, not only on this summary.

### `@fm/protocol` (phase 1; messages in phase 6)

```ts
// util.ts
export type Point = { x: number; y: number };
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export function ok<T>(value: T): { ok: true; value: T };
export function err<E>(error: E): { ok: false; error: E };
export function unwrap<T, E>(r: Result<T, E>): T;           // throws Error(JSON.stringify(error)); scripts and tests only
export function assertNever(x: never): never;               // throws Error(`Unexpected: ${JSON.stringify(x)}`)
export function deepEqual(a: unknown, b: unknown): boolean; // plain JSON values
export function isRecord(v: unknown): v is Record<string, unknown>;   // non-null, non-array object (phase 1)

// patch.ts
export type TableName = "joints" | "walls" | "zoneLabels";
export const TABLE_NAMES: readonly TableName[];             // ["joints", "walls", "zoneLabels"]
export function isTableName(v: unknown): v is TableName;
export type EntityKey = { table: TableName; id: string };
export type EntityValue = { id: string } & Record<string, unknown>;
export type Patch = { puts: { table: TableName; entity: EntityValue }[]; deletes: EntityKey[] };
export type Expectation = EntityKey & { lastCs: string | null };
export type Changeset = { id: string; patch: Patch; expect: Expectation[] };
export type StoredDocument = Record<TableName, Record<string, EntityValue>>;
export type VersionMap = Record<TableName, Record<string, string>>;   // id → lastCs; absent = never existed
export function keyOf(k: EntityKey): string;                           // "walls/w1"
export function uniqueKeys(keys: EntityKey[]): EntityKey[];            // first occurrence wins, order kept
export function patchWrites(p: Patch): EntityKey[];                    // puts then deletes, unique
export function emptyStored(): StoredDocument;
export function emptyVersions(): VersionMap;
export function applyStoredPatch(doc: StoredDocument, p: Patch): StoredDocument;        // pure
export function stampVersions(v: VersionMap, p: Patch, changesetId: string): VersionMap; // puts and deletes (tombstones)
export function buildExpectations(v: VersionMap, keys: EntityKey[]): Expectation[];      // unique keys, lastCs or null
export function failedExpectations(v: VersionMap, expect: Expectation[]): EntityKey[];   // [] = all hold
export function canonicalJson(value: unknown): string;                                   // object keys sorted

// messages.ts (phase 6)
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
export type ParseFailure = { reason: RejectReason; changesetId: string | null };
export function parseClientMessage(raw: string): Result<ClientMessage, ParseFailure>;  // size, JSON, shape, changeset structure
export function parseServerMessage(raw: string): Result<ServerMessage, string>;
export function validateChangeset(value: unknown): Result<Changeset, string>;          // structural rules, spec §4.1 and §7.9 j
export function isWireId(v: unknown): v is string;   // the one ID pattern, minus Object.prototype names; the domain's isValidId delegates to it from phase 6
// also exported (phase 6): MAX_NAME_CHARS, utf8Length, parseProjectMeta, parseStoredDocument, parseVersionMap
```

### `@fm/domain` (phase 2)

```ts
// model.ts
export const WALL_THICKNESS = 0.2;   // metres
export const EPS = 0.001;            // 1 mm
export const MIN_EDGE = 0.01;        // metres
export const MIN_FACE_AREA = 0.01;   // m²
export const MAX_NAME_LENGTH = 200;
export type Joint = { id: string; x: number; y: number };
export type Wall = { id: string; a: string; b: string };
export type ZoneLabel = { id: string; at: Point; name: string };
export type Document = { joints: Record<string, Joint>; walls: Record<string, Wall>; zoneLabels: Record<string, ZoneLabel> };
export type EntityRef = EntityKey;
export function emptyDocument(): Document;

// errors.ts
export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8";
export type Violation = { invariant: InvariantId; message: string; entities: EntityKey[] };
export type DomainErrorKind =
  | "notFound" | "invalidInput" | "overlap" | "crossing" | "tooShort" | "topology" | "invalid" | "notInRoom" | "format";
export type DomainError = { kind: DomainErrorKind; message: string; violations: Violation[] };
// messages are user-facing toasts: "Wall too short", "Walls can't cross", "Walls can't overlap",
// "Intersection would create a wall shorter than 1 cm", "Click inside a room", …

// geometry.ts: add, sub, scale, dot, cross, length, distance, normalize (Point | null), perpLeft,
//   distanceToSegment, projectOnSegment → { point, t }, segmentIntersection → SegmentHit,
//   lineIntersection (Point | null), signedArea (CCW > 0), pointInPolygon, isSimplePolygon
export type SegmentHit =
  | { kind: "none" }
  | { kind: "point"; point: Point; t: number; u: number }
  | { kind: "overlap"; length: number };   // collinear overlap longer than EPS

// shape.ts (I8)
export function isValidId(v: unknown): v is string;   // /^[A-Za-z0-9_.:/-]{1,128}$/ and not an Object.prototype member name
export function parseJoint(v: unknown): Joint | null;
export function parseWall(v: unknown): Wall | null;
export function parseZoneLabel(v: unknown): ZoneLabel | null;
export function fromStored(stored: StoredDocument): Result<Document, DomainError>;   // shape only
export function toStored(doc: Document): StoredDocument;

// validate.ts
export function validateDocument(doc: Document): Result<void, Violation[]>;

// patch.ts
export type DomainPatch = Patch & {
  before: (EntityKey & { value: EntityValue | null })[];
  dependencies: EntityKey[];
};
export function diffPatch(before: Document, after: Document, dependencies: EntityKey[]): DomainPatch;
export function applyPatch(doc: Document, p: Patch): Result<Document, DomainError>;   // shape-checks puts; does not validate
export function invertPatch(p: DomainPatch): Patch;
export function changesTopology(doc: Document, p: Patch): boolean;                    // doc = state before p
export function entityValue(doc: Document, key: EntityKey): EntityValue | null;

// graph.ts
export function incidentWalls(doc: Document, jointId: string): string[];             // sorted IDs
export function sortedIds<T>(table: Record<string, T>): string[];

// commands
export type JointRef = { existing: string } | { at: Point };
export type Command =
  | { type: "addWall"; opId: string; from: JointRef; to: JointRef }
  | { type: "moveJoints"; moves: { jointId: string; to: Point }[] }
  | { type: "setWallLength"; wallId: string; length: number; keep: "a" | "b" }
  | { type: "labelZone"; id: string; at: Point; name: string }
  | { type: "renameZone"; id: string; name: string }
  | { type: "deleteEntities"; ids: EntityRef[] };
export function execute(doc: Document, cmd: Command): Result<{ doc: Document; patch: DomainPatch }, DomainError>;

// queries
export function wallOutlines(doc: Document): Map<string, Point[]>;   // CCW polygon per wall, within its body plus outer miters/bevels; through the joint at 3+ walls (spec §3.5)
export type Face = { readonly key: string; readonly jointIds: readonly string[]; readonly wallIds: readonly string[]; readonly ring: readonly Readonly<Point>[] };  // centreline ring, CCW
export type Zone = { readonly face: Face; readonly floor: readonly Readonly<Point>[] | null; readonly area: number | null; readonly unavailable: string | null; readonly labelIds: readonly string[] };   // labelIds sorted by ID
export function zones(doc: Document): readonly Zone[];               // memoized by document identity: documents are immutable values; results are shared and deeply read-only
export function orphanLabelIds(doc: Document): readonly string[];
export function faceAt(doc: Document, p: Point): Face | null;        // null on a boundary (within EPS) or outside
export function wallHelperDimension(doc: Document, wallId: string): { a: Point; b: Point; length: number } | null;
export function hitCandidates(doc: Document, p: Point, tolerance: number): EntityRef[];   // joints first, then walls; by distance, then ID

// serialize.ts
export type DocumentJson = { format: "flatmate"; version: number; joints: unknown; walls: unknown; zoneLabels: unknown };
export const CURRENT_VERSION = 1;
export function serialize(doc: Document): DocumentJson;
export function deserialize(json: unknown): Result<Document, DomainError>;

// scripts.ts
export function rectangleRoom(origin: Point, width: number, height: number, opPrefix?: string): Command[];
```

### `@fm/editor` (phases 3, 5, 7)

```ts
// ports/host.ts
export type FontSpec = { family: string; size: number; weight?: number };   // size in px
export interface Host {
  textMetrics(text: string, font: FontSpec): { width: number; ascent: number; descent: number };
  now(): number;
  newId(): string;
}

// types.ts
export type Mods = { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
export type Size = { width: number; height: number };
export type ToolName = "select" | "wall" | "zone";
export type SnapKind = "endpoint" | "midpoint" | "onWall" | "grid" | "none";
export type SnapResult = { point: Point; kind: SnapKind };
export type ProjectInfo = { id: string; name: string };
export type RemotePresence = { clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[] };

// ports/effects.ts
export type WorkspaceOp =
  | { type: "list"; requestId: string }
  | { type: "create"; requestId: string; name: string }
  | { type: "open"; projectId: string; generation: string };
export type Effect =
  | { type: "render"; scene: Scene; view: ViewModel; camera: Camera }   // the shell never reads editor state
  | { type: "workspace"; op: WorkspaceOp }
  | { type: "saveSnapshot"; projectId: string; writeId: string; content: string }   // X1: declared, never emitted
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] }
  | { type: "startTimer"; timerId: string; ms: number }
  | { type: "cancelTimer"; timerId: string };

// ports/events.ts
export type UiAction =
  | { type: "createProject"; name: string }
  | { type: "openProject"; id: string }
  | { type: "showProjectList" }
  | { type: "pickTool"; tool: ToolName }
  | { type: "setField"; fieldId: string; value: string }
  | { type: "undo" } | { type: "redo" };
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
  | { type: "key"; key: string; mods: Mods }                 // KeyboardEvent.key, except digits and "." from the physical code (§5.4): "w", "Enter", " ", "Escape", "Backspace", "Delete", "6", "."
  | { type: "ui"; action: UiAction }
  | { type: "timerFired"; timerId: string }
  | { type: "workspaceEvent"; event: WorkspaceEvent }
  | { type: "saveResult"; writeId: string; ok: boolean; error?: string }   // X1: ignored
  | { type: "serverEvent"; event: ServerEvent }
  | { type: "viewportResized"; size: Size; devicePixelRatio: number };

// camera.ts: screen y points down, world y points up
export type Camera = { center: Point; zoom: number; viewport: Size; dpr: number };   // zoom = px per metre
export const DEFAULT_ZOOM = 80;
export function screenToWorld(c: Camera, p: Point): Point;
export function worldToScreen(c: Camera, p: Point): Point;
export function zoomAt(c: Camera, screen: Point, factor: number): Camera;   // world point under cursor stays fixed; zoom clamped to [5, 2000]; a factor that is not finite and > 0 returns c
export function panBy(c: Camera, dx: number, dy: number): Camera;           // screen px

// snapping
export type SnapCandidate = { point: Point; kind: Exclude<SnapKind, "none">; priority: 1 | 2 | 3 | 4; distance: number };   // priority derived from kind
export type SnapAxis = { origin: Point; dir: Point };                         // dir is (±1, 0) or (0, ±1)
export type SnapContext = { doc: Document; cursor: Point; gridSpacing: number;
                            axis: SnapAxis | null; excludeJoints: ReadonlySet<string>; excludeWalls: ReadonlySet<string> };
export type SnapPolicy = (ctx: SnapContext) => SnapCandidate[];
export const endpointPolicy: SnapPolicy; midpointPolicy: SnapPolicy; onWallPolicy: SnapPolicy; gridPolicy: SnapPolicy;
export function choose(cands: SnapCandidate[], tolerance: number): SnapCandidate | null;   // priority, then distance, then x, then y
export function gridSpacingFor(zoom: number): number;   // smallest of [0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10] with spacing·zoom ≥ 16 px
export function orthogonalAxis(origin: Point, cursor: Point): SnapAxis;
export function snapPoint(input: { doc: Document; cursor: Point; camera: Camera; mods: Mods; origin: Point | null;
                                   tolerancePx: number; excludeJoints?: ReadonlySet<string>; excludeWalls?: ReadonlySet<string> }): SnapResult;
//   Shift with an origin: project the cursor on the orthogonal axis; policies return only on-axis candidates
//   (on-wall = axis ∩ wall centrelines; grid = origin + round(t / s)·s along the axis). Ctrl: constrained cursor, kind "none".

// document/types.ts
export type Notice =
  | { type: "accepted"; id: string }
  | { type: "rejected"; id: string; reason: RejectReason }
  | { type: "remoteChange"; writes: EntityKey[]; topology: boolean }
  | { type: "resynced" }
  | { type: "offline" };
export type CommitInput = { id: string; patch: Patch; dependencies: EntityKey[] };
export type DocumentStatus = "not saved" | "unsaved changes" | "saving" | "saved" | "save failed" | "waiting for server" | "offline";
export type DocStep<D> = { doc: D; effects: Effect[]; notices: Notice[] };
export type LocalDocument = { kind: "local"; project: ProjectInfo; openId: string; doc: Document; revision: number; saving: { kind: "none" } };
export type SharedDocument = {             // phase 7
  kind: "shared"; project: ProjectInfo; generation: string;
  confirmed: { doc: Document; versions: VersionMap; seq: number };
  inFlight: Changeset | null;
  connection: "connected" | "syncing" | "offline";
  visible: Document;                      // cache: confirmed ⊕ inFlight while its expectations hold and the result validates
};
export type OpenDocument = LocalDocument | SharedDocument;   // phase 3 declares LocalDocument only; phase 7 widens it

// document/local-document.ts
export function createLocalDocument(project: ProjectInfo, openId: string, doc?: Document): LocalDocument;
// document/open-document.ts: the only module that switches on kind
export function visibleDoc(d: OpenDocument): Document;
export function canCommit(d: OpenDocument): boolean;
export function commit(d: OpenDocument, input: CommitInput): DocStep<OpenDocument>;   // throws if !canCommit (callers check)
export function onEvent(d: OpenDocument, e: ServerEvent, host: Host): DocStep<OpenDocument>;
export function status(d: OpenDocument): DocumentStatus;
export function isDirty(d: OpenDocument): boolean;

// history/history.ts
export type UndoEntry = { id: string; patch: DomainPatch; dependencies: EntityKey[]; status: "pending" | "usable" | "invalid" };
export type UndoRequest = { direction: "undo" | "redo"; id: string };   // id = commit ID of the history request
export type HistoryState = { past: UndoEntry[]; future: UndoEntry[]; pending: UndoRequest | null };
export const emptyHistory: HistoryState;
export function recordCommit(h: HistoryState, id: string, patch: DomainPatch): HistoryState;   // push pending entry, clear future
export function prepareUndo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string>;
export function prepareRedo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string>;
export type CommitInputWithoutId = Omit<CommitInput, "id">;
export function startRequest(h: HistoryState, req: UndoRequest): HistoryState;
export function applyHistoryNotice(h: HistoryState, n: Notice): HistoryState;
export function canUndo(h: HistoryState): boolean;   // top of past usable and no pending request
export function canRedo(h: HistoryState): boolean;

// tools/types.ts
export type WallPreview = { from: Point; to: Point } & ({ ok: true; doc: Document } | { ok: false });
export type WallToolState =
  | { kind: "idle" }
  | { kind: "drawing"; origin: Point; chainStart: Point; value: string; preview: WallPreview | null }
  | { kind: "paused"; origin: Point; chainStart: Point; segment: string };   // segment = commit ID (phase 7)
export type DragTarget = { kind: "joint"; jointId: string } | { kind: "wall"; wallId: string };
export type Moves = { jointId: string; to: Point }[];
// moves = what this attempt tried; release commits exactly these (fresh execute); doc = the attempt's result when ok, else the last valid preview (or baseDoc)
export type MoveAttempt = { ok: boolean; doc: Document; cursor: Point; moves: Moves };
export type SelectToolState =
  | { kind: "idle" }
  | { kind: "pressing"; pressWorld: Point; target: DragTarget | null } // threshold measured in world units at the current zoom
  | { kind: "moving"; target: DragTarget; pressWorld: Point; baseDoc: Document; attempt: MoveAttempt }
  | { kind: "editingHelper"; wallId: string; value: string };   // phase 5
export type ZoneToolState = { kind: "idle"; hoverFaceKey: string | null };   // phase 5
export type ToolState =
  | { name: "select"; state: SelectToolState }
  | { name: "wall"; state: WallToolState }
  | { name: "zone"; state: ZoneToolState };

// state.ts
export type EditorState = {
  mode: "local" | "server";
  document: OpenDocument | null;
  tool: ToolState;
  selection: EntityRef[];                 // zero or one entity
  hover: EntityRef | null;
  pointer: { screen: Point; world: Point; mods: Mods } | null;
  panDrag: Point | null;                  // last screen point of a middle-button pan
  snap: SnapResult | null;                // current snap (glyph and ViewModel)
  camera: Camera;
  snapSettings: { tolerancePx: number };  // 10
  undo: HistoryState;
  presence: Record<string, RemotePresence>;
  workspace: { projects: ProjectMeta[]; loading: boolean; error: string | null; opening: { projectId: string; generation: string } | null };
  toast: { text: string; until: number } | null;
  me: { clientId: string; name: string; color: string };
};
export type InitOptions = { mode: "local" | "server"; me: { clientId: string; name: string }; viewport: Size; dpr: number };
export function initialState(opts: InitOptions, host: Host): EditorState;
//   local: document = createLocalDocument({ id: "local", name: "Untitled" }, host.newId()); server: document null, workspace.loading true.
//   camera: center (3, 2), zoom DEFAULT_ZOOM, viewport and dpr from opts; tool: select idle; history empty; toast null.

// update.ts
export function update(state: EditorState, event: Event, host: Host): { state: EditorState; effects: Effect[] };
//   Always appends exactly one render effect (built from the final state) as the last effect.

// commit.ts
export type CommandOutcome = { state: EditorState; effects: Effect[]; committed: string | null };   // commit ID or null
export function runCommand(state: EditorState, cmd: Command, host: Host): CommandOutcome;
//   no document → nothing; !canCommit → toast ("Waiting for server" / offline message); execute error → toast(error.message);
//   a patch with no writes → nothing; otherwise id = host.newId(); commit; recordCommit; then applyNotices.
//   `committed` is the commit ID even if the document rejects it in the same step (check history, e.g. hasEntry).
// notices.ts
export function applyNotices(state: EditorState, notices: Notice[], host: Host): { state: EditorState; effects: Effect[] };
// toast.ts
export const TOAST_MS = 3000;
export function showToast(state: EditorState, text: string, host: Host): { state: EditorState; effects: Effect[] };  // startTimer "toast"
export function onToastTimer(state: EditorState, host: Host): { state: EditorState; effects: Effect[] };  // clears an expired toast; re-arms the timer if it fired early

// view/scene-types.ts
export type Color = string;
export type Width = { px: number } | { m: number };
export type Align = "left" | "center" | "right";
export type Primitive =
  | { kind: "segment"; a: Point; b: Point; width: Width; color: Color; cap: "butt" | "round"; dash?: number[] }
  | { kind: "polygon"; points: readonly Point[]; color: Color }
  | { kind: "arc"; center: Point; radius: number; from: number; to: number; width: Width; color: Color }
  | { kind: "disc"; center: Point; radius: Width; color: Color }
  | { kind: "text"; text: string; at: Point; size: number; color: Color; align: Align; rotation: number };  // size in px
// Units: dash lengths in screen px; arc radius in metres; angles and text rotation in world radians, CCW;
// text is drawn upright on screen, middle baseline, UI_FONT weight 400 (Host.textMetrics must measure the same font).
export type LayerName = "grid" | "zoneFills" | "walls" | "annotations" | "overlays" | "presence";
export type Layer = { name: LayerName; primitives: Primitive[] };
export type Scene = { layers: Layer[] };   // always all six layers, in this order
// view/colors.ts: export const COLORS = { background, grid, gridMajor, wall, wallSelected, wallHover, preview, invalid,
//   handle, handleFixed, snap, zoneFill, zoneFillSelected, zoneHint, text, textMuted, helper } as const  (values: phase 3)
// view/fonts.ts: export const UI_FONT = "Inter, system-ui, sans-serif"; TAG_FONT: FontSpec (12 px); HELPER_FONT: FontSpec (11 px)

// view/view-model.ts
export type Field = { id: string; label: string; value: string; unit: string | null; readOnly: boolean };
export type ViewModel = {
  activeTool: ToolName;
  commandBar: { prompt: string; value: string; unit: "m" | null };
  properties: { kind: "none" } | { kind: "wall" | "joint" | "zone"; fields: Field[] };
  cursor: "default" | "crosshair" | "move" | "pointer";
  snap: { kind: Exclude<SnapKind, "none">; at: Point } | null;
  presence: { clientId: string; name: string; color: string; at: Point | null }[];
  project: { name: string; status: DocumentStatus; dirty: boolean; canEdit: boolean } | null;
  projectList: { items: ProjectMeta[]; loading: boolean; error: string | null } | null;   // non-null only when no document is open
  toast: string | null;
  canUndo: boolean;
  canRedo: boolean;
};
export function buildScene(state: EditorState, host: Host): Scene;
export function buildViewModel(state: EditorState, host: Host): ViewModel;
```

Fixed interaction constants (editor): drag threshold 4 px; snap tolerance 10 px; hit tolerance 6 px; handle hit radius 8 px; toast 3000 ms; wall-tool prompts "First point", "Next point or length", "Waiting for server"; select prompt "Select"; helper prompt "Wall length"; zone prompt "Click inside a room"; lengths shown with `toFixed(2)`; areas as `10.64 m²`; unavailable area text "Area unavailable".

Property field IDs: wall `length` (read-only) and `thickness` (read-only, `0.20`); joint `x`, `y` (read-only); zone `name` (editable) and `area` (read-only).

### Test harness (phase 3, extended in phase 7)

```ts
// packages/editor/test/fake-shell.ts
export class FakeHost implements Host {       // ids "id1", "id2", …; clock starts at 0; text width = 0.6 · size · length
  time: number; advance(ms: number): void;
}
export class FakeShell {
  readonly host: FakeHost; state: EditorState; effects: Effect[];   // all effects since construction or clearEffects()
  static local(): FakeShell;                                        // unsaved LocalDocument, viewport 1200×800, dpr 1
  send(e: Event): Effect[];                                         // effects of this step
  moveTo(world: Point, mods?: Partial<Mods>): void;                 // world → screen with the current camera
  down(world: Point, mods?: Partial<Mods>, button?: 0 | 1 | 2): void;
  up(world: Point, mods?: Partial<Mods>, button?: 0 | 1 | 2): void;
  click(world: Point, mods?: Partial<Mods>): void;                  // move, down, up at the same point
  drag(from: Point, to: Point, mods?: Partial<Mods>): void;         // down, two moves, up
  key(key: string, mods?: Partial<Mods>): void;
  type(text: string, mods?: Partial<Mods>): void;                   // one key event per character
  ui(action: UiAction): void;
  fireTimer(timerId: string): void;
  wheel(deltaX: number, deltaY: number, mods?: Partial<Mods>): Effect[]; // at the current pointer, or the viewport centre
  doc(): Document;                                                  // visibleDoc; throws when no document is open
  view(): ViewModel;                                                // built from the current state; equal to the last render's view (pinned in update.test.ts)
  scene(): Scene;
  effectsOf<T extends Effect["type"]>(type: T): Extract<Effect, { type: T }>[];
  clearEffects(): void;
}
```

### `@fm/server` (phase 6)

```ts
// app/ports.ts
export interface ChangesetValidator { validate(docAfter: StoredDocument): { ok: true } | { ok: false; violations: string[] } }
export type Receipt = { seq: number; fingerprint: string };
export type ProjectState = { meta: ProjectMeta; seq: number; doc: StoredDocument; versions: VersionMap; receipts: Record<string, Receipt> };
export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>;
  create(name: string): Promise<ProjectState>;
  load(id: string): Promise<ProjectState | null>;
  save(state: ProjectState): Promise<void>;   // atomic; resolves after persistence completes
}
// app/queue.ts
export class KeyedQueue { run<T>(key: string, task: () => Promise<T>): Promise<T> }   // strictly one task at a time per key
// app/decide-submit.ts (pure)
export type SubmitDecision =
  | { kind: "reject"; reason: RejectReason }
  | { kind: "duplicate"; seq: number }
  | { kind: "accept"; next: ProjectState; seq: number };
export function fingerprintOf(cs: Changeset): string;   // sha256 of canonicalJson({ patch, expect })
export function decideSubmit(state: ProjectState, cs: Changeset, validator: ChangesetValidator): SubmitDecision;
// app/server-app.ts
export type Connection = { send(msg: ServerMessage): void; close(): void };
export type Session = { receive(raw: string): void; close(): void };
export type ServerApp = { connect(conn: Connection): Session; idle(): Promise<void> };   // idle: all queued work finished
export function createServerApp(deps: { repository: ProjectRepository; validator: ChangesetValidator; onFatal(error: unknown): void }): ServerApp;
// adapters
export function createJsonFileRepository(dir: string): ProjectRepository;      // data/<id>.json; tmp + fsync + rename (+ dir fsync)
export function createInMemoryRepository(): ProjectRepository & { failNextSave(error: Error, opts?: { afterWrite?: boolean }): void };   // app/testing.ts; afterWrite = the write reached "disk" before the error
export const domainValidator: ChangesetValidator;                               // adapters/domain-validator.ts
export function startWsTransport(app: ServerApp, opts: { port: number }): Promise<{ close(): Promise<void>; port: number }>;   // port 0 → ephemeral (tests)
```

### `@fm/web` (phases 4 and 7)

```ts
// adapters/renderer.ts
export interface Renderer { render(scene: Scene, camera: Camera): void; dispose(): void }
// adapters/canvas2d-renderer.ts
export function createCanvas2DRenderer(canvas: HTMLCanvasElement): Renderer;
export function drawPrimitive(ctx: DrawContext, p: Primitive, camera: Camera): void;   // DrawContext = the subset of CanvasRenderingContext2D used
// adapters/web-host.ts
export function createWebHost(): Host;
// adapters/input.ts
export function toMods(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Mods;
export function attachInput(canvas: HTMLCanvasElement, dispatch: (e: Event) => void): () => void;
// adapters/timers.ts
export function createTimers(dispatch: (e: Event) => void): { start(id: string, ms: number): void; cancel(id: string): void; dispose(): void };
// adapters/effect-runner.ts
export type ServerEffect = Extract<Effect, { type: "workspace" | "submit" | "presence" }>;
export type ServerEffectSink = (effect: ServerEffect) => void;   // phase 7 builds it from createWsServer; local mode passes null
export function createEffectRunner(deps: { renderer: Renderer; timers: Timers; server: ServerEffectSink | null; onView(view: ViewModel): void }): (effects: Effect[]) => void;
// adapters/ws-server.ts (phase 7)
export type WsServer = { send(msg: ClientMessage): void; sendPresence(msg: Extract<ClientMessage, { type: "presence" }>): void; close(): void };
export function createWsServer(opts: { url: string; clientId: string; name: string; dispatch(e: Event): void }): WsServer;
// store.ts
export function createEditorStore(opts: { initial: EditorState; host: Host }): {
  dispatch(e: Event): void;            // queued: a dispatch from inside an effect runs after the current one
  getState(): EditorState;             // tests and diagnostics only; adapters use effects
  getView(): ViewModel; publishView(view: ViewModel): void; subscribe(fn: () => void): () => void;   // a view exists from the initial state
  setRunner(run: (effects: Effect[]) => void): void;
};
// @fm/editor index must export: update, initialState, buildViewModel, buildScene, screenToWorld, worldToScreen, COLORS, UI_FONT,
// TAG_FONT, HELPER_FONT and the types Host, FontSpec, Event, Effect, EditorState, ViewModel, Field, Scene, Layer, Primitive, Width,
// Camera, Mods, UiAction, ToolName, ServerEvent, WorkspaceEvent (phase 4 relies on them), plus NO_MODS. Values are only these
// and later phases' own appends: no document, history or camera writes (state changes only through update; phase 3 wave 8).
```

---

## Report template and running log

- Report template: [`docs/reports/TEMPLATE.md`](../../reports/TEMPLATE.md).
- Each phase file ends with an empty `## Sprint log` table. Add a row for every finding as it happens: date, task, kind (issue / plan change / spec change / lesson), what happened, what was done, and where it was recorded in memory.
