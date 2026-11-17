# Refusals and warnings

An edit that breaks a rule is refused: nothing changes, and the app says why. A drawing that is valid can still carry standing warnings: a blocked use zone, a blocked door swing, a high deck side with no guard. This document covers how both are shown and worded, and error handling. How the domain refuses is in [domain.md](domain.md).

## Showing a refusal

A ghost or preview whose click would be refused draws red. A refusal is then said in two places: the toast at the bottom and a plate at the pointer.

**A refused drag** (`refusedOverlay` in `packages/editor/src/view/refused-overlay.ts`) puts a 4 px red disc at the cursor and draws the refused place: a piece's footprint or an opening's span in half-alpha red (`COLORS.invalidFill`, `#e5484d88`), a deck's, hole's or area's rectangle outlined red; the walls round dragged joints turn red in the walls layer. `blockedPrimitives` fills every piece of the layout in view that the edit would break in the same red, its symbol in red. A nudge draws this without the disc (`refusedPlaces`); a duplicate draws its ghost and the blocked pieces.

**The toast** (`showToast` and `refuse` in `packages/editor/src/toast.ts`) holds the whole text for 6 s (`TOAST_MS`). It is the one a screen reader announces (`role="status"`). It sits above the level strip, its offset following the strip's row count (`--fm-level-rows`). An edit that goes through ends an earlier refusal's toast.

**The plate** (`withPlate`, `liveReason` and `onRestTimer` in `packages/editor/src/plate.ts`) echoes the refusal by the pointer. `liveReason` is the one place that knows which gestures can be red: placing and duplicating pieces, dragging pieces, walls, joints, openings, decks and columns, a split tick inside an opening, drawing walls, decks, holes and named areas, placing openings and columns. Dimension, section and scale tools are never red there.

```
 move onto a red spot --> the piece turns red --> 150 ms at rest --> rest plate
                                                  (any move ends it)
 press or release refused --> sticky plate at once
                              (ends: 24 px away, next press, key, leaving the canvas, a ui event)
```

- The rest is 150 ms (`REST_MS`). The words are a thunk, worked out only when the plate appears: `reasonOf(doc, cmd)` runs the command the click would send, on the document it would run on.
- A rest's plate goes with any move, or as soon as nothing is red, a pan under a still pointer included. A pan's moves never start a rest.
- A refused press or release raises a sticky plate holding the toast's text. It has no timer and a rest never replaces it.
- A refusal raises a plate only from a pointer press or release, and a rest's plate comes with no toast. A refusal from a key, a typed value, Properties, a command or the server keeps to the toast. One exception: a typed distance that turns a walls drag red starts a rest, like a move.
- A stair being drawn from a deck's edge keeps its hint line and gets no plate ([stairs.md](stairs.md)).

**How it looks** (`platePrimitives` in `packages/editor/src/view/plate.ts`): a white box with a 1 px red border (`COLORS.invalid`), one line of 12 px text in `#b91c1c`, 22 px tall (16 px more with advice), centred on the pointer with its top 16 px below it, over the piece if need be, and kept 4 px inside the canvas. A text too long for the canvas is cut to end in "…"; the toast keeps it whole. It draws in the last layer, `presence`. Under WebGL, text beneath it shows through, as text draws above all geometry.

## The words of a refusal

A domain refusal carries `message`, which names rows by ID for Claude, and on some violations `plain`, the same refusal in plain words for people. `namedViolation` in `packages/domain/src/errors.ts` picks the violation a refusal is named after. Claude's tools keep `message` ([mcp.md](mcp.md)).

`refusalText(error, doc, cmd)` in `packages/editor/src/toast-text.ts` makes the words a person reads, from the violations and the command, never from the message's text. The first that answers wins:

| Step | Covers | Words |
|---|---|---|
| `splitText` | an `I12` from `addWall`, `connectJoint`, `splitWall`, `placeColumn`, `setColumn` | "A wall can't end inside a door", "A wall can't be split inside a window", "A column can't cover a door" |
| `openingText` | any other `I12` | the violation's `plain`, else a sentence built from the openings' kinds (below) |
| `plainText` (`column-toast.ts`) | an `I20` from `addWall` with two rows, or from `addOpening`; any other named violation with `plain` | "A wall can't touch a column", "Doors and windows can't go on a column", else `plain` |
| `finishText` | every command that carries a finish: `setFinish`, `labelZone`, `setDeckFinish`, `setWallFinish`, `setRoomWallFinishes`, `setOutsideFinish`, `setWallSide`, `setRoofCovering` | the field's name and rule: "Size must be 0.10–0.40"; a lower band's height: "Height must be 0.10–3.00" |
| fallback | everything else | `error.message` |

