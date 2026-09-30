# Architecture

[← index](INDEX.md)

```
shells (web, server, tests, cli) ──► @fm/editor ──► @fm/domain ──► @fm/protocol
server/app ─────────────────────────────────────────────────────► @fm/protocol
server/adapters/domain-validator ──► @fm/domain   (only server file allowed to)
```

## Decisions

| Decision | Why | Spec |
|----------|-----|------|
| Hexagonal, three rings: **domain** (what a plan is) / **editor** (how a human edits it, platform-neutral) / **shells** | Domain must be embeddable headless (server, scripts, AI agent) without UI state; UI logic must be reusable by any host | §2.2 |
| Domain = **plain pure synchronous functions** (commands + queries). No events/effects, no outbound ports; IDs passed in | Nothing in the domain lives in time or does I/O | §3.1 |
| Editor = Crux-style `update(state, event, host) → {state, effects}` | Portable, deterministic, replayable, tests assert on effects | §5.1 |
| Two port kinds in editor: **sync `Host`** (textMetrics, now, newId) injected; **async effects as data** with results returned as events | Keeps `update` synchronous (no promises), side effects assertable | §5.2 |
| Ports declared in `editor/src/ports/`; adapters in `web/src/adapters/`, `editor/test/fake-shell.ts` | One place to find contracts | §5.2 |
| Effects: `render`, `workspace`, `saveSnapshot` (local file), `submit` + `presence` (shared), timers; events: input, `ui`, `timerFired`, `workspaceEvent`, `saveResult`, `serverEvent` (2026-09-26; `ui` added 2026-09-27) | Each document kind emits only its own effects | §5.2 |
| Panels send `ui` events (create/open project, project list, pick tool, set field, undo/redo) and never change state themselves; the editor keeps the project list in `workspace` and exposes `projectList` in the ViewModel; the web shell takes the display name from `?name=` (2026-09-27) | Demo step 1 had no state or input path; panel logic stays testable headless | §5.2, §5.3, §5.9, §7.2.1 |
| `OpenDocument` module in `editor/src/document/` is pure core logic for both kinds; platform differences stay in adapters (`ws-server`, `folder-workspace`) (2026-09-26) | Acceptance rules are behaviour, not I/O | §5.2, §7.0 |
| Editor outputs **Scene** (what to draw) + **ViewModel** (what panels show) | UI logic once; only the look re-created per host | §5.9 |
| Opaque handles for platform objects (images etc.), never pixels in core | Portability | §5.2 |
| Server app is generic (projects, seq, changesets); floor-plan validity via **`ChangesetValidator` port** wired in `main.ts` | User wanted a thin store-like server; invariants still need a single guard | §7.1 |
| Boundaries enforced by dependency-cruiser + per-package tsconfig `lib` (`ES2022` only for cores) | tsc alone doesn't enforce layering | §2.4 |
| The editor's public values are only what shells call: `update`, `initialState`, `buildViewModel`, `buildScene`, the two camera conversions, colours, fonts and `NO_MODS` (later phases append read-only queries and wire mappers); document, history and camera helpers stay internal, and the index uses named exports only (2026-09-29, phase 3 wave 8 code review) | The index also exported `commit`, `onEvent`, `zoomAt`, `panBy`…: a shell could commit into the state it holds, skipping `execute`, history and notices, or move the camera the editor owns | §2.4, §5.1 |
| A package uses another only through its entry point (`src/index.ts`, plus `@fm/editor/testing`); dependency-cruiser rule `only-through-package-index` (2026-09-28) | The `exports` map blocks `@fm/domain/src/x`, but a relative path such as `../../domain/src/geometry` skipped it and passed tsc, lint and the ring rules | §2.4 |
| `Result`, `assertNever`, `deepEqual` and `Point` live in `@fm/protocol` (innermost), so `server/src/app` can use them without importing the domain; `Result` is plain data and scripts use `unwrap(execute(…))` (2026-09-27) | One shared definition; no class instances in the core | §2.4, §3.1 |
| The WebSocket adapter only translates messages (`projects`/`projectCreated`/`error` → `workspaceEvent`, the rest → `serverEvent`) and owns reconnect backoff; the editor decides what to do on `connection open` (list, or reopen with a new generation) (2026-09-27) | Keeps behaviour in the testable core and the adapter dumb | §5.2, §7.0, §8 |
| `presence` effects carry `projectId` and `generation` (2026-09-27) | The adapter needs no memory of which project is open | §5.2 |
| The web effect runner hands `workspace`/`submit`/`presence` effects to a sink function (null in local mode); phase 7 builds the sink from the WebSocket adapter (2026-09-27) | Phase 4 cannot type the WebSocket client before the protocol messages exist | plan README `@fm/web` |
| The web app runs in server mode when a server URL is known: `?server=` wins over `VITE_SERVER_URL`, `?server=off` forces local mode (2026-09-27) | Playwright and the demo can pick a server per window without rebuilding | plan phase 7 |
| Two-client sync tests live in `packages/sync-tests` (2026-09-27) | Editor tests may not import the server | §2.4, §9 |
| Borrowed desktop-editor patterns: Host port, preview/commit ops, snapping policies + chooser, display list, min-version serialization + JSON-visitor migrations, assertNever fail-fast; nudge coalescing deferred (2026-09-27) | Reuse useful patterns without importing features outside the demo | throughout |
| The protocol ↔ port translation (server message → editor event, effect → client message) lives once in `@fm/editor/src/ports/wire.ts`; the WebSocket adapter and the sync-test harness both use it (2026-09-29) | Two shells must not drift; the mapping is pure | §5.2, §7.2 |
| `@fm/mcp` is an outer shell: it imports protocol, domain and editor through their entries, tests reach the server only through `@fm/server`'s entry, and nothing imports it (dependency-cruiser rules `mcp-imports-cores-only`, `mcp-tests-use-server-entry-only`, `nothing-imports-mcp`) (2026-09-29) | Same ring rules as the web shell | §2.4, §12 |

## Don't

- Don't export write paths (document commits, history, camera moves) or `export *` from the editor's index: shells change state only through `update` (2026-09-29).

- Don't put editor/UI state (tool, selection, camera, undo) in the domain. (Early design mistake, corrected.)
- Don't make the domain message-driven; events/effects are the editor's protocol only.
- Don't put async work in `Host`; don't put sync queries in effects.
- Don't import `@fm/domain` from `server/src/app`.
- Don't reach into another package's files by relative path; import its public entry point (2026-09-28).
- Don't let shells precompute world coordinates (see [editor-interaction.md](editor-interaction.md)).
