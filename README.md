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

The toolbar's renderer button switches between Canvas2D (the default) and a WebGL2 renderer live; `?renderer=webgl` starts with WebGL. If WebGL2 is missing or its context is lost, the app falls back to Canvas2D and says so.

| Command | What it does |
|---------|--------------|
| `pnpm demo:seed` | adds a "Sample apartment" project (the room after demo step 4); run it before starting the server |
| `pnpm demo:headless` | replays demo steps 2–6 in the headless editor, one narrated test per step |
| `pnpm demo:script` | builds a 4 × 5 m room with a divider through the domain API only and prints its two areas |
| `pnpm check` | typecheck, lint, dependency rules and all Vitest unit/integration tests |
| `pnpm e2e` | Playwright tests in Chromium (install the browser once with `pnpm --filter @fm/web exec playwright install chromium`) |
| `pnpm screenshots` | while `pnpm demo` runs: five demo screenshots into `docs/reports/screenshots/canvas2d/` (`FM_RENDERER=webgl` for `webgl/`) |
| `pnpm dev:server` | the server alone on `ws://localhost:8787`, in its restart loop; project files go to `packages/server/data/` (`PORT`, `DATA_DIR` override) |
| `pnpm dev` | the web app alone; without a server URL it runs one unsaved in-memory drawing with no project list |

## The five-minute demo

1. As Alice, create a project called "Apartment".
2. Press `W`. Click the origin. Holding `Shift`, move right, type `6` and `Enter`. Do the same with `4` up and `6` left, then click the first joint to close the room.
3. Still holding `Shift`, draw a divider between the midpoints of the bottom and top walls. The midpoint snap makes both ends exact, and the walls split at T-junctions.
4. Press `Z` and click inside each room: each shows 10.64 m² (walls are 0.20 m thick).
5. Press `V`, select the right wall, click its length, type `3.5` and `Enter`: the top-right corner moves down and the areas update.
6. Drag that corner across the divider: the preview turns red and snaps back on release.
7. Open "Apartment" as Bob: each window shows the other person's cursor once they move the mouse, and Bob's changes show up for Alice.
8. Alice moves a joint twice and undoes both. After Bob edits that joint, Alice's redo is unavailable, with an explanation that the drawing changed remotely.
9. `pnpm demo:headless` and `pnpm demo:script` show the same core without a browser.

## Use with Claude

`packages/mcp` is an MCP server: Claude edits the drawing as a third collaborator, through the same editor core and the same server rules as the browser windows. Start the demo first (`pnpm demo`); the MCP server connects to `ws://localhost:8787` as "Claude".

Claude Code, from the repository root:

```bash
claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp
```

Claude Desktop (`claude_desktop_config.json`; use the absolute path of `pnpm` from `which pnpm` if Claude Desktop does not find it):

```json
{
  "mcpServers": {
    "flatmate": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/absolute/path/to/flatmate", "mcp"]
    }
  }
}
```

Tools: `list_projects`, `create_project`, `open_project`, `get_drawing`, `draw_room`, `add_wall`, `add_walls` (up to 50 walls in one call, e.g. a maze), `set_wall_length`, `move_joint`, `label_room`, `rename_room`, `delete`. Coordinates are metres with y up. Each edit waits for the server and returns the updated drawing, or the reason it was refused ("Walls can't cross", "Someone else changed this first"); Claude's cursor shows where it last edited. `FM_SERVER_URL` and `FM_NAME` override the server and the display name.

## Architecture

```
┌───────────────────────── shells (platform-specific) ──────────────────────────┐
│  web: React panels · Canvas2D · DOM input · WebSocket   server: Node · JSON   │
│  tests: fake shell                                      scripts: CLI          │
│                                                                               │
│   ┌──────────────── @fm/editor (no DOM, no network) ─────────────────────┐    │
│   │  tools (Select, Wall, Zone) · snapping · camera · undo · document    │    │
│   │  update(state, event, host) → { state, effects }                     │    │
│   │                                                                      │    │
│   │     ┌──────────── @fm/domain (pure functions) ───────────────┐       │    │
│   │     │  joints, walls, zone labels · commands · invariants    │       │    │
│   │     │  patches · wall outlines · zones and areas             │       │    │
│   │     └────────────────────────────────────────────────────────┘       │    │
│   └──────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────┘
      dependencies point inward only; checked by dependency-cruiser in `pnpm check`
```

