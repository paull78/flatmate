# Domain

The domain package (`@fm/domain`, `packages/domain/src`) holds the drawing and its rules. This document covers the document's tables, the invariants every drawing keeps, how commands run and refuse, the list of command types, and how a drawing is saved and loaded. The rules of each feature are in that feature's document.

## Plain functions

The domain is a library of pure, synchronous functions, with no ports, I/O or state. The editor, the server's validator, Claude's tools, scripts and tests call it; it calls nothing.

```
  editor            --+
  server validator  --+-->  [ domain: commands + queries ]  -->  nothing
  MCP tools         --+
  scripts, tests    --+
```

The entries are `execute` (Commands), `validateDocument` (Invariants), `fromStored` and `upgradeStored` (Saving), and two patch functions in `patch.ts`: `applyPatch(doc, patch)` applies puts and deletes, shape-checks each put row and does not validate the result; `invertPatch(patch)` gives the patch that undoes a `DomainPatch`.

`Result` is plain data, `{ ok: true, value } | { ok: false, error }`, from `packages/protocol/src/util.ts`. `unwrap` throws on an error and is for scripts and tests only.

A document is an immutable value. A command returns a new one and never changes its input. Queries are pure functions of the document; some cache their result by document identity through `memo` in `memo.ts`, so callers treat results as read-only.

## Tables

`Document` in `model.ts` is seventeen tables, each a plain object from a row's ID to the row. `TABLE_NAMES` in `packages/protocol/src/patch.ts` lists them in the order below; the wire, the stores and the patches loop over that list. Only stored data is in a row. Everything that can be derived is derived by a query.

| Table | Row type | Holds | Rules in |
|---|---|---|---|
| `joints` | `Joint` | a point in metres where walls end | [walls-rooms.md](walls-rooms.md) |
| `walls` | `Wall` | a wall or a column between two joints: thickness, top, base, the `column` flag, its sides' finishes | [walls-rooms.md](walls-rooms.md) |
| `zoneLabels` | `ZoneLabel` | a room's label: a point, a name, the floor finish, the room's default wall finish | [walls-rooms.md](walls-rooms.md), [finishes.md](finishes.md) |
| `decks` | `Deck` | a raised rectangle: centre, size, rotation, top, solid or hollow, finish, a guard per side | [heights-decks.md](heights-decks.md), [guards.md](guards.md) |
| `deckHoles` | `DeckHole` | a rectangular hole through a deck, with its guard | [heights-decks.md](heights-decks.md) |
| `states` | `LayoutState` | a layout state: name and order | [layouts.md](layouts.md) |
| `objects` | `LayoutObject` | a piece: kind, name, sizes per configuration, options, a stair's links and rails | [furniture.md](furniture.md), [stairs.md](stairs.md) |
| `placements` | `Placement` | a piece's place in one layout state: point, rotation, configuration, use zones, the deck it stands on | [layouts.md](layouts.md) |
| `openings` | `Opening` | a door, window, passage or curtain on a wall | [openings.md](openings.md) |
| `dimensions` | `Dimension` | a placed dimension: two ends and an offset | [tools.md](tools.md) |
| `projectFields` | `ProjectField` | one filled title block field; the ID is the field's key | [export.md](export.md) |
| `underlays` | `Underlay` | the plan picture under the drawing; at most one row, ID `underlay` | [underlay.md](underlay.md) |
| `logos` | `Logo` | the studio's logo for the sheets; at most one row, ID `logo` | [export.md](export.md) |
| `ceilings` | `Ceiling` | the ceiling and roof, the roof covering and the outside walls' default finish; at most one row, ID `ceiling` | [roofs.md](roofs.md), [heights-decks.md](heights-decks.md) |
| `sheets` | `Sheet` | one page of the PDF set, or a report's flow of pages | [export.md](export.md) |
| `sections` | `Section` | a section cut; the ID is its letter | [sections.md](sections.md) |
| `areas` | `Area` | a named rectangle inside a room | [walls-rooms.md](walls-rooms.md) |

