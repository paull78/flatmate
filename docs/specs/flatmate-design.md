# Flatmate — Design

**Date:** 2026-09-27 (rev. 5, demo scope cuts and prioritized follow-ups; plan-time clarifications 2026-09-27; follow-up designs §6.2 and §12 revised 2026-09-29)
**Purpose:** A small, polished collaborative 2D CAD editor for floor plans, for interior architects.
**Goal:** Capture what makes that kind of tool good (fast, precise, keyboard-first, collaborative 2D drawing), built on a **portable, hexagonal core** that could live in a browser, a server, a test harness or another host.

---

## 1. What we're building

### 1.1 The spirit of the tool

"Figma for 2D CAD": strictly 2D, browser-based, real-time multiplayer. Its distinctive traits:

- **BIM-lite elements**: walls are *walls* (with thickness, joined at corners), not lines.
- **One-click zones**: click inside a closed set of walls → a room ("Zone") appears with a tag showing its name and live m² area.
- **Associative dimensions**: dimensions linked to geometry (padlock icon) follow it when it moves; helper dimensions can be clicked and typed into to resize a wall.
- **Keyboard-first, AutoCAD-flavoured commands**: short letter codes (`W` wall, `Z` zone, `DI` dimension), an active command bar, typed distances while drawing, `Esc` cancel, `Enter`/`Space` confirm.
- **CAD-grade snapping**: endpoint, midpoint, nearest, perpendicular, grid; `Shift` = orthogonal, `Ctrl` = ignore snaps.
- **Collaborative by default**: multiple live cursors, shared document, auto-save.
- **Local workspaces**: a workspace is a folder of drawings.
- **Engineering**: a portable core behind thin platform shells, and a custom WebGL2 renderer with *analytic antialiasing*. This design borrows its shape from **Crux** (Red Badger's portable Rust core + thin platform shells).

### 1.2 Feature tiers

**Demo-critical** — the demo does not work without these:

| # | Feature |
|---|---------|
| F1 | **Wall tool** (`W`): click-click chained walls, live length/angle, typed length along the cursor direction, exact key transitions (§5.5) |
| F2 | **Wall network**: shared joints, mitered corners, T-junctions; a new wall may start or end on an existing wall, splitting it |
| F3 | **Snapping**: endpoint, midpoint, on-wall, aligned, grid, and in the wall tool 15° angle steps and perpendicular; snap glyph; `Shift` orthogonal, `Ctrl` bypass |
| F4 | **Zones** (`Z`): click inside an enclosed area → zone tag with name and live clear area in m² |
| F5 | **Helper dimensions**: selected wall shows its length; click it, type a value, the wall resizes keeping connections |
| F6 | **Select tool** (`V`): click one entity, drag-move (one undo step per gesture), `Delete` |
| F7 | **Undo/redo**: local to each user, whole-changeset-or-nothing |
| F8 | **Projects on the server**: list, create by name, open |
| F9 | **Two-client collaboration**: server-validated changesets, live cursors |
| F10 | **Canvas2D renderer** behind the `Renderer` port |

**First follow-ups (architecture showcases, §11), developed in parallel:**

| # | Feature |
|---|---------|
| M1 | **MCP server: Claude as a collaborator.** A new shell (`packages/mcp`) runs the headless editor against the server, so Claude's edits go through the same validation and appear live in every window, with a "Claude" cursor (§12). |
| S1 | **WebGL2 SDF renderer** (Zed-style) for geometry, live toggle with Canvas2D. Text stays on a Canvas2D overlay layer (§6.2). |

**Later follow-ups** (ordered in §11; offline editing requires a later collaboration design):

| # | Feature |
|---|---------|
| X1 | **Local-folder workspace**: create and open files in a folder as local documents with autosave (§7.0, §7.8) |
| X2 | **Standalone associative dimensions** (`DI`), linked/unlinked |
| X3 | **Offline editing, deferred beyond initial collaboration** (§7.7) |

### 1.3 Non-goals (explicitly out)

- Openings (doors/windows), arc walls, wall alignment (walls are centre-aligned), editable wall thickness (fixed at 0.20 m), layers, styles, blocks, canvases/pages/views, hatches, comments, authentication, AI features, Safari.
- **Nested wall groups**: a group of walls standing inside a room does not cut a hole in that room (§3.6).
- Initial wall placement supports endpoint joins and T-junctions; a segment that crosses a wall in its interior is rejected. Initial room-area support targets simple closed rooms and a room split by one divider; other faces may show "Area unavailable" (§3.4, §3.6).
- Loop mode, perpendicular/angle snapping, multi- and box selection, arrow-key nudge, and standalone dimensions are follow-ups (§11).
- **Topology-changing moves**: moving or resizing cannot end intersecting or merged with other geometry; such edits are rejected (§3.4).
- **Partial undo**: an undo either reverts the whole changeset or is refused (§7.5).
- **Merging concurrent edits of the same entity**: the first writer wins, the second is rejected and reverted (§4).
- **Editing through remote changes**: a gesture whose entities are changed remotely is cancelled (§5.7).
- **Moving drawings between local and shared** (uploading a file to the server or downloading a project), and two tabs editing the same local file.
- **Offline persistence across reloads**, document change logs, persistent undo history, undo history across reconnects, receipt or tombstone compaction.
- Glyph atlas text in WebGL, thumbnails, generic `fetch` effect.

### 1.4 Demo script (5 minutes)

1. Open the app as Alice (`?name=Alice`); in the project list, create "Apartment".
2. `W`, holding `Shift` so directions stay orthogonal: click the origin, move right, type `6` `Enter`; move up, `4` `Enter`; move left, `6` `Enter`; click the first joint to close.
3. With `Shift` held, draw a divider from the bottom wall's midpoint (3, 0) to the top wall's midpoint (3, 4); the midpoint snap makes both points exact. T-junctions appear and the bottom and top walls split. Coordinates are metres, with world y pointing up.
4. `Z`, click (1.5, 2) and (4.5, 2). Each room gets a tag showing 10.64 m² with 0.20 m walls.
5. Select the right exterior wall, whose `a` endpoint is (6, 0). Its helper highlights that fixed endpoint. Enter `3.5`: the top-right endpoint moves to (6, 3.5), the connected top wall slopes, and areas update.
6. Drag that top-right joint to (2, 2), so the final right wall intersects the divider. The preview turns red and reverts on release. Passing through geometry and ending valid remains allowed.
7. Open a second window as Bob (`?name=Bob`) and open "Apartment". Show live cursors. Bob moves a wall; Alice sees the room areas change.
8. Alice makes two successive valid moves of one joint, then undoes both. Bob next changes that joint: overlapping Alice history entries become unavailable, with an explanation that the drawing changed remotely.
9. Show a headless editor scenario and a script that builds a room through the domain API.
10. First follow-ups: ask Claude (MCP) to add a room or draw a small maze and watch it appear in both windows; toggle WebGL and Canvas2D live. Steps 1–9 are the complete Canvas2D demo.


---

## 2. Architecture overview

### 2.1 The inspiration: Crux

[Crux](https://github.com/redbadger/crux) is an open-source Rust framework by Red Badger for cross-platform apps:

- **Core**: all behaviour, written once. It never touches network, disk or screen.
- **Shells**: thin platform wrappers (Swift, Kotlin, TypeScript) that render UI and perform real I/O.
- They talk only by **messages**: the shell sends **events** in; the core answers with **effects** ("please save", "please render"). The shell performs them and sends results back as new events.

It is the Elm architecture applied to cross-platform apps. We apply the same idea in TypeScript.

### 2.2 Three rings

We separate *what a drawing is* from *how a human edits it interactively*, and both from *the platform*:

```
┌─────────────────────────────── SHELLS (platform-specific) ────────────────────────────────┐
│  web: React panels + Canvas2D/WebGL2 + DOM input + WebSocket   server: Node + JSON files  │
│  tests: fake shell                                             cli: scripts               │
│                                                                                            │
│   ┌───────────────────────── @fm/editor (platform-neutral UI logic) ───────────────────┐   │
│   │  tools state machine (Select, Wall, Zone) · selection · hover                      │   │
│   │  snapping engine · drag previews · typed-value input · camera (pan/zoom)           │   │
│   │  undo/redo stack · open document (local or shared, §7.0)                           │   │
│   │                                                                                    │   │
│   │  IN:  abstract Events   (pointer{screen, mods}, key, timerFired, serverEvent, ...) │   │
│   │  OUT: Effects           (render{scene, viewModel}, submit, saveSnapshot, ...)      │   │
│   │                                                                                    │   │
│   │     ┌─────────────────────── @fm/domain (the document kernel) ─────────────────┐    │   │
│   │     │  Document: tables of joints, walls, zoneLabels                            │    │   │
│   │     │  Commands: execute(doc, cmd) → { doc', patch }     | DomainError          │    │   │
│   │     │  validateDocument(doc) → ok | violations                                  │    │   │
│   │     │  Patches: apply, invert                                                   │    │   │
│   │     │  Queries: wall outlines, zones, areas, wall helpers, hit candidates        │    │   │
│   │     │  No UI concepts. No I/O. No knowledge of "tool" or "selection".            │    │   │
│   │     └──────────────────────────────────────────────────────────────────────────┘    │   │
│   └────────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
        Dependencies point inward only: shells → editor → domain. Enforced by lint rules.
```

- **domain** knows what a valid floor plan is and how to change it.
- **editor** knows how a *human* changes it — gestures, tools, snapping, undo — but knows nothing about DOM, React, WebGL or network.
- **shells** translate the real world into events, and effects into real actions.

### 2.3 Who uses what

| Host | Uses | Example |
|------|------|---------|
| Web app | editor + domain | interactive drawing |
| Headless editor | editor + domain, fake shell | E2E tests from gestures to changesets; scripted demos; bug replay |
| Server | protocol; domain only through the `ChangesetValidator` port | store, validate, broadcast |
| Web app without a server | editor + domain, unsaved `LocalDocument` | draw and undo before the server exists; one drawing, no project list (§10 steps 4–5) |
| Scripts / AI agent | domain only | build a 4 × 5 m room with four `addWall` commands, read `zones(doc)` |
| MCP server (Claude, follow-up M1) | editor + domain, like a headless window connected to the server | Claude calls tools; each edit is a `command` event through the editor's commit path and the server (§12) |

### 2.4 Packages and allowed imports

```
packages/
├─ protocol/   @fm/protocol   wire messages + validators, Patch and Changeset types
├─ domain/     @fm/domain     document kernel
├─ editor/     @fm/editor     platform-neutral interaction core
├─ web/        @fm/web        React + renderers + browser adapters
├─ server/     @fm/server
│   ├─ src/app/               store, sequencing, broadcast; declares ChangesetValidator port
│   ├─ src/adapters/          ws transport, json-file repository, domain-validator adapter
│   └─ src/main.ts            composition root: wires domain-validator into app
├─ sync-tests/                tests only: two headless editors against the in-memory server app (§9)
└─ mcp/        @fm/mcp        follow-up M1: MCP server over stdio = headless editor + WebSocket client (§12)
```

`Result`, `assertNever` and `Point` live in `@fm/protocol` (the innermost package) so every package, including `server/src/app`, shares them.

```
web ─────► editor ─────► domain ─────► protocol
 │           │                             ▲
 └───────────┴─────────────────────────────┤
server/app ────────────────────────────────┘      (never imports domain)
server/adapters/domain-validator ──► domain       (the only server file that does)

mcp (M1) is a shell like web: editor, domain, protocol through their entries; nothing imports it

domain, editor, protocol, server/app:  no DOM lib, no React, no WebGL
domain, editor, protocol:              no Node built-ins either
```

Enforced by `dependency-cruiser` in CI and by per-package `tsconfig` `lib` settings (`["ES2022"]` for the cores).

---

## 3. Domain (`@fm/domain`)

### 3.1 API style: plain functions, not messages

The domain is **not** events-in/effects-out. It is a library of pure, synchronous functions. Events/effects are the *editor's* protocol because the editor lives in time (gestures, timers, network); the domain doesn't.

```
            driving side                           driven side
   (who calls the domain)                   (what the domain calls)

   editor            ──┐
   server validator  ──┼──►  [ domain API ]  ──►  nothing — no outbound ports
   scripts           ──┤     commands + queries
   tests             ──┘
```

The domain API **is** the inbound port.

```ts
// commands
execute(doc: Document, cmd: Command): Result<{ doc: Document; patch: DomainPatch }, DomainError>

// invariants
validateDocument(doc: Document): Result<void, Violation[]>

// value patches; callers validate after applying
applyPatch(doc, patch): Result<Document, DomainError>
invertPatch(patch: DomainPatch): Patch

// serialization
serialize(doc): DocumentJson
deserialize(json): Result<Document, DomainError>             // runs version migrations

// queries (pure)
wallOutlines(doc): Map<WallId, Polygon>
zones(doc): Zone[]
wallHelperDimension(doc, wallId): { a: Point; b: Point; length: number }
hitCandidates(doc, point, tolerance): EntityRef[]
```

Script usage, no editor involved:

```ts
let doc = emptyDocument();
for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
console.log(zones(doc).map(z => z.area));
```

`Result` is plain data (`{ ok: true, value } | { ok: false, error }`); `unwrap` throws on an error and is meant for scripts and tests only.

### 3.2 Document model: ECS-flavoured tables

Stored data only. Everything derivable is derived.

The domain defines `WALL_THICKNESS = 0.20` metres. Wall outlines and room-area calculations use this constant. Thickness is absent from wall records, command payloads and serialized documents. Any read-only thickness shown in the ViewModel is derived from the constant. Supporting variable thickness later requires an explicit schema change and migration.

```
Document
├─ joints:      Record<JointId, { id, x, y }>                        (metres)
├─ walls:       Record<WallId,  { id, a: JointId, b: JointId }>
└─ zoneLabels:  Record<LabelId, { id, at: Point, name }>
```

```
      J1 ●━━━━━━━━━━ W1 ━━━━━━━━━━● J2
         ┃                         ┃
         W4        "Kitchen"       W2        joints = graph nodes
         ┃         (label L1)      ┃        walls  = graph edges
      J4 ●━━━━━━━━━━ W3 ━━━━━━━━━━● J3       zone   = derived face containing L1
```

### 3.3 Invariants (`validateDocument`)

A document is valid when all of these hold (ε = 1 mm):

| # | Invariant |
|---|-----------|
| I1 | Every wall references two existing, distinct joints. |
| I2 | Every graph edge is at least **0.01 m** long, including split fragments and resized walls. Thickness comes from the domain constant `WALL_THICKNESS`; no per-wall thickness value is validated. Room-area validity is checked separately (§3.6). |
| I3 | Every joint is used by at least one wall. |
| I4 | No two joints are closer than ε. |
| I5 | **Planarity**: two walls intersect only at a joint they share. |
| I6 | No joint lies within ε of the body of a wall it does not belong to. |
| I7 | No two walls overlap collinearly. |
| I8 | All entity IDs, coordinates and label fields pass shape validation; numeric values are finite. IDs use `A–Z a–z 0–9 _ . : / -`, 1–128 characters, and never name an `Object.prototype` member (`constructor`, `__proto__`, …), because documents key entities by ID in plain objects. Label names are plain text of at most 200 UTF-16 code units; an empty name is allowed. |

The check is O(n²) segment tests; fine for floor plans of a few hundred walls. The same function is used by `execute`, by the client's local pre-check (§7.4) and by the server validator (§7.3).

### 3.4 Commands and the topology rule

```ts
type Command =
  | { type: "addWall";        opId: string; from: JointRef; to: JointRef }
  | { type: "moveJoints";     moves: { jointId: JointId; to: Point }[] }
  | { type: "setWallLength";  wallId: WallId; length: number; keep: "a" | "b" }
  | { type: "labelZone";      id: LabelId; at: Point; name: string }
  | { type: "renameZone";     id: LabelId; name: string }
  | { type: "deleteEntities"; ids: EntityRef[] };

type JointRef = { existing: JointId } | { at: Point };
```

**Topology rule.** Only `addWall` and `deleteEntities` may change the graph's topology. Every geometry command's result goes through `validateDocument`; the label commands shape-check the label they write, because labels take part only in I8. So a command on a valid document returns a valid document or an error. A move or resize whose **result** would violate an invariant (cross a wall, land on a wall, merge joints, shorten a wall below 0.01 m) returns `DomainError { kind: "topology" }` and the document is unchanged. In the editor the drag preview turns red and reverts on release.

**Only the destination matters, not the path.** A move is a teleport: a free-standing wall may be dragged "through" another wall as long as it ends somewhere valid. There is no swept-path check anywhere (client or server) — the document is a drawing, not a physics simulation.

**`addWall` normalisation**, in order:
1. Resolve `from`/`to`: a point within ε of an existing joint becomes that joint; a point within ε of a wall body splits that wall there.
2. Reject if the new wall would overlap an existing wall collinearly (I7).
3. Reject a new segment that intersects a wall except at a resolved endpoint joint. Interior crossings wait for a later follow-up (§11).
4. Validate.

**Deterministic normalisation.** The caller supplies the operation ID for entity creation. Inspect existing entities in lexicographic ID order; resolve equal-distance endpoint ties by entity ID. The new wall is always `${opId}/w0`; split fragments take `${opId}/w1`, `${opId}/w2` and new joints take `${opId}/j0`, `${opId}/j1`, each in `from`-then-`to` order. When splitting an existing wall, the fragment adjacent to its original `a` endpoint retains its ID; the other receives a new ID. Reject unresolved near-degenerate configurations. Identical documents and commands produce identical results in supported runtimes; cross-platform bitwise numerical identity is not promised.

Reject the entire command if any resulting edge is shorter than 0.01 m. A split failure reports "Intersection would create a wall shorter than 1 cm". A divider 0.30 m from a corner is valid if the other invariants hold.

**`setWallLength`** moves the non-kept joint along the wall's direction; other walls sharing that joint follow ("keeps connections"). **`deleteEntities`** deletes incident walls when a joint is selected, then removes joints left without walls (I3) and combines labels of rooms merged by the deletion (§3.6).

### 3.5 Wall outlines (mitered joins)

For each joint, sort incident walls by angle. For each pair of angularly adjacent walls, intersect their offset edge lines (± `WALL_THICKNESS / 2`) to get the shared corner. Straight-through equal-thickness joins share the continuous offset edges without a line-intersection calculation. Degree-1 joints end flat at the joint (no extension past it). Very sharp angles fall back to a bevel (miter limit 4). At a joint with three or more walls, each outline also passes through the joint point, so the joint's centre is covered. Inner corners stay inside the wall: on each side, when the reaches of the two ends' inner corners along the wall would sum to more than the wall's length less 2 mm, both are rescaled so they meet, and repeated points are dropped. Each outline is then a counter-clockwise polygon within its wall's body plus its outer miters and bevels. Accepted limitation for walls shorter than about twice the wall thickness: a clamped corner is no longer shared with the neighbouring wall, so small slivers of wall body near that joint can be left unfilled (the drawing stays valid; demo-scale walls are unaffected). An edge under 1 mm can also remain next to a nearly straight far join.

```
   degree 2 (corner)        degree 3 (T)              degree 1 (end)
   ══════╗                  ══════╦══════             ══════╡
         ║                        ║
         ║                        ║
```

### 3.6 Zone detection

1. On a copy of the graph, remove bridges (edges belonging to no cycle). These walls remain in the drawing but do not subtract from room area.
2. Split the remaining graph into connected components. Sort incident half-edges by angle and walk face boundaries with a consistent convention in world coordinates (y up). Discard each component's unbounded exterior face.
3. Ignore bounded walks with area below 0.01 m². Area calculation supports a single simple boundary ring. Repeated vertices, holes or other unsupported boundaries produce "Area unavailable"; the drawing remains editable.
4. Merge consecutive collinear boundary segments for area calculation. All walls have equal thickness, so these become continuous offset edges.
5. Offset each boundary inward by `WALL_THICKNESS / 2` (0.10 m) and intersect consecutive offset lines. Accept only a simple polygon with positive area whose inset edges retain their source direction (positive dot product and positive length). Otherwise show "Area unavailable: unsupported geometry". These conservative checks can decline valid complicated rooms and do not diagnose every failure as insufficient width.
6. Resolve labels by point containment in supported simple face rings, even when their inset area is unavailable. Unlabelled faces appear as faint hints while `Z` is active.

The result (rooms, and the room of each label) is computed once per document and cached by document identity; `zoneOfLabel(doc, labelId)` reads a label's room from that result. Wall outlines (§3.5) are cached the same way (P2).

The initial area display supports simple closed rings and two rooms made by a divider. For other bounded faces, the editor may show "Area unavailable" while keeping the drawing editable. Nested rings and bridge-connected loops are deferred (§11).

Clicking within ε of a room boundary does not create a label. Clicking an already labelled face selects its zone and highlights the floor shape; `labelZone` itself refuses a face that already holds a label (two concurrent labels of one room can still both be accepted and are both shown). Splitting a room leaves each label in the face containing its stored point. Moving joints (a drag or a wall resize) never changes which room a label belongs to: a label whose point no longer resolves to its room (the same face, identified by its boundary walls) moves to an interior point of that room (the floor's area centroid if inside, else the middle of the widest horizontal span through it); labels still inside their room stay where they are. Supported constraint: two moves of one room's joints that are both in flight at once can together push its label out (each alone kept it inside); the label then shows as an orphan on both clients until someone moves it back or relabels. When deletion merges labelled rooms, combine their labels into one as described below. Labels outside every supported face appear as orphans, "no enclosing walls": a label resolves to the innermost face containing its point, and it is an orphan when that face is unsupported (its walk repeats a joint) or the point is within ε of its boundary. Room identity is derived; labels are independent annotations.

Memoization by document identity avoids repeated queries within one editor state. Performance across edits must be measured separately.

**Merged-room labels.** When `deleteEntities` removes a divider between two labelled rooms and the resulting face is supported, combine their names with ` / `, for example `Kitchen / Dining`. The rule counts labels, not rooms: labels combine when, after the deletion, one supported face holds exactly two surviving labels that resolved to different faces before it; other merged rooms may be unlabelled (three rooms in a row with only the outer two labelled give `One / Three`). Order labels by lexicographic ID, retain the first label's ID and position, update its name, and delete the other. Names are plain text; preserve an existing slash verbatim. An empty name contributes nothing (`""` and `Dining` give `Dining`). A combined name longer than 200 code units is cut to 200 without splitting a character. Explicitly deleted labels are excluded. A single surviving label stays unchanged; an unlabelled room contributes no name. If deletion opens the rooms to the exterior, keep surviving labels as orphans instead of combining them. With three or more labels in the merged face (including a room that already held two, or an orphan that now resolves inside it) labels stay unchanged; general multi-label merges are deferred (§11). A label created while a concurrent deletion merges its room is not combined; both labels are shown, as with two concurrent labels.

The label changes belong to the same domain patch as the wall deletion. Include affected labels, the source faces' boundary entities and the merged face's boundary in semantic dependencies (the merge is only valid while that face stays closed). Undo restores the original wall geometry and separate label values/IDs atomically; redo restores the combined label. Recreating a divider through a new command follows the ordinary split rule and does not parse the combined name. This is a Flatmate behavior choice.

### 3.7 Serialization and versioning

```json
{ "format": "flatmate", "version": 1,
  "joints": {...}, "walls": {...}, "zoneLabels": {...} }
```

On save, write the **minimum version the content needs**; on load, apply **version-gated migrations as pure JSON visitors**. Files from a newer version are rejected with a readable error. Unknown fields are not preserved. A local file contains exactly this document (§7.8).

---

## 4. Domain patches and collaboration submissions

### 4.0 In plain terms: IDs, sequence numbers and versions

This subsection explains the mechanism simply; §4.1 onwards and §7 are the precise contracts. It applies only to shared documents: a `LocalDocument` has no changeset IDs, versions or `seq` (§7.0).

**Two identifiers, two questions.**

| | Changeset `id` | `seq` |
|---|---|---|
| Created by | the client that makes the edit (random UUID) | the server, when it accepts the edit |
| When | immediately, before sending | only if accepted |
| Answers | *which edit is this?* | *in what order did edits happen?* |
| Looks like | `"7f3a…"` | 41, 42, 43 … per project, no gaps |
| Used for | matching replies, spotting duplicate resends, stamping entity versions | making every client apply accepted edits in the same order |

Deli-counter analogy: the **id** is the name you write on your order slip; the **seq** is the number the cashier stamps when taking it. Rejected edits never get a `seq`, so a client that sees 41 then 43 knows it missed one and asks for a snapshot.

**The version map.** Next to the document, the server and every client keep a bookkeeping table: for each entity, the id of **the last changeset that wrote it** (`lastCs`). These are not hashes, just changeset ids.

```
Document (the drawing)                    Version map (bookkeeping, not part of the drawing)
──────────────────────                    ──────────────────────────────────────────────────
joints.J1 = { x: 0, y: 4 }                joints/J1  → "7f3a…"   ← changeset that last wrote J1
joints.J2 = { x: 6, y: 4 }                joints/J2  → "7f3a…"
walls.W1  = { a: J1, b: J2, … }           walls/W1   → "7f3a…"
walls.W4  = { a: J4, b: J1, … }           walls/W4   → "b21c…"
                                          walls/W8   → "e90d…"   ← tombstone: W8 was deleted by e90d
```

One rule fills it: **when a changeset is accepted, every entity it puts or deletes is stamped with that changeset's id.** Missing from the map means "never existed" (`lastCs: null`).

```
Start: empty project                       version map: {}

Alice draws the room: "7f3a…"              puts J1..J4, W1..W4
  accepted (seq 1)                         J1..J4, W1..W4 → "7f3a…"

Bob moves J1: "c9d2…"                      puts J1
  accepted (seq 2)                         J1 → "c9d2…"   (others unchanged)

Alice deletes W4: "e90d…"                  deletes W4
  accepted (seq 3)                         W4 → "e90d…"   (tombstone: value gone, version kept)
```

**Expectations.** When building an edit, a client copies the current version of every entity it writes or depends on: "I built this on these versions".

```
Alice moves J1 again → changeset "a1b2…"
  expect: joints/J1 @ "c9d2…", walls/W1 @ "7f3a…"      ("I saw Bob's version of J1")
  server: J1 still "c9d2…"?  yes → accept, stamp J1 → "a1b2…"
                             no  → someone changed it since → rejected{conflict}
```

Why changeset ids rather than a counter or `seq`:

1. **Known immediately**: the client names its edit before sending it, so it can recognise the edit when it comes back and resend it safely after a reconnect; a `seq` isn't known until acceptance.
2. **Never repeat**: a value comparison ("J1 is at (0, 4)") passes wrongly if J1 moved away and back; a UUID cannot come back.

Each client keeps two copies: the **confirmed** map (what the server accepted, mirrored) and the **visible** map (confirmed + stamps from its one pending edit). A new edit starts only when nothing is pending, so its expectations come from the confirmed map; the server checks them against its real map.

**Broadcast: your edit comes back to you too.**

```
Alice                         Server                         Bob
  │  submit c1 ──────────────►  │                               │
  │                             │ accept → seq 43               │
  │ ◄──── changes{43, c1} ──────┤──── changes{43, c1} ─────────►│
  │ ◄──── ack{c1, 43} ──────────┤                               │
```

- Everyone with the project open, **including the sender**, receives `changes{seq, changeset}`: one ordered stream applied identically everywhere, so `confirmed` at seq 43 is the same document on every machine.
- The sender recognises its own edit by id. The screen already shows it (optimistic update), so nothing moves; it is simply marked confirmed.
- `ack` (sender only) closes the request: "Waiting for server" → "Saved", undo becomes available.

**Concurrent edits.** The server processes submissions one at a time, in **arrival** order (not click order). The first gets the next `seq`; the second is checked against the document that already includes the first.

```
Case 1: different walls, valid together → both accepted
  Alice moves J1 (expects J1@c0)          Bob moves J7 (expects J7@c0)
  server: c1 first → seq 43;  c2 next → J7@c0 ✓, valid ✓ → seq 44
  both clients apply 43 then 44 → identical documents

Case 2: same wall → first writer wins
  Alice moves J1 (expects J1@c0)          Bob moves J1 (expects J1@c0)
  server: c1 first → seq 43, J1 now @c1;  c2 expects J1@c0 ✗ → rejected{conflict}
  Bob: his optimistic J1 is removed, J1 jumps to Alice's position, toast "Alice changed this first"

Case 3: different walls, invalid together → second rejected
  Alice moves J1, Bob moves J9; each alone is fine, together two walls would cross
  server: c1 → seq 43;  c2 expectations ✓ but validate(doc with c1 + c2) ✗ → rejected{invalid}
  Bob: J9 snaps back, toast "Walls can't cross"
```

Nobody's edit is silently overwritten or merged: expectations protect the entities each edit relies on, and validation of the combined result protects the drawing as a whole.

```
client makes edit ──► picks id (which edit?)
server accepts   ──► assigns seq (which position?) and stamps versions
server sends     ──► changes{seq, edit} to everyone incl. sender + ack to sender
every client     ──► applies accepted edits in seq order → identical copies
conflicts        ──► decided by arrival order; the later edit is rejected, never merged
```

### 4.1 Precise contract

The domain returns value changes. The editor adds the metadata needed to submit them.

```ts
// Shared structural types in @fm/protocol
type EntityKey = { table: TableName; id: string };
type EntityValue = { id: string } & Record<string, unknown>;
type Patch = {
  puts: { table: TableName; entity: EntityValue }[];
  deletes: EntityKey[];
};
type Changeset = {
  id: string; // fresh caller-generated UUID for each submission
  patch: Patch;
  expect: (EntityKey & { lastCs: string | null })[];
};
type TableName = "joints" | "walls" | "zoneLabels";

// Domain result, without collaboration versions
type DomainPatch = Patch & {
  before: (EntityKey & { value: EntityValue | null })[];
  dependencies: EntityKey[];
};
```

`before` records every written entity's previous value, including absence. `invertPatch` uses these values. `execute` receives no server versions; scripts can use its returned document directly. Commands that create entities receive explicit IDs from their caller.

A `SharedDocument` builds `expect` from its confirmed version map (equal to the visible one, because edits start only when nothing is pending) for every written entity and semantic dependency. Entries are unique; every put/delete requires an expectation, and puts and deletes cannot overlap. The server validates these structural rules before applying the patch.

Versions live in a separate map keyed by table and ID, on both server and client. Every put or deletion stamps `lastCs = changeset.id`. Deletion retains that map entry as a tombstone; `null` means the ID has never existed. Recreating an entity requires its deletion version. Tombstones persist with the project and are not compacted in this demo.

The server accepts a changeset only when every expectation holds and the resulting document validates. Read-only dependencies keep their versions. Every submission is accepted or rejected as a whole.

| Command | Semantic dependencies, in addition to all written entities |
|---------|-----------------------------------------------------------|
| Resize wall | Referenced wall, both endpoints, incident walls affected by the moving endpoint; plus any label the move relocates and the boundary walls and joints of its room |
| Move joints | Moved joints and their incident walls; plus any label the move relocates and the boundary walls and joints of its room |
| Add wall | Reused joints, split walls and their endpoints |
| Delete | Selected entities, walls deleted with a selected joint, endpoints of deleted walls (cleanup); labels combined by room merging, their source-face boundary entities and the merged face's boundary |
| Rename label | The label |
| Create label | Bounding walls and joints of the selected face |

Dependencies describe the command's meaning. Geometry examined only during full-document validation is not automatically a dependency. New geometric conflicts still fail validation: for example, two users who delete the two walls at one corner at the same time write disjoint entities, and the second is rejected as `invalid` (I3, the corner joint is left without walls), not as `conflict`. The same dependency sets drive gesture cancellation and history invalidation. History also records dependencies of the inverse, including created entities.

Same-entity writes or changed read dependencies conflict. Disjoint edits can both succeed if the combined document is valid. A second local edit cannot be committed until the outstanding edit settles. Version checks for undo are constructed when undo is requested (§7.5).

A topology change is a patch that creates/deletes a joint or wall, or changes a wall's endpoint references. Determine this from before/after values rather than trusting a client flag. Remote topology changes conservatively cancel geometry gestures and invalidate all history.

```text
execute(doc, command) → { doc, patch }
                         ├─ scripts use doc directly
                         └─ editor captures history and commits the patch to the OpenDocument (§7.0)
                              ├─ LocalDocument:  applies it now, revision + 1
                              └─ SharedDocument: attaches versions + submission ID
                                   → server: validation, persistence, broadcast
```

---

## 5. Editor (`@fm/editor`)

### 5.1 The core loop

```ts
update(state: EditorState, event: Event, host: Host): { state: EditorState; effects: Effect[] }
```

```
DOM input ─► web shell ─► editor.update(state, Event)          ← events in
                              │
                              ├─ domain.execute(doc, Command)   ← plain function call
                              ├─ domain.zones(doc) ...          ← plain function call
                              │
                              └─► { state', Effect[] }          ← effects out
```

### 5.2 Ports: where they are declared and used

Two kinds of port:

1. **Sync queries → injected `Host`**: the core needs the answer *now*, inside `update` — text width to hit-test a label, the current time, a new id.
2. **Async actions → effects as data** (the Crux style): the core asks the world to *do* something; the result arrives later as an ordinary event.

Splitting them keeps `update` synchronous (no promises or callbacks in the core) and makes every side effect assertable in tests.

```
packages/
├─ domain/                      ← no ports
├─ editor/src/ports/            ← PORTS DECLARED
│   ├─ host.ts                  ← interface Host { textMetrics, now, newId }
│   ├─ effects.ts               ← type Effect = render | workspace | saveSnapshot | submit | presence | startTimer | cancelTimer
│   └─ events.ts                ← type Event  = pointer | wheel | key | ui | timerFired | workspaceEvent | saveResult | serverEvent | viewportResized | command (M1)
├─ editor/src/document/         ← OpenDocument = LocalDocument | SharedDocument (§7.0)
├─ editor/src/update.ts         ← PORTS USED
├─ web/src/adapters/            ← ADAPTERS (browser)
│   ├─ web-host.ts              ← OffscreenCanvas.measureText, performance.now, crypto.randomUUID
│   ├─ input.ts                 ← DOM pointer/wheel/keyboard → Events (screen coordinates only)
│   ├─ effect-runner.ts         ← switch(effect.type) → adapter; results → dispatch(event)
│   ├─ timers.ts                ← setTimeout / clearTimeout
│   ├─ canvas2d-renderer.ts     ← Renderer port
│   ├─ webgl-renderer.ts        ← Renderer port (S1); webgl/ holds the pure instance builder and the shaders
│   ├─ ws-server.ts             ← workspace + submit + presence over WebSocket (shared documents)
│   └─ folder-workspace.ts      ← workspace + saveSnapshot over a local folder (follow-up X1, local documents)
└─ editor/test/fake-shell.ts    ← ADAPTERS (tests): fixed-width text, manual clock, collected effects
```

```ts
// editor/src/ports/host.ts
export interface Host {
  textMetrics(text: string, font: FontSpec): { width: number; ascent: number; descent: number };
  now(): number;
  newId(): string;
}

// editor/src/ports/effects.ts
export type Effect =
  | { type: "render";       scene: Scene; view: ViewModel; camera: Camera }   // the shell never reads editor state
  | { type: "workspace";    op: WorkspaceOp }        // list / create / delete / open (server or folder)
  | { type: "saveSnapshot"; projectId: string; writeId: string; content: string }   // local file only (X1)
  | { type: "submit";       projectId: string; generation: string; changeset: Changeset }   // shared only
  | { type: "presence";     projectId: string; generation: string; cursor: Point | null; selection: EntityRef[] }   // shared only
  | { type: "startTimer";   timerId: string; ms: number }
  | { type: "cancelTimer";  timerId: string };

// editor/src/ports/events.ts
export type Event =
  | { type: "pointerDown" | "pointerMove" | "pointerUp"; screen: Point; mods: Mods; button: 0 | 1 | 2 }
  | { type: "wheel"; screen: Point; deltaX: number; deltaY: number; mods: Mods }
  | { type: "key"; key: string; mods: Mods }
  | { type: "ui"; action: UiAction }                   // panel input, below
  | { type: "timerFired"; timerId: string }
  | { type: "workspaceEvent"; event: WorkspaceEvent }  // projects, created, failed (a local file's opened: X1)
  | { type: "saveResult"; writeId: string; ok: boolean; error?: string }
  | { type: "serverEvent"; event: ServerEvent }        // welcome, snapshot, openFailed, projectDeleted, changes, ack, rejected, presence, presenceLeft, connection
  | { type: "viewportResized"; size: Size; devicePixelRatio: number }
  | { type: "command"; command: Command };            // M1: a domain command from a shell without pointer input (§12)

type UiAction =                                        // what React panels send; tests send the same
  | { type: "createProject"; name: string }
  | { type: "openProject"; id: string }
  | { type: "deleteProject"; id: string }             // project list only; the panel confirms first (§7.2.1)
  | { type: "showProjectList" }
  | { type: "pickTool"; tool: "select" | "wall" | "zone" }
  | { type: "setField"; fieldId: string; value: string }   // properties panel, e.g. zone name → renameZone
  | { type: "undo" } | { type: "redo" };
```

Panels never change state themselves: they render the ViewModel and send `ui` events, so the project list, toolbar and properties behave the same in the headless editor.

**The editor owns the camera.** Pointer events carry screen coordinates only; the editor converts them to world coordinates. There is one camera authority.

**Adding a port later** follows the same two shapes. Two illustrative examples (not in the MVP):

```
"load this URL":        effect fetch{requestId, url}             → event fetchResult{requestId, ok, body}
"draw to native image": effect exportImage{requestId, scene, size} → event imageReady{requestId, image: <opaque handle>}
```

The core only ever holds opaque handles, never pixels or platform objects.

### 5.3 Editor state

```ts
type EditorState = {
  document: OpenDocument | null; // null = no drawing open; LocalDocument | SharedDocument (§7.0)
  tool: ToolState;               // discriminated union, one per tool
  selection: EntityRef[];           // zero or one entity in the initial build
  hover: EntityRef | null;
  pointer: { screen: Point; world: Point; mods: Mods } | null;   // last pointer position (typed-length direction, presence)
  camera: { center: Point; zoom: number /* px per metre */; viewport: Size; dpr: number };
  snapSettings: SnapSettings;
  undo: { past: UndoEntry[]; future: UndoEntry[]; pending: UndoRequest | null };
  presence: Record<ClientId, RemotePresence>;
  workspace: { projects: ProjectMeta[]; loading: boolean; error: string | null;
               opening: { projectId: string; generation: string } | null };   // project list (document null)
  toast: { text: string; until: number } | null;
  me: { clientId: string; name: string; color: string };   // name from the shell at startup (§7.2.1); colour from the server
};
```

### 5.4 Global input

| Input | Action |
|-------|--------|
| `V` / `W` / `Z` | switch tool |
| `Esc` | cancel current operation; a second `Esc` returns to Select |
| middle-drag, trackpad two-finger scroll | pan |
| `Ctrl`/pinch + wheel | zoom at cursor |
| `Cmd+Z` / `Cmd+Shift+Z` | undo / redo; one that applies drops the gesture in progress (wall chain, drag); a refused one only shows its toast |
| `Cmd+S` | save now (local file, X1); does nothing for in-memory and shared documents, so it is a no-op in the initial build |
| `Delete` / `Backspace` | delete selection (Select tool, or a selected zone in Zone tool; no active value field) |
| `Shift` held | orthogonal constraint |
| `Ctrl` held (not wheeling) | bypass snapping |

**Precedence** for a key press: (1) the active value field, if the tool is capturing a value; (2) command codes; (3) global shortcuts. `Space` never pans; it confirms, like `Enter`. Modifier-only key events (`Shift`, `Control`, …) are ignored.

**The cursor follows the camera.** When the camera moves under a still cursor (scroll, zoom, viewport resize, middle-drag pan), the editor recomputes the cursor's world point and the active tool sees it as a pointer move, so previews, snaps and typed-length directions match what is under the cursor.

**Typing lengths with `Shift` held.** The web input adapter reads digits and the decimal point from the physical key (`KeyboardEvent.code`: `Digit0`–`Digit9`, `Numpad0`–`Numpad9`, `Period`, `NumpadDecimal`), so `Shift`+`6` types `6` rather than `^`. The direction of a typed length uses the modifiers of the last pointer event, so releasing `Shift` before typing does not change it.

### 5.5 Wall tool: exact transitions

The **direction** of a typed length is always the current cursor direction from the last point, after snapping and the `Shift` orthogonal constraint.

| State | Input | Next state | Effect on the document |
|-------|-------|------------|------------------------|
| `idle` | click (press) at p | `drawing{origin: p, chainStart: p, value: "", dragFrom: cursor}` (the press's raw cursor point, before snapping) | — |
| `drawing` with `dragFrom` | release more than 4 px (the drag threshold) from `dragFrom`, snapped to q | `idle` (one drag = one wall; the chain ends) | `addWall(origin, q)`; if refused: toast, still `idle` |
| `drawing` with `dragFrom` | release within 4 px of `dragFrom`, or one that snaps back onto the first point | same, `dragFrom` cleared (it was a click: the chain goes on as below) | — |
| `idle` | `Esc` | Select tool | — |
| `drawing` | pointer move | same (preview wall origin→snapped cursor, live length/angle) | — |
| `drawing` | digit / `.` / `Backspace` | same, `value` edited | — |
| `drawing` | click at q | `drawing{origin: q, value: ""}` (a click ignores and clears a typed value) | `addWall(origin, q)` |
| `drawing` | click on `origin` (e.g. a double click) | same; ignored, no toast | — |
| `drawing` | click on `chainStart` joint | `idle` | `addWall(origin, chainStart)` (closes chain) |
| `drawing` | `Enter` / `Space` with value v | `drawing{origin: q, value: ""}` with q = origin + v · direction | `addWall(origin, q)` |
| `drawing` | `Enter` / `Space` with empty value | `idle` | — (finish chain) |
| `drawing` | `Esc` | `idle` (walls already added stay; the preview is dropped) | — |

**Drag to draw one wall (2026-09-30, user report).** Pressing, dragging and releasing from the chain's first point draws exactly one wall and ends the chain, because a release that did nothing left the wall "suspended" until the next click. Only the first point can start a drag: later presses place walls as clicks (on a shared document they also pause the chain, §7.4), so `dragFrom` is set only from `idle` and cleared on the first release (or by any placement). It keeps the raw cursor point, so a press snapped onto a nearby joint and released without moving stays a click. A remote change that reruns the preview keeps it, like the typed value. The threshold is the select tool's (4 px, measured in world units times the zoom, §5.7).

Fields not listed in a transition carry over unchanged; in particular `chainStart` stays with the chain through `drawing` and `paused` until the chain ends. A rejected `addWall` (e.g. collinear overlap) leaves the state unchanged and shows a toast.

**Pause and resume (shared documents).** With a `SharedDocument`, each placement that continues the chain pauses it until the server answers (§7.4). A `LocalDocument` accepts at once and never enters `paused`.

| State | Input | Next state | Effect on the document |
|-------|-------|------------|------------------------|
| `drawing` | click at q, or `Enter` / `Space` with a value | `paused{origin: q, chainStart, segment: id}` | `addWall(origin, q)` submitted |
| `paused` | pointer move | same; cursor tracked, no preview; status "Waiting for server" | — |
| `paused` | click, digit, `Enter`, `Space` | same; ignored, never queued | — |
| `paused` | `Esc` | `idle`; the submitted wall still settles | — |
| `paused` | `accepted` for `segment` | resume rule below | — |
| `paused` | `rejected` for `segment` | `idle`; toast with the reason | — |
| `paused` | remote change that cancels the chain (§5.7), or snapshot | `idle`; "Drawing changed remotely — wall chain ended" | — |

**Resume rule**, on `accepted` for the paused segment:

1. **Check the anchor.** The joint at q that the segment created or reused must still exist at q in the visible document. If not, end the chain: `idle`, Alice's accepted walls stay, show "Drawing changed remotely — wall chain ended". This is a backstop: §5.7 already ends a paused chain when a remote change touches its dependencies.
2. **Recompute the preview** from the visible document at the current cursor, exactly as on a pointer move, and enter `drawing{origin: q, chainStart, value: ""}`, so clicking the first joint still closes the chain. An invalid preview (for example, it would cross a wall Bob moved meanwhile) is drawn red like any invalid drawing preview; a click there is refused by `execute` with a toast. The chain is not ended for this: the preview depends on where the cursor happens to be, and moving it fixes the problem. Nothing is ever committed from a preview without a new click and a fresh `execute`.

Example: while Alice's segment is pending, Bob draws a wall across her next path. That is a remote topology change, so her chain ends at once (§5.7) with the message above; her pending segment still settles normally.

### 5.6 Other tools

```
   Select (V)                                   Zone (Z)
   idle                                         hover face → highlight
    ├ click entity → select one                 click unlabelled face →
    ├ press + move > 4 px on selection            create + select zone
    │  or its handle → moving                   labelled face/tag → select zone
    │    (preview, one changeset on release;
    │     red + revert if topology rejected)
    ├ click helper dimension → editing value (digits, Enter applies setWallLength, Esc cancels)
    └ Delete → delete selection
```

Selection rules:

- Zone selection uses the stored label ID as its stable reference and derives the highlighted floor shape from the enclosing walls. The UI calls it a zone. Clicking a labelled floor or its tag selects it; the Zone tool creates a label and selects the zone when the room is unlabelled.
- A selected zone exposes an editable name and read-only area in properties. Delete removes its label only, leaving walls and derived room geometry intact; allow this in Select and Zone tools when no text field is active. Zone selection does not move walls. An orphan label has no floor highlight and remains selectable through its tag for renaming or deletion.

- Pressing an unselected entity selects it at once, so the same press can start a drag.
- Selected walls expose joint handles; handles win hit-testing over wall bodies. Pressing a handle of the selected wall and moving past 4 px drags that joint; the selection stays on the wall.
- Moving a selected wall translates its two endpoints once by the pointer delta rounded to the grid; moving a selected joint moves that joint to the snapped pointer, ignoring the joint and its own walls as snap targets. Connected walls follow shared endpoints.
- Deleting a selected joint deletes its incident walls, then removes unused joints.
- Helper editing keeps endpoint `a` fixed and visibly marks it. Endpoint switching is deferred.
- While editing, the helper plate looks like a text field: a 1 px blue outline. Before the first key it shows the current length on a light blue fill, like selected text that typing replaces; from the first key the fill is white and the plate shows the typed value. The command bar shows "Wall length" (U2, 2026-09-30).

### 5.7 Gestures: preview and commit

Live feedback, **one** changeset per gesture.

```
pointerDown on selection ─► moving{ startWorld, baseDoc }
pointerMove ×N           ─► r = execute(baseDoc, moveJoints(delta + snap))
                             ok  → preview = r.doc          (drawn normally)
                             err → preview = last ok state, drawn red + ghost at cursor
                             effects: [render, presence]    (nothing persisted)
pointerUp                ─► if last attempt ok: commit the patch, capture history
                             else: discard, toast "Walls can't cross"
Esc during drag          ─► discard preview, back to idle
```

The release commits the last attempt's moves (what the preview showed) with a fresh `execute`; the pointer-up position and modifiers do not change it. A 4 px threshold at the current zoom separates click from drag. It is measured in world units (`distance · zoom`), so a scroll during a press, which moves the cursor's world point (§5.4), starts the drag.

**Remote changes during a gesture.** Record the command's semantic dependencies (§4); the wall chain also depends on its origin joint and, while paused, on the entities its pending segment writes. Per tool: a drag depends on the moved joints and their incident walls; a helper resize on the wall, both endpoints and the walls at the moving end; a drawing chain on the joint at its origin (checked by position, since the chain stores points); a paused chain on its pending segment's dependencies. Any remote topology change cancels an active geometry gesture; a paused wall chain counts as active. Other remote changes cancel only when their writes overlap the dependency set. A snapshot cancels every active gesture.

Cancellation drops the preview and ends a wall chain while preserving already committed walls. Show "Drawing changed remotely". Otherwise refresh `baseDoc` from the visible document and rerun the gesture with the same parameters. If geometry elsewhere makes that attempt invalid, show the ordinary invalid preview.

Selection and hover drop any entity that no longer exists.

### 5.8 Snapping

Independent **policies** return **candidates**; a pure **chooser** picks the best.

```
        cursor ─┬─► EndpointPolicy       (joints)                  priority 1
                ├─► MidpointPolicy       (wall midpoints)          priority 2
                ├─► PerpendicularPolicy  (foot from the origin)    priority 3   wall tool only
                ├─► OnWallPolicy         (nearest point on wall)   priority 4
                ├─► AnglePolicy          (15° rays from the origin) priority 5  wall tool only
                ├─► AlignedPolicy        (another joint's x and/or y) priority 6
                └─► GridPolicy           (grid spacing by zoom)    priority 7
                              │
                   candidates { point, kind, priority, distance }
                              ▼
          choose(): within tolerance (10 px, converted with camera zoom);
                    the grid candidate is the fallback and ignores the tolerance
                    → lowest priority, then smallest distance
                              ▼
          SnapResult { point, kind } → used by the tool; glyph drawn in the Scene
```

`Shift` restricts to orthogonal directions from the origin (applied before the chooser); `Ctrl` bypasses all policies. The grid step is the smallest of 1-2-5 × 10ⁿ m (1 cm to 10 m) that is at least 16 px on screen, so it changes with zoom (the drawn grid uses the same step); without `Ctrl`, a point always lands on the current grid unless an endpoint, midpoint, on-wall or aligned candidate is within the tolerance. **Aligned:** when the cursor's x (or y) is within the tolerance of another joint's x (or y), the point takes that joint's x (or y), on one axis or both; an unaligned coordinate stays on the grid. A thin guide line runs from each joint it lines up with. With `Shift`, only the axis's own coordinate lines up (x on a horizontal axis, y on a vertical one). The dragged joint does not count. Without it, a joint placed at one zoom could not be lined up again at another: the 0.2 m and 0.5 m grids do not contain each other's points. On-wall outranks grid, so an exact point on a wall comes from an endpoint or midpoint; the demo divider relies on the midpoint snap.

**Angle and perpendicular (wall tool only, 2026-09-30).** While the wall tool draws from a point (its origin), without `Shift` or `Ctrl`, two more policies run; joint drags and the other tools keep the snaps above. The wall tool turns them on explicitly (a joint drag also passes an origin, for `Shift`).

```
 angle: rays every 15° from the origin            perpendicular: the foot of the origin on a wall
        ·· 45°                                    wall ─────────┬─────────
      ··                                                        ⌐  (glyph: a right-angle mark)
   ●············ 0°   point = on the ray,                       │
 origin               length rounded to the grid                ● origin
```

- **Angle:** the ray nearest the cursor's direction, at a multiple of 15° from +x. The candidate's distance is the cursor's offset from the ray, so the 10 px tolerance applies across the ray. Its point is on the ray at a whole number of grid steps from the origin, like `Shift`. **Tie rule with aligned:** if another joint's x (or y) is within the tolerance and its line crosses the ray within the tolerance of the cursor, the point is that crossing instead (both guides are drawn). A ray parallel to the line gives no crossing.
- **Perpendicular:** for each wall, the foot of the perpendicular from the origin to the wall's centreline, if it lies within the wall and is not the origin itself. Its distance is from the cursor.
- **Glyphs:** angle draws a guide line from the origin to the point and the small dot of the aligned snap; perpendicular draws a small right-angle mark at the foot, turned to the wall. The wall tool's live label already shows the angle (`6.00 m  45°`).
- `Shift` still works as before; the demo keeps holding it (the angle snap now gives the same directions without it). A typed length follows the snapped direction, so it goes exactly along the ray.

### 5.9 Output: Scene and ViewModel

**Scene**: what to draw, in world coordinates, in ordered layers (like Zed's `Scene`):

```ts
type Scene = { layers: Layer[] };   // grid, zoneFills, walls, tags, annotations, overlays, presence
type Primitive =
  | { kind: "segment";  a: Point; b: Point; width: Width; color: Color; cap: "butt" | "round"; dash?: number[] }
  | { kind: "polygon";  points: Point[]; color: Color }
  | { kind: "arc";      center: Point; radius: number; from: number; to: number; width: Width; color: Color }
  | { kind: "disc";     center: Point; radius: Width; color: Color }
  | { kind: "text";     text: string; at: Point; size: number; color: Color; align: Align; rotation: number };
type Width = { px: number } | { m: number };  // screen-constant hairlines vs. world-scaled
// dash lengths are screen px; arc radius is metres; angles and text rotation are world radians, counter-clockwise;
// text size is px, drawn upright on screen with a middle baseline
```

**Unchanged layers keep their array (P3, 2026-09-30).** The three large layers are pure functions of a few inputs, and the Scene reuses the previous primitives array (the same object) when those inputs are identical: `walls` (the document drawn, the selected walls, the hovered wall, the walls drawn red for an invalid drag), `zoneFills` (the document, the selected labels, whether the Zone tool is active and the face it hovers) and `tags` (the document, the zoom, the Host, the selected labels). Zone tags have their own layer, just before `annotations`, so the paint order is unchanged. Panning changes none of these inputs, so only `grid`, `overlays` and `presence` are new arrays; a renderer may skip work for a layer whose array it has already seen (§6.2).

**ViewModel**: what the panels show, not how:

```ts
ViewModel = {
  activeTool: "wall",
  commandBar: { prompt: "Next point", value: "3.20", unit: "m" },
  properties: { kind: "wall", fields: [{ id: "thickness", label: "Thickness", value: WALL_THICKNESS, unit: "m", readOnly: true }] },
  cursor: "crosshair",
  snap: { kind: "endpoint", at: { x: 3, y: 0 } },
  presence: [{ name: "Bob", color: "#e67", at: { x: 1, y: 2 } }],
  project: { name: "Apartment", status: "saved", dirty: false, canEdit: true },
           // status: not saved | unsaved changes | saving | saved | save failed | waiting for server | offline
            // (unsaved changes, saving and save failed occur only with X1 local files)
  projectList: null,   // when no document is open: { items: [{ id, name }], loading, error }
  toast: null,
  canUndo: true, canRedo: false,
};
```

**Zone tags fit their room (2026-09-30).** Tag text has a fixed pixel size, so zoomed out it would spill over its room and pile up on its neighbours. A tag therefore shows only as much as fits inside its room's floor outline on screen (all four corners of the box inside the outline):

```
 fits with both lines     only the name fits      nothing fits
 ┌──────────┐             ┌──────┐                ┌──┐
 │ Kitchen  │             │Kitch…│ → name only    │  │ → hidden
 │ 12.54 m² │             └──────┘   (centred)    └──┘
 └──────────┘
```

A hidden tag is not drawn and is not a click target; clicking the room's floor still selects the zone (§5.6). A label in no room (orphan) always shows both lines. Zooming out therefore hides small rooms' tags first while large rooms keep theirs.

**Tag layouts are cached (P2, 2026-09-30).** A tag's layout depends only on the document, its label, the zoom and the Host's text widths, so it is computed once per (document, zoom, Host) and reused by drawing and by hit-testing (hover and clicks). Panning changes none of these, so it lays out no tags; each zoom step or document change lays them out again. The room holding a label is looked up in a table the domain builds with the rooms (§3.6), not searched per tag. Documents are immutable values, so the cache never serves a stale layout.

React renders the ViewModel as toolbar, command bar and properties panel; another host could render the same object differently; tests assert on it. **UI logic lives once in the editor; only the look is re-created per host.**

---

## 6. Rendering (`@fm/web` adapters)

```ts
interface Renderer {
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}
```

### 6.1 Canvas2D renderer (demo-critical)

Draws every primitive with the Canvas2D API. Also draws the `text` primitives for **both** renderers: text always lives on a Canvas2D overlay layer.

### 6.2 WebGL2 SDF renderer (follow-up S1)

Geometry primitives only (segments, arcs, discs, polygons); text is delegated to the Canvas2D overlay.

| Primitive | Technique | Antialiasing |
|-----------|-----------|--------------|
| segment | instanced quad; fragment shader evaluates the segment SDF; width in px or m; dashes by distance along the segment | **analytic** (SDF coverage) |
| arc / disc | instanced quad; ring/arc SDF | **analytic** |
| polygon | CPU triangulation (`earcut`), flat colour | MSAA only; wall polygon edges are covered by thin outline segments that the Scene's `walls` layer draws over each wall fill (in both renderers), so wall edges get analytic AA |

```
   quad per instance            fragment shader
   ┌──────────────┐             d = sdSegment(p, a, b) - width/2
   │   ●━━━━━━━●   │   ──►       coverage = clamp(0.5 - d * dpr, 0, 1)
   └──────────────┘             color.a *= coverage
```

`d` is an exact distance in CSS pixels, so `d * dpr` is in device pixels (the same as `d / fwidth(d)` for these fields, without derivatives). One draw call per non-empty (layer × primitive kind): layers in order, and within a layer polygons, segments, arcs, discs (Canvas2D keeps scene order, so the scene must not rely on paint order inside a layer where shapes of different kinds overlap: the helper's dimension line stops at its label plate instead of being covered by it. What remains differs only for an instant while dragging a joint: a snap guide ends under a handle disc, and the red ghost disc sits over an on-wall snap cross). Today's editor emits at most 10 such pairs (counts for the demo frames are pinned in the renderer tests). Camera centre, zoom, half viewport and dpr are uniforms. Each (layer × kind) batch has its own GPU buffer, built and uploaded only when its layer's primitives array is a new object (P3, 2026-09-30): a pan uploads the grid, overlays and presence, not the walls, floors or tag plates (§5.9). No speed is claimed unless measured (§6.3).

**Text:** under WebGL all text is drawn on the Canvas2D overlay above all geometry, so tag and helper text can cover handles, snap glyphs and remote cursors; Canvas2D keeps the scene's order. Translucent walls (the wall tool's preview) get a slightly darker rim where the edge segments overlap the fill, in both renderers.

**Canvases:** two, stacked. `gl-canvas` (WebGL2, no input) lies under the input canvas, which draws the whole scene under Canvas2D and only text (cleared transparent) under WebGL.

**Toggle (shell only):** a toolbar button and `?renderer=webgl|canvas2d`; the default is Canvas2D, and the editor never knows which renderer draws. The effect runner redraws the last scene with the new renderer at once. When WebGL2 is unavailable or its context is lost, the shell falls back to Canvas2D with a notice; there is no context restore.

**SDF debug view (shell only, 2026-09-30):** `?sdf=debug` makes the WebGL renderer show the distance field it antialiases with, because the normal picture is meant to look the same as Canvas2D. Segments, arcs and discs keep their colour inside the shape (d ≤ 0) and, outside it, draw alternating 4 px bands of their colour that fade out by 16 px (their quads grow to 16 px of padding in this mode only). Polygons (earcut, MSAA) draw as usual, so the view also shows which shapes are SDF and which are not. It changes nothing under Canvas2D, so toggling renderers in this mode switches between the plain picture and the field. The editor, the Scene and the draw-call counts do not change.

```
 normal:  ━━━━━━━━          ?sdf=debug:  ░▒░▒━━━━━━━━▒░▒░   bands every 4 px of distance, fading by 16 px
```

### 6.3 Measuring speed (shell and scripts only, P1, 2026-09-30)

Two tools, so speed claims come from numbers:

- **A large drawing:** `pnpm demo:seed-grid [N]` stores a project "Grid N×N": N × N square rooms of 3 m, each labelled ("Room i.j"), so 2N(N+1) walls, (N+1)² joints and N² labels (default N = 30). The document is written directly as joints, walls and labels (building it with `execute` wall by wall takes minutes at this size), then accepted through the server's ordinary submit decision as one changeset, so the domain validates it once. Run it before starting the server, like `demo:seed`; it is idempotent by name.
- **A readout:** `?perf` shows a small panel over the canvas, refreshed twice a second, with the average and worst of the last 120 samples of:
  - **update**: the editor's `update` call per event (the reducer, rooms and areas when the document changed, the Scene and the ViewModel);
  - **draw**: the renderer's frame. Under WebGL the frame ends with `gl.finish()` in this mode only, so it includes the GPU's work (and the Canvas2D text overlay); under Canvas2D it is the `drawScene` call. The panel names the renderer.
  - the Scene's primitive count.

  It changes nothing without `?perf`; the editor and the Scene do not change.

Rooms are cached per document (§3.6), so panning and zooming a drawing that does not change finds rooms once; an edit, and every drag preview, finds them again for the new document.

---

## 7. Open documents, collaboration and persistence

### 7.0 Open documents: local and shared

The drawing the editor has open is an **`OpenDocument`**: a domain `Document` plus the rule that decides when an edit becomes real. Two questions are kept apart:

```
"Is this edit real now?"     → acceptance   (who says yes?)
"Is this edit on disk yet?"  → persistence  (has it been saved?)
```

```ts
// editor/src/document/
type OpenDocument = LocalDocument | SharedDocument;   // EditorState.document: OpenDocument | null

type LocalDocument = {
  kind: "local";
  project: ProjectInfo;
  openId: string;                                    // fresh per open, like a shared generation
  doc: Document;                                     // the truth
  revision: number;                                  // +1 on every commit, undo and redo; restarts per open
  saving:
    | { kind: "none" }                               // in memory
    | { kind: "file"; savedRevision: number; failed: boolean;
        writing: { writeId: string; revision: number } | null };
};

type SharedDocument = {
  kind: "shared";
  project: ProjectInfo;
  generation: string;                                // §7.2.1
  confirmed: { doc: Document; versions: VersionMap; seq: number };   // mirror of the server (§7.4)
  inFlight: Changeset | null;
  connection: "connected" | "syncing" | "offline";
};
```

`null` means no drawing is open (the project list). An in-memory drawing is a `LocalDocument` with `saving: none`, not a separate kind. The `saving: file` branch and its adapter are specified below for X1; they are not part of the initial build.

| | In memory | Local file | Shared (server) |
|---|---|---|---|
| Kind | `LocalDocument`, `saving: none` | `LocalDocument`, `saving: file` | `SharedDocument` |
| Truth | the open document | the open document; the file is a snapshot that may lag | the server; `confirmed` mirrors it |
| Commit | accepted at once, never rejected | accepted at once, never rejected | shown at once; pending until `ack` or `rejected` |
| Next edit | at once | at once | after the outcome settles (§7.4) |
| Undo entry usable | at once | at once | after acceptance (§7.5) |
| Saving | none | whole-file snapshot (below) | the server saves before acknowledging (§7.2) |
| Failure | — | "Save failed"; edits kept, retried | rejection reverts the edit |
| Status | Not saved | Unsaved changes / Saving… / Saved / Save failed | Waiting for server / Saved / Offline |

**One interface, shaped by the harder case.** Tools, gestures, history and the ViewModel use only these functions. The `open-document` module is the only code that switches on `kind`.

```ts
visibleDoc(d): Document                           // draw, hit-test and execute against this
canCommit(d): boolean                             // may a document edit start now?
commit(d, { id, patch, dependencies }) → { d, effects, notices }  // caller picks id; local: [accepted] now; shared: [] + submit
onEvent(d, event, host) → { d, effects, notices } // server messages (host.newId for a new generation); X1: save results, timer
saveNow(d)             → { d, effects }           // Cmd+S: writes a local file; otherwise nothing
status(d): DocumentStatus                         // for the ViewModel

type Notice =
  | { type: "accepted"; id: string }
  | { type: "rejected"; id: string; reason: RejectReason }
  | { type: "remoteChange"; writes: EntityKey[]; topology: boolean }
  | { type: "resynced" }                          // a snapshot replaced the document
  | { type: "offline" };                          // the connection dropped: cancel gestures
```

```
      tools · gestures · history · ViewModel
                     │ read: visibleDoc      change: commit      react: notices
                     ▼
               OpenDocument  (one switch per function)
               ┌─────┴──────┐
        LocalDocument    SharedDocument
        accepted now     pending → accepted / rejected (server)
        saving: none | file
```

Tools and history react to notices whenever they arrive: `accepted` makes the history entry usable and resumes a paused wall chain (§5.5); `rejected` removes the entry and ends the chain; `remoteChange` and `resynced` cancel gestures and invalidate history (§5.7, §7.5); `offline` cancels gestures, including a paused chain, and leaves history to the snapshot that follows reconnection. A `LocalDocument` emits `accepted` within the same `update` and never emits the others, so the pending paths cost it nothing. It never rejects: `domain.execute` has already refused invalid commands, and nobody else writes to the document.

**Creating one** is the only branch on mode. The shell starts the editor with an unsaved `LocalDocument` (tests, §10 steps 3–5, the web app without a server), or, for a shared project, the first `snapshot` for the generation the editor is opening (`workspace.opening`) creates the `SharedDocument`; an `openFailed` for that generation ends the open with its message. A reply for any other project or generation is ignored. A local file's `opened` event comes with X1.

**Leaving an in-memory drawing.** In the initial build an in-memory drawing exists only in tests and in the web app without a server, which opens one drawing and has no project list. Nothing inside the app navigates away from it; closing the tab is the only way to lose it, and the shell's before-close warning (from `dirty`) covers that. When X1 adds a folder workspace next to in-memory drawings, leaving a dirty in-memory drawing for another drawing or the project list will first ask Cancel / Discard (§11).

**Saving a local file.** Two revisions are involved: `d.revision` is the document's current revision; `w.revision` is the revision held by the active write `w = writing`. Revisions restart for every opened document, so a write is identified by its **`writeId`**, never by its revision.

- Every commit, undo and redo increments `d.revision` and restarts the timer `autosave/<openId>` (1 s). `Cmd+S` saves at once. A `timerFired` whose ID does not match the current document's `openId` is ignored.
- **Start a save** when the timer fires or `Cmd+S` arrives, only if `writing` is null and `d.revision > savedRevision`: serialize the current document (§3.7), set `writing = { writeId: host.newId(), revision: d.revision }` and emit `saveSnapshot { projectId, writeId, content }`. At most one write runs at a time; a timer or `Cmd+S` during a write does nothing, because the completion rule catches up.
- **Complete a save** on `saveResult { writeId, ok }`:

  | Condition | Action |
  |-----------|--------|
  | no document open, or `writing?.writeId !== writeId` | a result for another document, an earlier write or a duplicate: ignore it |
  | `ok` and `d.revision === w.revision` | `writing = null`, `savedRevision = w.revision`, `failed = false` |
  | `ok` and `d.revision > w.revision` (edits made during the write) | `savedRevision = w.revision`, `failed = false`, then immediately start a save of `d.revision` |
  | not `ok` | `writing = null`, `failed = true`; no automatic retry: the next commit or `Cmd+S` retries, including edits made during the failed write |

  ```
  d.revision 4 ─► write "s1" starts (writing = s1 @ 4) ─► edit: d.revision 5
  saveResult{s1, ok}: matches → savedRevision = 4; 5 > 4 → write "s2" @ 5 now
  saveResult{s2, ok}: matches → savedRevision = 5, writing = null → "Saved"
  saveResult{s1, ok} again: writing is null → ignored
  file A's late result {a7, ok} while file B writes "b3" @ 4: a7 ≠ b3 → ignored
  ```

- **Switching documents.** Opening another drawing from a local file first finishes saving: if a write is active, wait for it; if the document is still dirty, start a save and wait for that. Open the next drawing only after success; on failure stay on the current drawing with "Save failed". Opening cancels `autosave/<openId>`. Switching away from a dirty in-memory drawing asks Cancel / Discard first (X1, above). Thus no save of a closed file document is left unreported; the `writeId` check is the backstop.
- **Status** is derived in this order: `writing` set → "Saving…"; `failed` → "Save failed"; `d.revision > savedRevision` → "Unsaved changes"; otherwise "Saved". `dirty` is `d.revision > savedRevision` for a file, and `d.revision > 0` in memory.
- Saving never blocks editing, never reverts an edit and never touches history. The ViewModel exposes `dirty` (unsaved work would be lost) so the web shell can warn before the tab closes.

**Undo in a local document** uses the same history code as a plain stack: entries are usable at commit, the value checks against `visibleDoc` always pass, and nothing invalidates them. Undo and redo commit the inverse or forward patch like any edit, so they also trigger autosave. A new edit clears redo; opening another drawing clears both stacks; history is never saved.

Both kinds are pure reducers with no network, timers or `await` inside, tested by transition tables, scenarios and random sequences (§9.1).

### 7.1 Server shape

The server's application core knows only projects, sequence numbers and generic changesets. It declares two ports; the composition root plugs in the adapters. Only shared documents use the server; local files never pass through it (§7.8).

```
          ws-server.ts (web): listProjects · createProject · deleteProject · openProject · submit · presence
                                                       │ WebSocket (§7.2)
                                                       ▼
                              ┌──────────────────── server ─────────────────────┐
                              │ src/app  (per-project queue, preconditions,     │
                              │           sequencing, broadcast)                │
                              │    │ ProjectRepository port   ChangesetValidator port
                              │    ▼                             ▼              │
                              │ json-file-repository      domain-validator      │
                              │  data/<id>.json            = validateDocument   │
                              │  (one file per project)      from @fm/domain    │
                              └─────────────────────────────────────────────────┘
```

```ts
// server/src/app/ports.ts
interface ChangesetValidator {
  validate(docAfter: StoredDocument): { ok: true } | { ok: false; violations: string[] };
}
interface ProjectRepository {
  list(): Promise<ProjectMeta[]>;
  create(name: string): Promise<ProjectMeta>;
  load(id: string): Promise<ProjectState>;
  save(id: string, state: ProjectState): Promise<void>;   // atomic; resolves after host persistence completion
  remove(id: string): Promise<void>;   // moves data/<id>.json into data/deleted/ (restorable by hand)
}
type ProjectState = {
  meta: ProjectMeta;
  seq: number;
  doc: StoredDocument;                  // entity values only
  versions: VersionMap;                 // includes deleted IDs
  receipts: Record<string, { seq: number; fingerprint: string }>;
};
```

`StoredDocument` is the generic entity-table shape from `@fm/protocol`; only the validator adapter knows it is a floor plan. There is **no change log**: the whole project state lives in one small JSON file.

### 7.2 Protocol

| Client → server | Server → client |
|-----------------|-----------------|
| `hello { clientId, name }` (first message) | `welcome { clientId, color }` |
| `listProjects` | `projects { items }` |
| `createProject { name }` | `projectCreated { meta }` |
| `deleteProject { requestId, projectId }` | `projects { items }` (the new list, to the sender); `projectDeleted { projectId, generation }` to every session that has the project open |
| `openProject { projectId, generation }` | `snapshot { meta, doc, versions, seq }` (always the full document); `openFailed { projectId, generation, message }` for an unknown project |
| `submit { changeset }` | `changes { seq, changeset, clientId }` (broadcast, including sender); `ack { changesetId, seq }` (sender) |
| | `rejected { changesetId, reason }` (sender only) |
| | `error { requestId, message }` for a list/create/delete request (`requestId`) or a malformed message that cannot be answered with `rejected` (`requestId: null`); it never ends an open |
| `presence { cursor, selection }` | `presence { clientId, name, color, cursor, selection }`; `presenceLeft { clientId }` |

**Delivery rules:**

- **Serialized per project**: the single Node process handles submits for a project strictly one at a time (a per-project promise queue). Checking preconditions, validating, assigning `seq` and saving never interleave.
- **Persistence before acknowledgement**: write the complete state to a temporary file, sync it, and atomically replace the project file. The repository defines successful completion for its host, including directory sync where supported. Publish the new in-memory state, broadcast and acknowledge only after completion. Avoid a universal power-loss guarantee across filesystems.
- **Crash on save errors**: any repository error, or any other unexpected error inside a queued project task, stops the server process; it neither acknowledges nor rejects. The dev script restarts it in a loop. On restart it reloads the project files, so the disk decides whether the changeset was saved. Clients reconnect, receive a snapshot and resend any outstanding changeset with the same ID: a receipt on disk returns its ack; otherwise it is processed normally. A persistent failure, such as a full disk, becomes a restart loop; that is acceptable for the demo.
- **Idempotency**: retain a receipt for every accepted ID, with its sequence and a fingerprint of the canonical submission payload (including expectations). Persist it atomically with document and versions. A matching retry receives only `ack` with the original sequence; it is never reapplied or rebroadcast. A reused ID with a different payload is `malformed`. Receipts survive restart and have no expiry or compaction in this demo. Rejected submissions are not retried by the client.
- **Ordering**: the server assigns consecutive `seq` numbers. A client expects `lastSeq + 1`; on a gap it re-opens the project and receives a full snapshot.
- **Atomicity**: accepted or rejected as a whole.
- **Validation**: messages are checked by hand-written validators in `@fm/protocol`. Unknown message types or tables → `malformed`; messages over 1 MB → `tooLarge`.
- **Rejection reasons**: `malformed | tooLarge | unknownProject | conflict | invalid { violations }`.


### 7.2.1 Project sessions

One connection has one active project. On connection the client sends its tab-scoped client ID and display name; the server assigns a colour. The web shell reads the display name from the `?name=` URL parameter (default "Guest"). Authentication remains out of scope. Project messages carry `projectId` and the recipient's client-generated session generation. Ignore events from an old connection or generation; the server likewise ignores a submit or presence carrying a stale generation, and rejects a submit for a project the session has not opened with `unknownProject`. List/create requests use request IDs. A failed open is answered with `openFailed` carrying the request's `projectId` and `generation`, never an uncorrelated `error`, so a late reply cannot cancel a newer open. The first message must be `hello`; anything else closes the connection. Presence bypasses the project queue and is not replayed to clients that join later.

Creating a project opens it, unless another project was opened or is opening by the time the server confirms the creation; then the new project is only added to the list. Switching waits for the outstanding submission to settle. It is disabled while disconnected with unresolved submissions. Opening a project runs in the per-project queue: capture and enqueue its snapshot, then subscribe before processing the next submission. This guarantees that later changes follow the snapshot on that connection. Leaving removes presence and the subscription.

**Deleting a project.** Each row of the project list has a Delete button. It asks in place: "Delete "Apartment"? Anyone who has it open is sent back to the project list." with Delete and Cancel. The editor sends `deleteProject` only from the project list (no drawing open, no open in progress). The server runs the delete in that project's queue, so it waits for a save in progress, and every later submit, open or presence for the project finds nothing: it moves the file (`repository.remove`), forgets the project in memory, sends `projectDeleted` to every subscriber with that subscriber's generation, then answers the sender with the new list. An unknown project gets `error { requestId, message: "Unknown project" }`. A project list read at the same time skips a file the delete has just moved. A failed move stops the server like a failed save (crash-only, §7.2).

```
Bob (project list)          server (Apartment's queue)                Alice (Apartment open, edit pending)
 Delete ─ deleteProject ─►  waits for the save in progress
                            move data/<id>.json → data/deleted/
                            projectDeleted ──────────────────────────► closes the drawing: drops the pending
 ◄──────── projects (new list)                                          edit, history, selection; shows the
                            Alice's queued submit → rejected             list and the toast "This project was
                              {unknownProject}, ignored (no drawing)     deleted"
```

The client treats its open project as gone when `projectDeleted` matches its project and generation, or when `openFailed` answers its own reopen (it was offline during the delete, §7.7). Either way it leaves the drawing as if the user had asked for the list, without waiting for the outstanding edit: it drops the edit, gestures, selection, presence and history, asks for the list and shows the toast "This project was deleted". Other clients' lists are not refreshed; opening a project that is gone shows "Unknown project" in the list. Not supported: deleting from inside a drawing, undoing a delete, restoring from the app (move the file back while the server is stopped).

Snapshots include the complete version map with tombstones. Opening, reconnecting or recovering a sequence gap cancels gestures and clears undo/redo history. Pending submissions remain until their outcome is resolved; their acceptance after a reconnect does not restore old history.

### 7.3 Server submit flow

```mermaid
sequenceDiagram
  participant A as Alice (editor)
  participant S as Server app (per-project queue)
  participant V as ChangesetValidator
  participant R as ProjectRepository
  participant B as Bob (editor)
  A->>S: submit {c1}
  alt receipt exists with different payload fingerprint
    S-->>A: rejected {c1.id, malformed}
  else matching receipt for c1.id
    S-->>A: ack {changesetId: c1.id, seq: original} (no reapply)
  else expectations fail (some lastCs differs)
    S-->>A: rejected {c1.id, conflict}
  else
    S->>S: tentative = applyPatch(doc, c1.patch)
    S->>V: validate(tentative)
    alt violations
      S-->>A: rejected {c1.id, invalid}
    else valid
      S->>R: save(seq 42, tentative, versions, receipts + c1)
      alt persistence completed
        S->>S: publish accepted state
        S-->>A: changes {seq 42, c1}
        S-->>B: changes {seq 42, c1}
        S-->>A: ack {changesetId: c1.id, seq: 42}
      else any repository error
        S->>S: exit process (no ack, no rejection)
        Note over A,B: restart reloads from disk; clients reconnect, get a snapshot and resend c1 with the same ID
      end
    end
  end
```

The **confirmed document is never invalid**: submits are serialized, and every accepted changeset passed its preconditions and `validateDocument` against the exact state it was applied to.

### 7.4 Shared document (client side)

A `SharedDocument` permits one outstanding edit, with no local edit queue. The server sequence is the confirmed document revision; optimistic display does not increment it.

```text
confirmed : doc + version map (including tombstones) + seq
inFlight  : Changeset | null
visible   = confirmed + inFlight's optimistic patch, only while its
            expectations hold and the result validates
```

An edit can start only when connected, initial synchronization is complete and `inFlight` is empty (this is `canCommit`, §7.0). A submission whose message would exceed `MAX_MESSAGE_BYTES` is refused locally with the same `rejected{tooLarge}` notice the server would send, so it is never resent in a reconnect loop. Capture expectations from confirmed versions. On a valid commit, set `inFlight`, show the optimistic result and submit immediately. Until its outcome settles, block new document-changing gestures, wall placements, property edits, deletion and undo/redo. Do not buffer input for later replay. Camera movement, selection and presence continue. Show "Waiting for server" and expose the edit-enabled state in the ViewModel.

Wall chains pause after each submitted segment. Acceptance resumes the chain by the resume rule in §5.5; rejection ends it. Cancelling the tool can end the chain but cannot cancel a submitted edit. This initial constraint deliberately exposes round-trip latency.

| Event | Action |
|-------|--------|
| valid local commit while ready | set `inFlight`; capture pending history; render optimistic result; emit submit |
| document-edit input while blocked | leave the document unchanged; do not queue the action |
| consecutive `changes` | apply to confirmed and advance seq; rebuild visible. An own change removes its optimistic overlay but remains tracked until ack. Remote changes invalidate history and gestures as specified elsewhere. |
| matching `ack` with seq ≤ confirmed.seq | clear `inFlight`; finalize eligible history; enable editing if connected and synchronized. Never apply values from ack. |
| matching `ack` ahead of confirmed.seq | ignore it; `changes` were missed, so request a snapshot unless one is already pending. The edit stays in flight; the same-ID resend after the snapshot gets the ack again from the server's receipt. Nothing about the early ack is stored. |
| matching `rejected` | clear `inFlight`; remove pending history and preview; end any paused wall chain; show reason; enable editing if connected and synchronized |
| duplicate changes / unrelated ack | ignore; never settle another submission |
| sequence gap | request snapshot; block editing until synchronized |
| disconnect | keep any outstanding submission unresolved; cancel active gestures; block document edits |
| snapshot | replace confirmed; cancel gestures and clear history. Resubmit any outstanding changeset with the same ID; if the snapshot already contains it, the server's receipt returns its ack without reapplying it. The resend guarantees the edit settles after a snapshot even when its original ack was lost. With no outstanding submission, enable editing once synchronization completes. |

If a remote change makes the optimistic patch invalid, omit it from visible but retain `inFlight` until the server resolves it. A snapshot may already contain the edit; the matching receipt acknowledgement settles it without applying it again. There is never a dependent second local edit to reconcile.

### 7.5 Undo in a shared document

This section applies to `SharedDocument`s. A `LocalDocument` runs the same history code as a plain stack (§7.0).

History is local to the open document and stores value patches, before/after values and semantic dependencies. It contains no permanently versioned inverse submissions. Entries become usable only after their ordinary edit is accepted.

1. Enable undo/redo only when connected, all local submissions have settled, and no history request is pending.
2. Undo checks that written entities match the entry's after-values, including absence; redo checks its before-values. If values differ or the entry has been invalidated, refuse the action with "Can't undo: the drawing changed remotely" (or the redo equivalent).
3. Build the inverse or forward patch with a fresh submission ID and expectations from the **current** confirmed version map for all writes and semantic dependencies. Validate the tentative document locally.
4. Submit as a history request. Keep the entry on its source stack until acceptance; block further document commits while the history request is pending. Presence and camera movement continue.
5. On acceptance, move the entry to the other stack only if no intervening remote change or snapshot invalidated it. On rejection, discard that entry and show the reason. The server's ordinary expectation checks protect against races after the local check.

Remote writes invalidate entries whose dependency sets overlap. A remote topology change invalidates all entries. Snapshots clear both stacks. Local undo and redo do not invalidate earlier local history: current versions are attached when the next action is requested. Thus `move c1 → move c2 → undo c2 → undo c1` works even though the first undo stamps fresh versions.

Any new ordinary local edit clears redo. A rejected ordinary edit removes its entry, and rejection releases the collaborative edit gate. Inverse dependencies include entities created by the original edit. A topology-changing undo is validated like every other patch and may be refused if the current drawing would become invalid. Partial undo and history preservation across reconnects are out of scope.

### 7.6 Presence

Cursor position, selection, name and colour, sent on pointer move; the WebSocket adapter throttles to 20 Hz (a transport concern). Never persisted.

### 7.7 Disconnect recovery; offline editing deferred

A disconnected `SharedDocument` allows viewing and camera movement, but no document commits. Retain at most one outstanding submission in memory. Reconnect with backoff, open the project, receive a snapshot, and resolve that submission through the same-ID retry and receipt acknowledgement (§7.4). Reconnect clears history.

Editing while disconnected (X3) is deferred beyond the initial collaboration model. It would require a separate decision to introduce a local queue and dependent-edit handling. Closing the tab loses local tracking of an unresolved submission; the server may already have accepted it, and reopening loads the server state.

### 7.8 Local-folder workspace (follow-up X1)

A workspace adapter over a local folder using the File System Access API (Chromium only): a workspace is a folder of drawings. It never talks to the server; every file opens as a `LocalDocument` with `saving: file` (§7.0).

| Workspace op / effect | Folder adapter |
|-----------------------|----------------|
| `listProjects` | `*.flatmate.json` files in the chosen folder |
| `createProject(name)` | new file `<name>.flatmate.json` holding an empty document, then open it |
| `openProject(id)` | read the file and emit `opened { kind: "local", content }`; the editor deserializes it (§3.7) and shows a readable error on failure |
| `saveSnapshot` | write the whole content with `createWritable()`, then emit `saveResult { writeId, ok }` |

Files contain only the versioned domain document (§3.7): no sequence numbers, version maps or receipts. The browser writes to a temporary file and replaces the original when the stream closes; nothing stronger is claimed. Presence does not exist in this mode. One tab per file is supported; with two, the last save wins.

### 7.9 Walkthrough: one ordinary command, end to end

A plain-language trace of §4, §5 and §7 together. **Example:** Alice drags joint `J1` from (0, 4) to (0, 3.5). `J1` is shared by walls `W1` and `W4`. Bob has the same project open. This is a `SharedDocument`; with a `LocalDocument`, everything after step c collapses into: apply the patch, `revision + 1`, history entry usable at once, autosave timer restarted (§7.0).

**On Alice's side, from input to changeset**

- **a. The shell turns DOM input into an event.** The browser fires `pointerup`; the web input adapter produces `{ type: "pointerUp", screen: {x: 412, y: 300}, mods, button: 0 }`. It sends screen coordinates only, because the editor owns the camera.
- **b. The editor converts to world coordinates and ends the gesture.** `update(state, event, host)` converts screen to world with the camera and applies snapping. The Select tool was in `moving{ baseDoc, … }`; during the drag each pointer move re-ran the command on `baseDoc` as a preview only. The release ends the gesture.
- **c. The domain executes the command** (a pure function call): `execute(visibleDoc, moveJoints [J1 → (0, 3.5)])`. The domain applies the move and runs `validateDocument`. If the result is invalid it returns `DomainError topology`: toast, nothing submitted, stop here. If it is valid it returns `{ doc, patch }` with `puts: [J1 at (0, 3.5)]`, `before: [J1 at (0, 4)]` and `dependencies: [J1, W1, W4]` (moved joints plus their incident walls, §4.1).
- **d. `commit` wraps the patch into a changeset.** `id = host.newId()` gives `c1`. `expect` takes the **visible** version of every written entity and dependency, e.g. `J1@c0, W1@c0, W4@c0`: "I built this on these versions" (§4.0). No submission is outstanding when this edit starts, so visible and confirmed versions agree.
- **e. The editor records a pending history entry.** `past.push(E1 { patch, before, after, dependencies, status: pending })`. It is not usable until the server accepts `c1`. A new ordinary edit also clears redo.
- **f. The `SharedDocument` updates the screen at once (optimistic).** Set `inFlight = c1`; rebuild `visible = confirmed ⊕ inFlight`. Alice sees the new position immediately. Further document edits are disabled and the status shows "Waiting for server".
- **g. It submits immediately.** Emit `submit { projectId, generation, changeset: c1 }`. There is no local queue and no second edit can build on `c1` before acceptance.
- **h. The shell sends it.** The effect runner hands it to `ws-server`, which sends `submit { projectId, generation, changeset: c1 }` over the WebSocket.

**On the server**

- **i. The per-project queue serializes it.** One submission at a time per project; checking, validating, sequencing and saving never interleave.
- **j. The message is structure-checked.** Shape, size (under 1 MB), known tables, unique expectations, an expectation for every put and delete. Failure → `rejected{malformed | tooLarge}`.
- **k. The receipt is checked (idempotency).** A receipt for `c1` with the same payload fingerprint → `ack{c1, originalSeq}` only: no reapply, no broadcast. A different payload under the same id → `malformed`. This makes a resend after reconnect harmless.
- **l. Expectations are checked (compare-and-set).** Every `lastCs` in `expect` must match the server's version map. If Bob changed `W1` a moment earlier, `W1@c0` fails → `rejected{conflict}`: first writer wins.
- **m. The server applies tentatively and validates.** `tentative = applyPatch(doc, c1.patch)`, then `ChangesetValidator.validate(tentative)` (the domain's `validateDocument` behind a port; the server app knows nothing about walls). Invalid, e.g. a wall now crosses one Bob just moved → `rejected{invalid, violations}`.
- **n. The server assigns `seq` and saves durably.** `seq = 43`; every written entity is stamped `lastCs = c1` (deletes leave tombstones); a receipt `{ seq: 43, fingerprint }` is added. The complete state is written to a tmp file, synced and renamed over `data/<id>.json`. Only after that completes is the new state published in memory.
- **o. The server broadcasts, then acknowledges.** `changes{ seq 43, c1, clientId: alice }` to everyone with the project open, Alice included; then `ack{ c1, 43 }` to Alice only.

**On Bob's side**

- **p. Bob applies the remote change.** His `SharedDocument` expects `lastSeq + 1` (a gap requests a snapshot). It applies values and versions to his `confirmed` and rebuilds `visible`, re-overlaying his own pending edit if its expectations still hold. If he is mid-gesture and the change overlaps his gesture's dependencies (or changed topology), the gesture is cancelled with "Drawing changed remotely"; otherwise it re-runs on the new document. His history entries whose dependencies overlap `J1` are invalidated. Zones and areas are re-derived: Bob sees the room shrink.

**Back on Alice's side: settlement**

- **q. Alice receives her own change.** `changes{43, c1}` has `id = inFlight.id`, so it is recognised as hers, not remote, and does not invalidate her history. It is applied to `confirmed` and `c1`'s optimistic overlay is removed (it is now real). Nothing moves on screen. The id is kept until the ack.
- **r. The ack settles it.** `ack{c1, 43}` with `seq ≤ confirmed.seq` → `inFlight = null` (values are never reapplied from an ack). `E1.status = usable` unless a snapshot or invalidation happened meanwhile. The status shows "Saved"; document editing and eligible undo actions become available again.

**If the server rejects instead (at j, l or m)**

- **s. The client handles the rejection.** `rejected{c1, reason}` → `inFlight = null`, E1 is removed from history, `visible` is rebuilt without `c1`, so the joint visibly snaps back. A toast explains why ("Bob changed this wall first", "Walls can't cross"). There are no dependent queued edits; document editing becomes available again.

```
a shell → b editor → c domain.execute → d changeset → e history (pending) → f optimistic render
      → g inFlight → h ws ─► i queue → j shape → k receipt → l expect → m validate → n seq + save
      → o broadcast + ack ─► p Bob applies / cancels / invalidates
                           ─► q Alice confirms → r ack: saved, undo enabled
                              (or s: rejected → snap back + toast)
```

---

## 8. Error handling

- **Domain**: `execute` returns `Result`; invalid commands are errors, never exceptions. The editor turns them into toasts ("Wall too short", "Walls can't cross").
- **Editor**: exhaustive `switch` with `assertNever` on every union (fail fast). No `as` casts in core packages.
- **Sync**: disconnect → `connection = "offline"`; the WebSocket adapter reconnects with backoff (1, 2, 4… max 30 s) and the editor reopens the project with a new generation when the connection returns. Document edits remain disabled while offline; X3 requires a future design extension (§7.7). Rejections (`conflict`, `invalid`) revert the change with a toast, as in §7.4.
- **Malformed submission**: an accepted operation ID reused with a different payload fingerprint is rejected as `malformed`; it is never reapplied.
- **Server persistence failure**: the server process exits and restarts (§7.2). Clients see a disconnect, keep their outstanding submission and editing blocked, reconnect with backoff, and resolve it through a snapshot and same-ID retry: the receipt acknowledges it if the write reached disk; otherwise it is processed again. A connection close is never a rejection.
- **Local save failure** (X1): status "Save failed"; edits and history are kept and editing continues; the next commit or `Cmd+S` retries. A save failure never reverts an edit.
- **Load**: `deserialize` validates shape and version and returns a readable error.

---

## 9. Testing strategy

| Layer | Kind | Examples |
|-------|------|----------|
| domain | unit | mitered corners; endpoint-on-wall T-junction split; interior crossing and collinear overlap rejected; valid destination-only move; rectangle and two-room divider faces; narrow room gives area unavailable; fixed-thickness clear area; wall resize keeps connections; label merge on divider deletion; each invariant I1–I8 detected, including malformed IDs and non-finite coordinates |
| domain | property-based (optional after the demo) | Patch/inverse round-trip and deterministic IDs; add broader generated geometry only when a concrete bug warrants it |
| editor | headless scenarios (fake shell) | Demo wall chain with pointer directions and typed lengths; empty Enter finishes; drag is one undo entry; rejected drag is zero entries plus toast; endpoint snap beats grid; midpoint snap gives the exact divider points; project list create/open through `ui` events; repeat key gesture scenarios with unsaved LocalDocument and delayed SharedDocument, including closing a paused and resumed chain on its first joint |
| editor | local document | In-memory commit and undo are immediate with no save effect. When X1 local files are added: autosave coalescing, stale save results, save failure/retry, navigation after save failure, and Cancel / Discard when leaving a dirty in-memory drawing |
| sync | two headless editors + in-memory server app with the real domain validator | same-entity concurrent moves → second rejected (`conflict`), both clients converge; different-entity moves → both accepted; crossing walls drawn concurrently → second rejected (`invalid`); second edit while a submission is outstanding is blocked without buffering; duplicate submit re-acked once; after a snapshot, the same-ID resend is acked from the receipt and clears `inFlight` without re-applying; seq gap triggers snapshot; undo racing a remote edit refused by the server; remote change cancels an affected drag but only refreshes an unaffected one; late joiner derives the same zones |
| server | integration | create/list/open; submits for one project are serialized; ack only after repository completion; a repository error exits the process without ack or rejection; restart reloads state and receipts (idempotency survives restart); interrupted write (tmp file left behind) ignored on load; malformed/tooLarge/unknown table rejections |
| web | Playwright smoke | draw a room and see the area tag; two contexts see each other's cursor |

Required acceptance scenarios:

- While one collaborative edit awaits acknowledgement, a second wall placement, drag, delete, property change or undo produces no commit and is not replayed later. Pan, zoom, selection and presence remain available. Acceptance resumes a paused wall chain by the §5.5 resume rule; rejection ends it. If Bob draws a wall across Alice's next path while her segment is pending, her chain ends with "Drawing changed remotely — wall chain ended" and her accepted wall stays; if Bob moves an unrelated wall into her path, the chain resumes with a red preview and a click there is refused. Disconnect keeps the gate closed until synchronization and outcome resolution finish.

- Two accepted moves of the same joint, two undos, two redos restore each intermediate state. Undo waits for ordinary pending edits, and stack transitions happen only after acknowledgement.
- A remote endpoint move invalidates an overlapping history entry even if a later remote move restores its original coordinates. An unrelated move preserves history. Remote topology changes and reconnect snapshots clear it.
- Bob moves the fixed endpoint while Alice submits a typed resize: Alice's dependency expectation rejects. A resize gesture also cancels when that endpoint changes remotely.
- A divider 0.30 m from a corner succeeds. A split producing a fragment below 0.01 m fails atomically with the short-fragment message.
- A straight split wall retains the same clear area. Unsupported face walks or insets show unavailable area without invalidating the drawing.
- Clicking an existing labelled room selects the zone and highlights its floor without creating another label; an unlabelled-room click creates and selects a zone. Properties rename the selected zone; Delete removes its label without changing walls. Selection tracks the label ID as geometry updates; boundary clicks and orphan handling follow §3.6. Deleting a divider between two labelled rooms combines names with ` / ` in label-ID order and retains one label. Cover one unlabelled room, existing slashes and an opened exterior. Undo restores separate labels and divider in one operation; a concurrent rename conflicts through label expectations.
- Delete, recreate, delete again: an expectation for the first deletion fails against the second tombstone. Only a never-used ID has a null version.
- A retry after more than 1,000 other accepted changes receives its original acknowledgement without a broadcast or reapplication. Different payload under the same ID is malformed.
- Snapshot includes a pending accepted edit: the same-ID resend is acknowledged from the receipt and settles it without reapplying it. A response from the previous project generation is ignored. Opening concurrently with submission delivers snapshot then consecutive changes.
- After a server crash during a save, the same-ID resend is acknowledged from the receipt if the write reached disk, and processed normally otherwise. Local-file save behavior is tested when X1 is implemented.
- Reordering entity-table insertion order does not change normalized IDs or patches for the same command. Equal-distance endpoint snap ties follow the specified ordering.

Tooling: pnpm workspaces, TypeScript strict, Vite, Vitest, Playwright, dependency-cruiser, ESLint (no type assertions or non-null assertions in core packages). Sync tests live in `packages/sync-tests`. Add fast-check if the optional generated-sequence tests are implemented.

### 9.1 Open documents: pure reducers, tested by tables

`SharedDocument` is the most error-prone logic in the project. It must handle every combination of the state it is in and the event that arrives:

```
state it's in                          event that arrives
─────────────                          ──────────────────
connected / syncing / offline     ×    local commit
inFlight: none / waiting               changes (mine / someone else's)
                                       ack (matching / unrelated / ahead)
                                       rejected
                                       snapshot
                                       seq gap
                                       disconnect / reconnect
```

That is dozens of combinations, and bugs hide in the rare ones (for example, "my ack arrives after a snapshot that already contains my edit"). Manual testing never reaches them.

**The naive approach** is a class that does its own I/O and uses `await`:

```ts
class SharedDocument {                                   // NOT the design
  async commit(patch: DomainPatch) {
    const cs = this.buildChangeset(patch);
    this.inFlight = cs;
    this.render();
    const result = await this.send(cs);                  // wait for the server's reply
    this.inFlight = null;
    if (result.ok) this.history.markUsable(cs.id);
    else this.revert(cs);
  }
  private onSocketClose() {
    setTimeout(() => this.reconnect(), this.backoff);    // real timer
  }
}
```

It reads well and works in a manual demo, but it has two problems:

1. **`await` hides what happens while waiting.** Other messages arrive and run their own handlers during the wait. When `commit` resumes, it assumes the world it left, and may revert an edit that a snapshot already contains or settle a submission twice. The interleaving is real but invisible in the code; it depends on the order the event loop happens to run things.

   ```
   commit c1 ──► await send(c1) ········· (waiting) ··········► resumes: "inFlight = null"
                       │                                    ▲
                       ├─ changes from Bob arrive (handler runs)
                       ├─ socket drops, reconnect, snapshot arrives (handler runs)
                       └─ the snapshot already contains c1 ...
   ```

2. **Real network and timers make tests slow and unreliable.** Testing needs a fake WebSocket or a real server, and a way to deliver the ack at exactly the wrong moment, which a real socket cannot force reliably. The 1 s autosave or the reconnect backoff means sleeping or patching the global clock. States live in private fields, so every test must replay the calls that reach them. At that cost relevant transition rows tend to be skipped.

**The design instead:** each document kind is a pure reducer with no network, timers or `await` inside:

```ts
reduce(state, event) → { state, effects, notices }
```

Every arrival is an explicit event, and nothing happens between two calls. Each interleaving is just a different order of events:

```
reduce(s,  commit c1)  → s1, effects [submit c1]
reduce(s1, changes)    → s2
reduce(s2, disconnect) → s3
reduce(s3, snapshot)   → s4
reduce(s4, ack c1)     → s5
```

Network and timers become effects out and events in, so the test controls time and message order completely:

| Real-world thing | Reducer emits | Test sends back |
|---|---|---|
| send to the server | `submit c1` | `ack c1` / `rejected c1`, in whatever order the test chooses |
| wait 1 s for autosave | `startTimer autosave/<openId> 1000` | `timerFired autosave/<openId>`, instantly |
| socket drops | — | `disconnect` |

**Three kinds of test**, all cheap because the reducer is pure:

1. **Table rows: one transition each.** Test builders construct the start state directly (it is plain data) and send one event. A failure points at one cell of the table; a missing row is easy to spot; each new bug becomes a row. Builders run `checkConsistent(state)` so tests cannot start from states the app could never reach.

   ```ts
   const start = shared({ connection: "connected", inFlight: c1, seq: 42 });
   const r = reduce(start, { type: "ack", changesetId: c1.id, seq: 42 });
   expect(r.state.inFlight).toBeNull();
   expect(r.notices).toEqual([{ type: "accepted", id: c1.id }]);
   ```

   | Start state | Event | Expected result |
   |---|---|---|
   | connected, inFlight c1 | `ack c1`, seq already applied | inFlight empty; notice `accepted c1`; can edit |
   | connected, inFlight c1 | `rejected c1` | inFlight empty; notice `rejected`; overlay removed |
   | syncing after reconnect, inFlight c1 | snapshot that includes c1 | resubmit c1 with the same ID; its receipt ack settles it; nothing reapplied |
   | connected, no inFlight | `ack c9` (unrelated) | nothing changes |
   | syncing | local commit | refused; nothing queued |

2. **Scenarios: sequences that matter as a story.** Fold a short list of events through the reducer and check the end state. The acceptance scenarios above are written this way.

   ```ts
   const end = [commit(c1), disconnect(), reconnect(), snapshot(includes c1), ack(c1)]
     .reduce((s, e) => reduce(s, e).state, initial);
   expect(end.inFlight).toBeNull();          // settled once, not applied twice
   ```

3. **Optional follow-up: random sequences (`fast-check`).** When transition rows and demo scenarios are stable, generate event sequences and check: visible equals confirmed when nothing is in flight; each submission settles at most once; values are never applied twice; no edit is accepted while `canCommit` is false. A failure shrinks to the shortest breaking sequence, which becomes a new scenario or table row.

`LocalDocument` gets a small initial table for in-memory commits. Add the save idle/writing/failed transitions, autosave timer, `Cmd+S`, save results and the discard confirmation with X1 local files.

---

## 10. Build order

Each step ends in something runnable. Steps 1–7 are the demo-critical tier. Stop there if time is tight. The task-level plan, with tests and review gates, is in `docs/plans/flatmate/`.

1. **Repo skeleton**: packages, tsconfigs (no DOM lib in cores), dependency-cruiser, Vitest.
2. **Domain geometry**: document, invariants, `addWall` normalisation, outlines, faces, clear areas, value patches. Tests first.
3. **Editor, headless**: `update`, ports, `OpenDocument` with an unsaved `LocalDocument`, Wall tool (exact transitions), Select tool with preview/commit, snapping, undo. Headless scenario tests; no storage adapter needed.
4. **Web shell with Canvas2D**: input adapter, effect runner, React panels from the ViewModel, command bar, snap glyphs. Runs on one unsaved local document, with no project list: drawing works in the browser without a server.
5. **Zones and helper dimensions**: `Z` tool, helper dimension editing.
6. **Server and shared documents**: protocol + validators, JSON repository, validator port, `ws-server` (workspace, submit, presence), project list screen and `?name=` identity, `SharedDocument`, presence, all-or-nothing shared undo; tool scenarios rerun against a delayed fake server.
7. **Demo polish**: colours and typography, demo project, README with the architecture diagram.
8. **First follow-ups, in parallel**: MCP server (Claude as a collaborator) and WebGL2 SDF renderer + live toggle.
9. **Further follow-ups**: take items from §11 in priority order, only when they make the demo stronger.

If time runs short, stop after any step from 7 onward: the demo is complete.

---

## 11. Follow-up TODOs (priority order)

These are outside the initial build. Add one only after the Canvas2D demo is stable and the added behavior can be demonstrated clearly.

1. **MCP server: Claude as a collaborator (M1).** A new shell, `packages/mcp`, speaks MCP over stdio and runs the headless editor against the collaboration server like a third window: tools to list, create and open projects, read the drawing (walls, joints, rooms with areas), and edit through domain commands (draw a room, add a wall or many walls, set a wall length, move a joint, label, rename, delete). Every edit goes through the editor's commit path, waits for the server's accept or reject, and returns the reason to Claude; presence shows a "Claude" cursor. Design and constraints in §12. Developed in parallel with item 2. Done (gate M1).
2. **WebGL2 SDF renderer and live Canvas2D toggle.** Developed in parallel with item 1: it visibly proves the renderer port while keeping text on Canvas2D. Design and trade-offs in §6.2. Done (gate S1).
3. **More CAD snaps.** Add perpendicular and angle steps with corresponding glyphs and tie rules (§5.8). Cheap and visible: snapping is editor-only and was the cleanest area of the build, and angle snaps remove the demo's hold-Shift workaround. Done (C1, 2026-09-30).
4. **Project delete.** A Delete button per project in the list, confirmed in place; the server moves the file to `DATA_DIR/deleted/` inside the project's queue and sends everyone who has it open back to the list with a toast. Design in §7.2.1 ("Deleting a project"); plan `docs/plans/flatmate-delete/`. Done (D1, 2026-10-01).
5. **Interior wall crossings.** Split every intersected wall and the new segment with deterministic IDs. Keep the initial T-junction rule until this is tested (§3.4). Riskier: geometry produced the most defects in the build, and crossings touch IDs, dependencies and label merges.
6. **Richer selection.** Add Shift multi-select, box select, then coalesced arrow-key nudge if the interaction is worth showing (§5.6).
7. **Complex zones and label merges.** Handle nested/bridge-connected rings and merges of three or more labels, with explicit area semantics and tests (§3.6).
8. **Loop mode.** Add `L` and empty-Enter closure only if it improves wall-drawing speed in the demo (§5.5).
9. **Local-folder workspace (X1).** Implement the existing local-file save contract and folder adapter, plus the Cancel / Discard confirmation for leaving a dirty in-memory drawing; keep unsaved in-memory drawings as the initial local mode (§7.0, §7.8).
10. **Standalone associative dimensions (X2).** Add dimension entities, anchors, commands, serialization and `DI` as one coherent later feature; the initial editable wall helper needs none of these (§3, §5).
11. **Offline editing (X3).** Design a queue/rebase policy before allowing edits without a server; the initial shared mode permits one outstanding edit (§7.7).

---

## 12. MCP server: Claude as a collaborator (follow-up M1)

Claude edits a drawing like a third browser window. A new shell, `packages/mcp` (`@fm/mcp`), speaks MCP over stdio and runs the headless editor (`initialState` + `update`, a Node `Host`) against the collaboration server as a normal client. Nothing on the server changes.

```
 Claude Code / Claude Desktop
        │  MCP: JSON-RPC over stdio
        ▼
 @fm/mcp ── tools ──► EditorSession ──update(state, event, host)──► @fm/editor ──► @fm/domain
                           │  effects: submit, presence, workspace
                           ▼
                      WebSocket (the editor's wire mapping) ──► server ──► Alice's and Bob's windows
```

### 12.1 One new editor event

The editor gains `{ type: "command"; command: Command }` (§5.2). It runs the same commit path as a tool's commit: blocked while an edit is outstanding, `execute`, commit, history, notices and toasts. No new write path is exported from the editor's index; `visibleDoc` joins its read-only queries so the shell can report the drawing it shows. The MCP shell never applies commands or builds changesets itself.

### 12.2 Tools

| Tool | Input | Does |
|------|-------|------|
| `list_projects` | — | goes to the project list and returns it; this closes the open drawing (the editor lists projects only from the list, §7.2.1) |
| `create_project` | name | creates and opens it |
| `open_project` | project id | opens it |
| `get_drawing` | — | the drawing summary (§12.4) |
| `draw_room` | x, y, width, height | a rectangle of four walls (`rectangleRoom`), see §12.5 |
| `add_wall` | a, b | `addWall` from a to b (T-junction rules of §3.4 apply) |
| `add_walls` | walls: 1–50 of `{a, b}` | several `addWall`s in one call, in order, for bigger layouts such as a maze; see §12.5 |
| `set_wall_length` | wall id, length | moves endpoint `b` along the wall, keeping `a`; walls at `b` follow (§3.4) |
| `move_joint` | joint id, to | `moveJoints` with one move |
| `label_room` | point, name | places a room label at the point |
| `rename_room` | label id, name | renames it |
| `delete` | ids | deletes walls, joints or labels (§3.4 rules); an id that is none of these is refused before anything is sent |

**Inputs are the trust boundary** (process lesson 29): each tool's schema is checked before its handler runs. Coordinates are finite and within ±10 000 m, sizes in (0, 1 000] m, IDs must pass the wire ID check, names are trimmed to 1–200 characters, `delete` takes 1–50 ids and `add_walls` 1–50 walls, unknown fields are dropped. The domain checks IDs and names again.

### 12.3 One edit, end to end

```
add_wall(a, b) ─► schema OK ─► dispatch { type: "command", command: addWall }
   ├─ refused locally (domain error, edit outstanding) ─► toast, no submit ─► reply: the toast text
   └─ submit effect, changeset c7 ─► server
        ├─ changes + ack c7 ─► no edit outstanding ─► reply: drawing summary
        ├─ rejected c7      ─► the editor's toast text ("Walls can't cross", …) ─► reply
        ├─ project deleted  ─► the editor is back on the list ─► reply: "This project was deleted" (§7.2.1)
        ├─ connection lost  ─► reply: dropped (the editor resends c7 with the same ID on reconnect, §7.7)
        └─ no answer in 10 s ─► reply: no answer (call get_drawing to check)
```

Every wait ends. Replies are matched by changeset ID and generation, like every other reply (§7.2.1). Failures come back as tool errors with the editor's own texts, so Claude sees the same reasons a person sees.

**Tool calls run one at a time.** Claude may call tools in parallel; the session runs them in arrival order, each against the settled drawing after the previous one's outcome. A tool call is one turn: `draw_room` and `add_walls` run their check and all their walls before the next call starts. Nothing is applied optimistically or replayed, so this is not the local edit queue §7.4 rules out.

### 12.4 Drawing summary

Compact JSON in metres (coordinates rounded to millimetres, areas to hundredths of m²): the project (id, name, save status), walls (id, joint ids, endpoints, length), joints (id, position), rooms (outline, clear floor area from `zones` or the reason it is unavailable, the labels inside) and labels that are in no room. `get_drawing` and every accepted edit return it.

### 12.5 Constraints

- **`draw_room` is four edits.** `rectangleRoom` returns four `addWall` commands and the event carries one, so the room is four changesets. The four commands are first run together with `execute` on the current drawing: if the rules refuse any, nothing is submitted. Another person's edit between them can still stop the room after one to three walls; the reply says so.
- **`add_walls` is one edit per wall**, like `draw_room`, for the same reason. All the walls are first run in order with `execute` on the current drawing: if the rules refuse any, nothing is submitted and the reply names that wall (its position in the list) and the reason. Another person's edit can still stop it part-way; the reply says how many walls were drawn. It exists so that a larger layout is one tool call instead of one model turn per wall (a 30-wall maze would otherwise take 30 turns).
- **`list_projects` closes the drawing** (§12.2).
- **No tool deletes a project.** If a person deletes the open project, the waiting edit (or the rest of `draw_room` or `add_walls`) ends with "This project was deleted"; the next edit gets "No project is open" (§7.2.1).
- **One project, one connection** per MCP server process. The server URL comes from `FM_SERVER_URL` (default `ws://localhost:8787`) and the client name from `FM_NAME` (default "Claude"). If the server is not running, `list_projects`, `create_project` and `open_project` wait up to 10 s for the connection, then reply that it is not connected; an edit on an open drawing gets the editor's offline text at once.
- **Presence:** after an accepted edit, the shell sends one pointer move through `update` at the edit's place (for `draw_room`, the room's centre; for `add_walls`, the middle of the last wall; `delete` moves none), so the windows show the "Claude" cursor there (§7.6). No new message.
- **stdout carries the protocol:** the shell logs only to stderr, and `pnpm mcp` runs pnpm with `--silent`.
- No claim is made about how Claude chooses to use the tools; tests cover the tools, not the model.