| Package | Role |
|---------|------|
| `@fm/protocol` | wire messages and their validators, patch and changeset types, small shared helpers |
| `@fm/domain` | the document kernel: what a valid floor plan is and how commands change it |
| `@fm/editor` | how a person edits it: events in, effects out (render, submit, timers) |
| `@fm/web` | the browser shell: React panels, Canvas2D and WebGL2 renderers, input and WebSocket adapters |
| `@fm/server` | project storage and collaboration; floor-plan validity comes in through a validator port, so `server/src/app` never imports the domain |
| `@fm/mcp` | the MCP shell: Claude's tools over stdio, driving the headless editor as a normal client of the server |
| `@fm/sync-tests` | two headless editors against the real server app (in-memory storage, real domain validator) |
| `@fm/scripts` | command-line scripts that use the domain directly |

The editor never touches the DOM or the network. It receives events (`pointerDown`, `key`, `serverEvent`, …) and returns effects (`render`, `submit`, `startTimer`, …) as plain data, and the shell performs them. Questions it needs answered inside `update` (text width, the time, new IDs) go through a small injected `Host`.

### How collaboration works

```
Alice's editor             server, one project at a time             Bob's editor
     │  submit(changeset) ───►│ versions still as expected?
     │                        │ drawing still valid?
     │                        │ save the project file
     │◄── ack ────────────────┤── changes ─────────────────────────────►│
```

- The server is the source of truth. Each edit is a changeset: a value patch plus the versions of the entities it was built on.
- The server handles one changeset at a time per project. It accepts one only if those versions are unchanged and the resulting drawing is valid. The first writer wins; the second is rejected and its preview reverts. Nothing is merged.
- Each client keeps one edit in flight, with no local queue. The screen updates at once; new edits wait for the server's answer.
- A change is saved before it is acknowledged: the server writes the project's JSON file to a temporary file, syncs it and renames it into place. This is not a power-loss guarantee.
- The server keeps a receipt for every accepted changeset ID, so a resend after a reconnect gets the original acknowledgement instead of being applied twice.
- On a storage error the server exits, and the dev script restarts it after a second. Clients reconnect, reload the project and resend their pending edit.
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
| Editor | reducer tables for local and shared documents; headless scenarios that drive the fake shell with pointer and key events, including the narrated demo | `packages/editor/test` |
| Sync | two headless editors against the server app: conflicts, invalid concurrent walls, undo races, demo steps 7 and 8, blocking while an edit is outstanding, a lost ack settled by a same-ID resend | `packages/sync-tests/test` |
| Server | submit decisions, per-project queue, JSON repository, receipts, crash-only restart, WebSocket transport, the demo seed | `packages/server/test` |
| Web | Vitest for the adapters, panels, renderer switch and the WebGL instance builder; Playwright in Chromium: draw the demo room with typed lengths, two windows editing one project, and pixel probes of both renderers (toggle mid-drawing, fallback on missing WebGL2 or a lost context) | `packages/web/test`, `packages/web/e2e` |
| MCP | tool input bounds, the drawing summary, the session and every tool against the real server app (refusals, rejections, drops, parallel calls), the MCP surface over an in-memory transport, and one stdio end-to-end test against a spawned server | `packages/mcp/test` |
| Scripts | the domain-only room script | `scripts/test` |

Room areas are checked headless (domain, editor and the narrated demo), not in the browser.

## Limits

This is a demo, not a production CAD editor. Out of scope:

- openings, arc walls, editable wall thickness (fixed at 0.20 m), layers and styles;
- walls that cross another wall in its interior (T-junctions only);
- rooms nested inside rooms; complex rooms may show "Area unavailable";
- multi-selection;
- offline editing, and more than one edit in flight per client;
- authentication;
- Safari (only Chromium is tested).

The WebGL2 renderer draws segments, arcs and discs with signed-distance antialiasing and polygons with MSAA when the browser provides it; wall edges are antialiased by 1 px edge segments. Text stays on a Canvas2D overlay, so under WebGL all text sits above all geometry. It is compared with Canvas2D by eye and by a few pixel probes, not pixel for pixel, and its speed has not been measured. Receipts and deleted-entity versions are never compacted. Cursors are not replayed to someone who joins later. Of the spec's follow-up list (§11), the MCP server (item 1, above) and the WebGL2 renderer (item 2) are implemented; the others are not. `draw_room` and `add_walls` send one edit per wall: they check all their walls first, so a list the rules refuse draws nothing, but another person's edit in between can stop them part-way.

## Design documents

- Spec: [`docs/specs/flatmate-design.md`](docs/specs/flatmate-design.md)
- Design memory (decisions, reasons, mistakes not to repeat): [`docs/design-memory/INDEX.md`](docs/design-memory/INDEX.md)
- Implementation plan and gate reports: [`docs/plans/flatmate/`](docs/plans/flatmate/README.md), [`docs/reports/`](docs/reports/)
