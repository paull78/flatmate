# MCP server (Claude as a collaborator)

[← index](INDEX.md)

Follow-up M1, designed in spec §12; plan in `docs/plans/flatmate-mcp/`; code in `packages/mcp` (twelve tools).

```
Claude ──MCP stdio──► @fm/mcp: tools → EditorSession ──update──► @fm/editor ──ws──► server ──► browsers
```

## Decisions

| Decision | Why | Spec |
|----------|-----|------|
| `packages/mcp` is a shell: the headless editor (`initialState` + `update`, a Node `Host`) connected to the server as a normal client over `ws`, with the editor's wire mapping (2026-09-29, user) | Claude's edits get the one-outstanding-edit rule, server validation and live broadcast for free; the server does not change | §2.3, §12 |
| The editor's one extra event, `{ type: "command"; command }`, runs the tool commit path (`runCommand`); `visibleDoc` becomes an exported read-only query (2026-09-29) | One commit path for tools, tests and the MCP shell; no new write path in the index | §5.2, §12.1 |
| An edit's outcome is read from the editor: submitted changeset ID → settled when no edit is outstanding; `rejected` for that ID → the editor's toast text; a toast from the dispatch itself → local refusal; waits end on disconnect or after 10 s (2026-09-29) | Reuses the editor's texts; correlated by ID and generation (lesson 26); the editor's same-ID resend still settles a dropped edit | §7.4, §7.7, §12.3 |
| Tool calls run one at a time, each on the settled drawing (2026-09-29) | Claude may call tools in parallel; nothing is optimistic or replayed, so it is not a local edit queue | §7.4, §12.3 |
| `draw_room` = four `addWall` changesets, first run together with `execute`, all in **one serial turn** of the session (`editAll`) (2026-09-29; the turn fixed in Review B) | The event carries one command; a domain refusal never leaves a partial room; a concurrent edit by another person can still stop it part-way (accepted) | §12.3, §12.5 |
| `add_walls(walls: 1–50 {a, b})`: `editAll` over one `addWall` per wall, pre-checked in order, one serial turn; a refusal names the wall's position; the cursor goes to the last wall's middle (2026-09-29, user: "generate a sort of maze as a demo") | One model turn per wall made a maze slow; reuses `draw_room`'s path, so no new session logic | §12.2, §12.5 |
| `list_projects` goes to the project list, closing the drawing (2026-09-29) | The editor lists projects only from the project list | §12.2 |
| Tool inputs bounded by schemas before a handler runs: coordinates ±10 000 m, sizes (0, 1 000] m, wire ID check, names 1–200 characters, 1–50 ids, unknown fields dropped (2026-09-29) | Lesson 29: bound the shape, not only the type | §12.2 |
| Presence: after an accepted edit, one pointer move through `update` at the edit's place: the room's centre for `draw_room`, the last wall's middle for `add_walls`, none for `delete` (2026-09-29) | The browsers already draw remote cursors; no new message | §7.6, §12.5 |

| `list_projects`, `create_project` and `open_project` first wait up to the 10 s timeout for the connection, then reply "not connected"; an edit on an open drawing gets the editor's offline toast at once (2026-09-29, M1.5; spec §12.5 aligned in M1.10) | At startup the socket may still be opening; an edit needs no wait because the editor already refuses it offline | §12.5 |
| `delete` looks each id up in the drawing to build the command's entity refs; an id that is no wall, joint or label is refused before anything is sent (2026-09-29, M1.6; spec §12.2 aligned in M1.10) | `deleteEntities` takes `{ table, id }` refs; Claude has only ids | §12.2 |
| Rehearsal step 10a is a maze drawn with `add_walls` at exact coordinates, right of the apartment (x 9–13 m), ending with a question; the bathroom prompt is its fallback (2026-09-29, user) | The user wants the demo to show Claude generating a maze; exact coordinates keep the step predictable; the geometry was checked through the tools against the step-5 apartment | §1.4 step 10 |
| No tool deletes a project. If a person deletes the open project, a waiting edit ends with the editor's toast "This project was deleted" (the session checks for a closed drawing before treating "not pending" as success) (2026-10-01) | Without that check, an edit dropped by the delete would read as accepted | §12.3, §12.5 |

## Don't

- Don't apply domain commands or build changesets in the MCP shell: it would skip blocking, history and the notices (2026-09-29).
- Don't write to stdout in `packages/mcp/src`: it carries JSON-RPC; `pnpm` needs `--silent` for the same reason (2026-09-29).
- Don't serialise a multi-step tool per step: each `edit` took its own turn, so a parallel call slipped between `draw_room`'s walls and left three stray walls (Review B, 2026-09-29). One tool call = one turn.
- Don't ask Claude to label an open maze: with an entrance and an exit it is no closed room, and `label_room` replies "Click inside a room" (checked 2026-09-29, M1.10).
- Don't claim how Claude will use the tools; tests cover the tools, not the model's choices (2026-09-29).