Rules that hold for every table:

- Lengths and coordinates are metres, y points up. Rotations are whole degrees, counter-clockwise.
- An ID is 1 to 128 characters from `A-Z a-z 0-9 _ . : / -` and never the name of an `Object.prototype` member such as `constructor` or `__proto__`, because tables are plain objects keyed by ID (`isWireId` in `packages/protocol/src/messages.ts`, `isValidId` in `shape.ts`). A row's `id` equals its key.
- A row's fields are primitives or flat objects of primitives, such as a point. The wire carries nothing deeper, so a list or a nested record is stored as flat fields (a sheet's drawings are `l0`, `d0` to `l3`, `d3`).
- A row parser (`parseWall`, `parsePlacement` and the others in `shape.ts`, `shape-objects.ts`, `shape-sheets.ts`, `shape-sections.ts`, `shape-areas.ts`) accepts exactly the fields of its type. A row with an unknown field is refused.
- A name is plain text of at most `MAX_NAME_CHARS` (200) UTF-16 units.
- A missing optional row has a default read through a query: no `ceilings` row reads as a flat ceiling at `DEFAULT_CEILING` (2.50 m), no `sheets` rows as the automatic sheet list.
- `emptyDocument()` has one row: the layout state `FIRST_STATE`, ID `s0`, name "Layout".

The tolerance of the geometry checks is `EPS`, 0.001 m, in `model.ts`. The sizes and ranges of walls, columns and rooms are in [walls-rooms.md](walls-rooms.md).

## Invariants

A document is valid when `validateDocument` finds no violation. A `Violation` (`errors.ts`) is `{ invariant, message, entities, plain? }`: the invariant's ID, a text that may name rows by ID, the rows involved, and for some a second text in plain words for a person. One line per invariant; the full rule is in the owner's document, listed under the table.

| ID | Rule | Checked in |
|---|---|---|
| I1 | Every wall names two existing, distinct joints. | `validate.ts` |
| I2 | Every wall is at least `MIN_EDGE` long. | `validate.ts` |
| I3 | Every joint is used by a wall. | `validate.ts` |
| I4 | No two joints are closer than `EPS`. | `wall-pairs.ts` |
| I5 | Two walls cross only at a joint they share. | `wall-pairs.ts` |
| I6 | No joint lies within `EPS` of a wall it does not belong to. | `wall-pairs.ts` |
| I7 | No two walls overlap along their length or join the same two joints. | `wall-pairs.ts` |
| I8 | Every row of every table is well-formed: valid IDs, finite numbers, the fields of its type, valid finishes, a corner piece's arms within its sizes. | `validate.ts` (`shapeViolations`) |
| I9 | There is at least one layout state; every placement names an existing object, state and deck (or the floor) and a configuration of its object's kind; an object has at most one placement per state and at least one in all. | `validate.ts` (`layoutViolations`) |
| I10 | Every piece lies inside one room, or on its deck, and collides with no wall, column or deck in plan and height. | `queries/fit.ts` |
| I11 | No two pieces of one layout state collide. | `queries/fit.ts` |
| I12 | Every opening is on an existing wall, lies within its length and height, and keeps clear of the other openings on it. | `validate-openings.ts` |
| I13 | Every wall's thickness is within the wall range. A column's depth is I20's. | `validate.ts`, `errors.ts` (`thicknessViolation`) |
| I14 | Every project field row is a known field with a non-empty value that fits it. | `validate.ts`, `project-fields.ts` |
| I15 | Every placed dimension's anchored end names an existing joint, its numbers are finite, and its offset is within `MAX_DIMENSION_OFFSET` (1000 m). | `validate.ts` |
| I16 | The one underlay row has the ID `underlay`, is a JPEG within the size caps, and covers a finite, non-empty rectangle. | `underlay.ts` |
| I17 | The one ceiling row has the ID `ceiling`, a height of 1 to 10 m and a roof within its limits; every wall and column is at least 0.10 m tall and no fixed top passes the ceiling; no piece's top passes the ceiling over it. | `ceiling.ts`, `queries/fit.ts` |
| I18 | Every deck is within its size and top limits, lies over the building, clears every wall in height, overlaps no other deck and stays under the ceiling. | `decks.ts` |
| I19 | A stair's `reaches` and `startsAt` name existing decks its height matches the deck it reaches and its top is above the deck it starts at; a winder is deeper than wide; a linked piece, and a kind that stands in every layout such as a stair, stands once in every layout state at the same place. | `stair-links.ts` |
| I20 | Every column is within the column size range, stands free or in a wall's line, is at least as deep as that wall and touches no other wall. | `column-checks.ts` |
| I21 | A wall or column stands on the floor or on a deck that is a level, inside it; only a free column on the floor reaches up to a deck; the rows at one joint share one base. | `wall-ranges.ts` |
| I22 | Every deck hole names an existing deck, is at least the deck minimum a side, lies in its deck's rectangle and overlaps no other hole of it. | `deck-holes.ts` |
| I23 | Every sheet holds the number of drawings its kind allows, a listed scale or none, text within `MAX_SHEET_TEXT`, drawings in order with no gaps, and existing layouts and decks; a section sheet, and only one, names an existing section and draws no level. | `validate-sheets.ts` |
| I24 | The one logo row has the ID `logo` and is a JPEG within the size caps. | `logo.ts` |
| I25 | A section's ID is one capital letter, its line is at least `MIN_SECTION_LENGTH` (0.50 m) and its depth is not negative. | `validate-sections.ts` |
| I26 | A named area is at least `MIN_AREA_SIZE` (0.30 m) a side and overlaps no other area. | `validate-areas.ts` |

