# Architecture

```
┌───────────────────────── shells (platform-specific) ──────────────────────────┐
│  web: React · Canvas2D · WebGL2 · WebGPU · WebSocket    server: Node · JSON   │
│  mcp: Claude's tools     tests: fake shell              scripts: CLI          │
│                                                                               │
│   ┌──────────────── @fm/editor (no DOM, no network) ─────────────────────┐    │
│   │  tools · snapping · camera · undo · document · views · 3D            │    │
│   │  update(state, event, host) → { state, effects }                     │    │
│   │                                                                      │    │
│   │     ┌──────────── @fm/domain (pure functions) ───────────────┐       │    │
│   │     │  the drawing's tables · commands · invariants          │       │    │
│   │     │  patches · outlines · zones, areas and heights         │       │    │
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
| `@fm/render` | the plan's and the 3D view's GPU records, read by the web shell's WebGL and WebGPU renderers |
| `@fm/export` | the PDF and SVG writers, which only shells import |
| `@fm/web` | the browser shell: React panels, Canvas2D, WebGL2 and WebGPU renderers, input and WebSocket adapters |
| `@fm/server` | project storage and collaboration; floor-plan validity comes in through a validator port, so `server/src/app` never imports the domain |
| `@fm/mcp` | the MCP shell: Claude's tools over stdio, driving the headless editor as a normal client of the server |
| `@fm/sync-tests` | two headless editors against the real server app (in-memory storage, real domain validator) |
| `@fm/scripts` | command-line scripts that use the domain and the protocol directly |

The editor never touches the DOM or the network. It receives events (`pointerDown`, `key`, `serverEvent`, …) and returns effects (`render`, `submit`, `startTimer`, …) as plain data, and the shell performs them. Questions it needs answered inside `update` (text width, the time, new IDs) go through a small injected `Host`.

## How collaboration works

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
- On a storage error the server exits, and the dev script restarts it after a second. Clients reconnect, reload the project and resend their pending edit. A file that isn't a project is skipped and logged, since a restart would read the same bytes.
- Undo is local to each user and all-or-nothing. When someone else changes what an entry touched, pressing undo says so and drops that entry, and the next press reaches the older one.

## Borrowed ideas

- [Crux](https://github.com/redbadger/crux) (Red Badger): a portable core with thin platform shells, talking in events and effects.
- Common desktop-editor patterns:
  - the injected `Host` port for synchronous queries;
  - preview-then-commit gestures (one change per drag);
  - snapping as independent policies plus a chooser;
  - a display list the renderer draws;
  - minimum-version serialization with JSON migrations;
  - fail-fast exhaustive switches.

## Testing

`pnpm check` runs the types, the lint and dependency rules, including a ratchet on import cycles, and every package's unit and integration tests, over 9,000 of them. Domain rules are tested directly, gestures through a headless fake shell, and collaboration by headless editors against the real server app. `pnpm e2e` runs Playwright in Chromium on both renderers, with pixel probes and real PDFs.

## Renderer and server notes

The WebGL2 renderer draws segments, arcs and discs with signed-distance antialiasing and polygons with MSAA when the browser provides it; wall edges are antialiased by 1 px edge segments. Text stays on a Canvas2D overlay, so under WebGL all text sits above all geometry. It is compared with Canvas2D by eye and by a few pixel probes, not pixel for pixel, and its speed has not been measured. Receipts and deleted-entity versions are never compacted. Cursors are not replayed to someone who joins later. `draw_room` and `add_walls` send one edit per wall: they check all their walls first, so a list the rules refuse draws nothing, but another person's edit in between can stop them part-way.