- `runCommand` in `packages/editor/src/commit.ts` passes the error through `inViewFirst`: when the edit breaks pieces in the layout in view, those violations go first, so the toast and a sticky plate name that layout. A rest's plate (`dragReason` during a drag) and a ghost's words (`reasonOf`) skip this, so for an edit breaking pieces in two layouts they can name another layout than the toast that follows.
- Fit and height refusals name the pieces with their ranges and the layout: "Bed (0.00–0.45) and Desk (0.00–0.75) overlap in Day", "Bed reaches 3.15 m in Layout; the ceiling is 3.05 m" (`collisionMessage`). Two pieces are named in the order of their names.
- At an upper level a piece with no deck under its centre reads "No floor at +2.15 here" (`noFloorAt`; see [levels.md](levels.md)).
- A server rejection toasts `rejectMessage` (`packages/editor/src/notices.ts`): a clash reads "Someone else changed this first" (`CLASH_TEXT`); an invalid change reads `invariantsMessage` of the invariant IDs, which carry no names ("Furniture would not fit", "Doors and windows must fit their wall"). The other reasons are in [collaboration.md](collaboration.md).

### Opening refusals

The rules are in [openings.md](openings.md). An opening the command adds or changes (`addOpening`, `moveOpening`, `setOpening`) reads "This …", any other "A …".

| Case | `message` (Claude) | Words for a person |
|---|---|---|
| Two overlap along the wall | "Door d1 overlaps window d0 on wall w3" | "This door would overlap a window on this wall" / "A door would overlap a window on its wall" |
| Off its wall | "Door d0 doesn't fit on wall w3" | "This door doesn't fit on its wall" |
| On a missing wall | "Door d0 is on a missing wall" | "This door is on a missing wall" / "A door is on a missing wall" |
| Stacked too close | "Window d1 and door d0 on wall w3 are 0.05 m apart in height; stacked openings keep 0.10 m of wall between them" | "Stacked openings keep 0.10 m of wall between them" (0.25 m over a shutter box) |
| A pocket meets another opening | "Window d1 overlaps pocket door d0's pocket on wall w3" | "A pocket door's pocket would overlap a window" |

A joint dropped so that a door leaves its own wall's reach reads as "doesn't fit", not as a split. A cut inside a pocket kind names its label: "A wall can't end inside a pocket door".

## Advice on a red ghost

The Object tool's red click ghost may add a second line to its rest's plate, in dark text (`ghostAdvice` in `packages/editor/src/tools/ghost-advice.ts`). It is worked out from the fit as data, never from the refusal's words:

- None where the ghost fits, has no floor, is a set's or a stair's at a caught edge, or is a drawn footprint, and none on a refused click's sticky plate.
- Otherwise `placementFit` is tried again at the ghost's place at the lowest height (`MIN_HEIGHT`), keeping the armed elevation. If that is still red, the plan is the reason: "Drag to draw it to size". If it fits, height is: "Type a lower height" for a kind that may be lowered (`lowerable`), no advice for any other.

A ghost lowered to fit shows a note plate (`notePlate`), with no rest and never red: the same box with a `#92400e` border and dark text, "H 1.80 m · default 2.00 · under Loft" ("typed" for a typed height, "under the ceiling" with no deck). A typed height that differs from the preset's shows as an 11 px "H 1.80 m" in `#92400e` beside the ghost, on a white backing with no border; a drawn footprint's own label carries it instead. A refusal's plate takes the note's place. The lowering rule is in [furniture.md](furniture.md).

## Standing warnings

Three things warn and never refuse: a blocked use zone ([furniture.md](furniture.md)), a blocked door swing ([openings.md](openings.md)) and a missing guard ([guards.md](guards.md)). The domain gives them as queries: `zoneBlocks(doc, layout)` in `packages/domain/src/queries/clearance.ts` groups `clearanceWarnings` by zone, with several walls kept as one "a wall"; `missingGuards(doc)` lists the guards.