Owners: I1 to I7, I13, I20 and I26 [walls-rooms.md](walls-rooms.md); I8 this document; I9 [layouts.md](layouts.md); I10 and I11 [furniture.md](furniture.md), [seating.md](seating.md) and [heights-decks.md](heights-decks.md); I12 [openings.md](openings.md); I14, I23 and I24 [export.md](export.md); I15 [tools.md](tools.md); I16 [underlay.md](underlay.md); I17 [heights-decks.md](heights-decks.md) and [roofs.md](roofs.md); I18 and I22 [heights-decks.md](heights-decks.md); I19 [stairs.md](stairs.md) and [layouts.md](layouts.md); I21 [levels.md](levels.md); I25 [sections.md](sections.md).

How the check runs:

- I8 runs first. If any row is malformed, `validateDocument` returns only the I8 violations.
- The pair checks I4 to I7 apply only to pairs whose height ranges overlap, so a wall on a loft may cross over a floor wall that stops under the loft. They test only pairs whose bounding boxes come close, found by a sweep over x.
- I20, I21 and I18 are skipped while I1 fails. The fit checks (I10, I11 and the pieces' part of I17) are skipped while I1 or I9 fails. A broken reference is then reported once. I12 and I22 run all the same.
- The violations come in a fixed order, which decides the message a refusal shows: per wall I13 and I1 to I3, then I4 to I7, I9, I20, I21, I18, I22, fit, I12, I15, I14, I16, I24, the rows' I17, I19, I23, I25, I26.
- I25 and I26 read their own table alone, so an edit elsewhere cannot break them. I23 checks each sheet alone, against the layouts, decks and sections it names.

The same `validateDocument` runs inside commands, in the editor's shared document, which shows a pending edit only while the result validates (`computeVisible` in `packages/editor/src/document/shared-document.ts`), and in the server's validator (`packages/server/src/adapters/domain-validator.ts`).

## Commands

A command is a plain object with a `type`, of the union `Command` in `commands/types.ts`. `execute` is the only entry:

```ts
execute(doc: Document, cmd: Command): Result<{ doc: Document; patch: DomainPatch }, DomainError>
```

```
  cmd --> ID check --> command function --> validateDocument(next) --> diffPatch(doc, next)
             |                |                      |
             v                v                      v
         refusal          refusal                refusal        (the input document is untouched)
```

- For a valid document and a command of the `Command` type, the result is a valid document or a refusal. A command is all or nothing.
- `execute` first checks the entity IDs listed by `commandIds` in `execute.ts` with `isValidId` and refuses with "Invalid ID". The command function checks the rest with its own message: every `opId`, `addDeckHole`'s and `setStairReaches`'s deck, the states and decks of `placePieces`' pieces, `setProjectField`'s key. `execute` does not check the shape of a command built from untyped JSON; callers that take outside input parse it first.
- Each command function builds the next document, runs the checks that give a precise message, and validates the whole result with `validateDocument` where its change can break an invariant.
- A command that changes nothing returns the input document itself and an empty patch.

What a command returns: the new document and a `DomainPatch` (`patch.ts`).

| Field | Holds |
|---|---|
| `puts` | every created or changed row, whole, as `{ table, entity }` |
| `deletes` | every removed row, as `{ table, id }` |
| `before` | the previous value of every written row, `null` for a created one; `invertPatch` reads it |
| `dependencies` | the rows the command relied on, given by the command, sorted and unique |

Entries are ordered by table in `TABLE_NAMES` order, then by ID. How a patch becomes a changeset, and what dependencies do on the server, is in [collaboration.md](collaboration.md).

New IDs come from the caller. A command that creates rows takes an `opId` and names them `<opId>/<letter><n>`: `j` joint, `w` wall or column, `k` deck, `h` hole, `o` object, `p` placement, `s` layout state, `d` opening, `m` dimension, `t` sheet, `a` area. An `opId` is a valid ID of at most `MAX_OP_ID_LENGTH` (120) characters, else "Invalid operation ID"; it is refused with "Operation ID already used" when any row in any table has an ID starting with `<opId>/` (`commands/op-ids.ts`). `placeStair` places flight `i` under the `opId` `<opId>/s<i>` and an L's landing as the deck `<opId>/k0`, so its own `opId` is at most 117 characters. A section takes no `opId`: its ID is the first free letter. A project field's ID is its key.

### Refusals

A refusal is the error branch: a `DomainError` from `errors.ts`, `{ kind, message, violations }`. Nothing changes. A result carries no warnings; standing warnings are queries, and how a refusal is shown is in [warnings.md](warnings.md).

| `kind` | Means |
|---|---|
| `notFound` | the command names a row that does not exist |
| `invalidInput` | a value is malformed or out of its range, or an ID or `opId` is invalid or taken |
| `tooShort`, `overlap`, `crossing` | a wall would be shorter than `MIN_EDGE`, or a new wall overlaps or crosses another; found by the command's own check |
| `notInRoom` | a label, an area or a column is in no room, or a column on a deck is off it |
| `topology` | `moveJoints`, `moveWalls` or `setWallThickness` gives a result that breaks an invariant, or a cut or a column would land on an opening |
| `invalid` | any other command's result breaks an invariant |
| `format` | a file or a patch row could not be read |

- `message` is one sentence for the person or for Claude. The texts shared by several callers are in `MESSAGES` in `errors.ts`.
- `topologyMessage` picks the message for a set of violations. The first violation of a named invariant (I10, I11, I12, I14, I17, I18, I19, I20, I21, I22, I25, I26, in `namedViolation`) gives its own text, which names the piece, the layout or the ranges. Otherwise `invariantsMessage` maps the invariant IDs to a fixed text, such as "Walls can't cross" for I5, I6 and I7, or "Invalid drawing" when no ID has one.
- The server reports a rejected changeset's violations as strings `"I5: ..."`. The editor reads the IDs back and uses `invariantsMessage`, so a server rejection has the fixed text without names.

### Command types

Seventy types. The fields and rules of each are in the linked document.

| Topic | Types | Rules in |
|---|---|---|
| Walls and joints | `addWall`, `moveJoints`, `moveWalls`, `splitWall`, `straightenWalls`, `connectJoint`, `setWallLength`, `setWallThickness`, `setWallTop` | [walls-rooms.md](walls-rooms.md), [wall-editing.md](wall-editing.md), [heights-decks.md](heights-decks.md) |
| Columns | `placeColumn`, `setColumn` | [walls-rooms.md](walls-rooms.md) |
| Rooms and named areas | `labelZone`, `renameZone`, `addArea`, `setArea` | [walls-rooms.md](walls-rooms.md) |
| Ceiling and roof | `setCeiling`, `setRoofCovering` | [heights-decks.md](heights-decks.md), [roofs.md](roofs.md) |
| Decks and holes | `addDeck`, `setDeck`, `addDeckHole`, `setDeckHole` | [heights-decks.md](heights-decks.md), [guards.md](guards.md) |
| Finishes | `setFinish`, `setDeckFinish`, `setWallFinish`, `setRoomWallFinishes`, `setWallSide`, `resetWallSide`, `setOutsideFinish` | [finishes.md](finishes.md) |
| Pieces | `placeObject`, `placePieces`, `movePlacement`, `movePlacements`, `duplicatePlacements`, `removePlacement`, `resizePlacement`, `setConfiguration`, `setObjectSize`, `setObjectKind`, `setOption`, `renameObject`, `setZoneSides`, `setZoneExtent`, `setLinked` | [furniture.md](furniture.md), [seating.md](seating.md), [layouts.md](layouts.md) |
| Stairs | `placeStair`, `setStair`, `setStairReaches` | [stairs.md](stairs.md) |
| Layout states | `addState`, `copyState`, `renameState`, `deleteState` | [layouts.md](layouts.md) |
| Openings | `addOpening`, `moveOpening`, `setOpening`, `removeOpening` | [openings.md](openings.md) |
| Placed dimensions | `addDimension`, `setDimensionOffset` | [tools.md](tools.md) |
| Project fields and logo | `setProjectField`, `setLogo`, `removeLogo` | [export.md](export.md) |
| Underlay | `placeUnderlay`, `scaleUnderlay`, `removeUnderlay` | [underlay.md](underlay.md) |
| Sheets | `addSheet`, `setSheet`, `deleteSheet`, `moveSheet`, `setSheetsInPdf` | [export.md](export.md) |
| Sections | `addSection`, `setSection` | [sections.md](sections.md) |
| Any table | `deleteEntities` | each row's own document |

Deletes:

- `deleteEntities` takes a list of `{ table, id }`, refused when empty. It deletes from eleven tables and refuses a row of `states`, `projectFields`, `underlays`, `logos`, `ceilings` or `sheets` with `invalidInput`: those go with `deleteState`, `setProjectField` with an empty value, `removeUnderlay`, `removeLogo` and `deleteSheet`, and the ceiling is never deleted. It cascades: a joint takes its walls, a wall its openings, and the joints left unused go with the dimensions anchored to them ([walls-rooms.md](walls-rooms.md)).
- `removePlacement` also removes an object left with no placement, and removes a linked piece or a stair from every layout.
- `deleteState` removes the state's placements, the objects left unplaced and the state from its sheets' drawings. The last state stays.
- `deleteSheet` keeps the last sheet.

## Saving

The app stores a project in one place: the server, as one JSON file per project. The file holds the whole project state, and its `doc` is the stored tables: `StoredDocument` in `packages/protocol/src/patch.ts`, the seventeen tables with no `format` and no `version` field. The wire's snapshots hold the same shape. The file is written whole when the project is created and after every accepted changeset. The rest of the server's side is in [collaboration.md](collaboration.md).

```
  file --> parseStoredDocument(doc, "empty") --> upgradeStored --> in memory --> snapshot to the editor
                                                 (no validateDocument)
  changeset --> apply --> fromStored --> validateDocument --> accepted: file written whole
```

### Loading

1. `parseStoredDocument(doc, "empty")` in `packages/protocol/src/messages.ts` reads the tables. A missing table reads as empty. Every row must be a flat object whose `id` is valid and equals its key; a file that fails is skipped and its project reads as unknown.
2. `upgradeStored` in `serialize.ts`, called through the server's validator port (`upgrade`), runs every migration and then every fill step, whatever the document's age. Each only fills in what is missing, so running them twice changes nothing. It returns its input when the result does not parse as stored tables.
3. The upgraded document stays in memory and reaches the file with the next accepted changeset.

Nothing validates on load. The first `fromStored` and `validateDocument` run on the first submitted changeset, over the whole result. So a stored drawing that is invalid opens, and then every changeset that leaves it invalid is rejected. The editor refuses a snapshot whose rows fail `fromStored`.

A new project's file is written from `emptyStored()`, with no layout state. The upgrade in memory gives it `s0` "Layout", and the file has it after the first accepted changeset.

On the wire every one of the seventeen tables must be present (`parseStoredDocument` with its default), and a snapshot that lacks one is refused. `fromStored` (`parseTables` in `shape-tables.ts`) shape-checks every row, does not validate, and reads `dimensions`, `underlays`, `logos`, `ceilings`, `decks`, `deckHoles`, `sheets`, `sections` and `areas` as empty when absent; the other eight must be present.

### Migrations and fill steps

| Migration (`MIGRATIONS`) | Change |
|---|---|
| 1 to 2 | every wall without `thickness` gets 0.20 |
| 2 to 3 | the tables `states`, `objects`, `placements` and `openings` when missing, and the state `s0` "Layout" when there is no state |
| 3 to 4 | the table `projectFields` when missing |

A change to the stored shape takes no new version number while the versions are 0.x: the table may be missing, or a fill step fills the field. `fillOnLoad` runs the steps in this order:

1. `fillZoneSides`: a placement's `sides` from its kind's default, and all-null `zones`.
2. `fillHeights`: an object's height and elevation per configuration from its kind; a wall's `top` "ceiling", `base` "floor", `column` false.
3. `fillDecks`: a placement's `deck`, null.
4. `fillStairStarts`: a stair's `startsAt`, null.
5. `fillDeckGuards`: a deck's four side guards from its one `guard` or from its top; a hole's guard from its deck.
6. `fillStairHandrails`: a flight saved with one `handrail` gets it on both sides. A stair saved with no rails gets Railing as a placeholder, because the parser refuses a stair without rails; after parsing, `withLoadRails` (`packages/domain/src/load-rails.ts`) replaces it with what a new stair gets (see [guards.md](guards.md)). Both load paths, `deserialize` and `upgradeStored`, run it.
7. `fillSheetSections`: a sheet's `section` null and `marks` true.
8. `fillOpeningHeights`: an opening's `sill` and `head` from its kind and its wall's height.

A fill step never replaces a value of the current shape and never throws; `fillDeckGuards` and a flight's `fillStairHandrails` drop the older single field they read.

### The versioned file format

`serialize(doc)` returns `{ "format": "flatmate", "version": 4, ...tables }` with rows sorted by ID, and `deserialize(json)` reads it: it refuses another format, a version above `CURRENT_VERSION` (4) or one with no migration, runs the migrations from the file's version, then `fillOnLoad`, `parseTables` and `validateDocument`. No app code calls them: tests and one script do. The app has no open or save of a drawing file.

## Limits

- No drawing file to open or save, and no version stored with a project.
- A row with an unknown field is refused, not kept.
- `applyPatch` and `fromStored` check shape and do not validate; their callers do.
- At most 26 sections, one per letter.
- The domain has no undo and no history. Undo is built from `invertPatch` outside it ([collaboration.md](collaboration.md)).