**One owner.** `shownWarnings(doc, view)` and `shownGuards` in `packages/editor/src/view/warnings.ts` say what is shown in this layout at this level. The amber layer, the marks, the count and the list all read them, so they can't disagree. During a drag they read the preview's document, the one the scene draws.

**On the canvas.** `warningsLayer` (`view/objects-layer.ts`) fills each warned zone's ring in translucent amber (`#f59e0b55`) with a 2 px outline in `#92400e`. `warningMarks` adds a "!" mark for every warning, a missing guard included: a disc of 11 px radius in `#92400e`, one of 9.5 px in `#f59e0b` and a 13 px dark "!", fixed in pixels. A zone's mark sits at its ring's corner with the largest x + y, 14 px in toward the centre (or at the centre if closer). Marks draw first in `overlays`, so grips draw over them. A missing guard has a mark and no ring.

**The count and the list** (`WarningsPill` in `packages/web/src/panels/WarningsPill.tsx`). Beside the layout tabs, "1 warning" or "3 warnings", hidden at zero. It opens a list with one row per mark (`warningRows`):

- "Sofa's front is blocked by Coffee table", "Door's swing is blocked by Chair". A nameless piece reads "Object", a wall "a wall", a column "a column"; two blockers are joined by "and", three or more read "A, B and 1 more". Guard rows are in [guards.md](guards.md).
- A row selects the piece or the door, or for a guard the deck or the hole (`selectEntity`): it picks the Select tool and leaves the camera alone. It selects nothing where the viewed level can't select that piece.
- The list stays open after a row. Esc closes it, keeps the selection and gives the focus back to the count. A click elsewhere closes it.

**The blink.** The count blinks amber once for 600 ms when the viewer's own committed edit raises it (`raisesWarnings` in `commit.ts` bumps `warningBlink`), measured at the same layout and level. Never on undo or redo, someone else's edit, a change of layout or level, or a drag's preview, and only under `prefers-reduced-motion: no-preference`.

**Not shown.** Only the canvas scene builds the layer and the marks: PNG, SVG, the PDF sheets and `look` draw none. Stair checks stay in Properties, out of the count ([stairs.md](stairs.md)).

## Error handling

- **A file that isn't a project.** The server's `json-file-repository.ts` reads a file that is not JSON or not a project state as `NotAProject`. The project list skips it, logging `[fm-server] skipping <file>: …`, and opening it answers "Unknown project", shown on the list. Other disk errors stop the server ([collaboration.md](collaboration.md)).
- **A snapshot that won't parse.** The session asks `snapshotParses` (`fromStored`) first. A refused snapshot reads "This project can't be opened" (`CANT_OPEN` in `packages/editor/src/session.ts`): on the list while opening, or back to the list with a toast for the open drawing. Claude's tools return the same text.
- **The error boundary.** `ErrorBoundary` in `packages/web/src/panels/ErrorBoundary.tsx` wraps the app: a throw while rendering shows `FailurePage`, "Something went wrong" with the error's message and a Reload button. A `?server=` address that isn't `ws://` or `wss://` shows "Can't reach the server" with the reason and no Reload.

## Wording rules

- A domain refusal names no UI part. It is read by people and by Claude alike.
- IDs go only in `message`. A person's words name the kind and "this" or "a", built from violations and commands.
- A refusal from `I9` or `I23` (a row naming one that is gone, after a race), when no other invariant has words, reads "This edit needs something that was just removed". A refusal whose invariants have no words of their own reads "Invalid drawing" (`MESSAGES.invalid`), locally and from the server.

## Limits

- A list row can select nothing at a level that can't select its piece.
- A busy plan can stack marks and outlines; there is no switch to hide warnings.
- Claude sees no missing guard ([guards.md](guards.md)).
- One domain refusal names a UI part: clearing a custom wall side's finish reads "A custom side needs a finish; Reset returns it to its room's" ([finishes.md](finishes.md)).

## At levels

Which level shows a use-zone or swing warning, and which blockers it names, is in [levels.md](levels.md). A missing guard shows at the floor and at its deck's own level. The count and its blink are per layout and level; an edit that moves the view between the floor and a loft never blinks.
