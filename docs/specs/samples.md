# Samples

The sample houses a new person sees in the project list, how they are seeded into a data folder, how a recorded build is compared with its seed, and the Studio, a test fixture that is not a sample.

## The sample houses

`SAMPLES` in `packages/server/scripts/samples/index.ts` lists five houses, each a seed script in that folder with a plan diagram in its header. Each entry has a `name`, a changeset `prefix` and its `steps`. The list shows them in its own order (by name, or Recent: see [cards.md](cards.md)).

| Name | Prefix | Kind | Outside | Shows |
|---|---|---|---|---|
| 20 ft studio | `studio20` | tiny house on wheels | 6.10 × 2.55 m | shed roof 2.90 to 3.30; a sleeping loft at 2.15 over the bathroom with a 0.40 m railing and a rung ladder; a sliding barn door between two bookcases; a sofa under a two-leaf window; the loft's window stacked over the bathroom's; two layouts, Day and Night |
| 28 ft two lofts | `lofts28` | tiny house on wheels | 8.53 × 2.55 m | gable roof 2.80 to 3.35; a main loft reached by a ship's ladder and a guest loft by a rung ladder behind a 0.40 m railing; a bathtub; a pocket door; sofa, TV unit, rug; a Kitchen area with a bar table and stools under the guest loft; wood floors |
| 30 ft gooseneck | `goose30` | gooseneck, Interior surroundings | 9.14 × 2.55 m | low shed roof 3.20 to 3.45; a Bedroom on a solid deck 1.00 m high with a storage stair; a sofa on the floor against the deck's face, facing a free-standing TV unit; a bar table with stools; an open passage to the bathroom |
| Notched cottage | `cottage` | one-storey house, outside ground | 6.0 × 5.6 m, an L | 0.25 m outside walls with a 1.5 × 1.5 m notch; a double door from the notch; an open passage to a hall; a pocket door to the shower room; three named areas in one room; collar ties under a gable 2.40 to 3.60; a sliding glass garden door with a window over it; a wood stove; a through-wall AC |
| Tokyo loft | `tokyo` | a long narrow flat | 11.4 × 4.0 m | 0.20 m concrete shell, flat 5.2 m ceiling; a double-height living room behind sliding glass; an open stair to a loft at 2.45 over x 4.6 to 11.2, with a glass guard 1.10 high; a closet wall standing on the loft; a sliding WC door, a pocket laundry door, a folding bath door; Kitchen and Genkan areas; a kitchen island with stools |

The 20 ft studio's Day and Night share one arrangement. They differ in the Murphy bed (down at Night), the folding table (open by Day, folded at Night) and two chairs, which are Day's only (`linked: false`). The other houses have one layout. Each house has one section line through its most telling part, set by an `addSection` step. A house on wheels sets the `surroundings` project field to `wheels`; the 20 ft studio also sets `trailerHitch` to `low` and `tongueBox` to `on` (trailer rules: [surroundings.md](surroundings.md)). The samples' finishes come from one palette, `SAMPLE_FINISHES`, and `WOOD_OUTSIDE` lists the wood claddings for a house standing outside (finish rules: [finishes.md](finishes.md)).

## Seeding an empty data folder

`packages/server/scripts/seed-samples.ts`:

- `seedSamplesIfEmpty(repository)` seeds every sample into a repository with no project, and nothing into one with any project. A deleted sample stays deleted while any other project exists; a folder emptied of every project gets all five again. No state is stored.
- `seedSamples(repository)` seeds each sample whose name no project has, and leaves a project with that name untouched. A renamed sample frees its name, so the next run seeds it again.

`scripts/start.sh` runs `pnpm --silent seed:samples --if-empty` before it starts the server and the web app. `pnpm seed:samples` runs `packages/server/scripts/run-seed-samples.ts`, which uses `DATA_DIR` or `./data` (the server's rule) and prints one line naming the samples it seeded, or saying it seeded none. With `--if-empty` it calls `seedSamplesIfEmpty`, otherwise `seedSamples`. The root `package.json` has `seed:samples` and no script for the Studio.

## The seed kit

Every seed, the samples and the Studio, runs on `packages/server/scripts/seed-kit.ts`. A seed is a list of `Step`s, each a function from the document so far to one domain `Command` (wall ids change when a later wall splits one).

`seedProject(repository, name, steps, prefix)`:

1. Returns the existing project if one has that name.
2. Creates the project and upgrades its template with `domainValidator.upgrade`, as the server does on load.
3. Runs each step through the domain's `execute`, then submits its patch as its own changeset `<prefix>-<i>` through the server's `decideSubmit` with `domainValidator`. A seeded project's seq, versions and receipts look like a drawn project's, and a seed cannot store a drawing the server would refuse.
4. On a refused or rejected step it throws with the step's number, command type and `opId`, and removes the project, so a failed seed leaves nothing in the list.

Helpers: `fixed` (a command that ignores the document), `opening` (an opening of a given width centred on the wall through a point, found by `wallThrough`), `piece` (a piece by its centre, turned into the stored anchor by `anchorAt`), `raised` (place on free floor, set size and elevation, then move: placing takes no elevation), `placementIn` (a piece's placement in a layout), `apart` (marks every `placeObject` in a list `linked: false`), `outsideWalls` and `roomWalls`.

## The seed diff

`packages/server/scripts/compare-sample.ts` checks a build recorded in a data folder against its sample's seed:

```
tsx scripts/compare-sample.ts <data folder> "<sample name>"
  → "<name>" matches its seed.   exit 0
  → one line per difference      exit 1
```

It seeds the sample into a scratch folder and calls `compareToSample(recorded, seeded)`, which returns one sentence per difference:

- rooms by label name (an unlabelled room is `Unnamed room <face key>`): missing, extra, or an area differing by more than `AREA_TOLERANCE`, 0.1 m²;
- the decks' tops, sorted, compared to two decimals;
- the number of openings;
- the number of stairs in the first layout (pieces whose kind has a `stairRuleOf`).

Furniture is not compared.

## Livable by test

`packages/server/test/livable.ts` holds test helpers only; nothing outside the tests reads them. Each check returns its problems as sentences, empty when the drawing passes: a door with the outside on one side; a way up to every deck; every room reachable from an entrance; no warnings; a person able to walk to every use zone (the clearance walk); no piece over a window's glass. A stair's own check lines are not warnings.

## The Studio fixture

`packages/server/scripts/seed-studio.ts` exports `STUDIO_NAME` ("Studio"), `studioSteps` and `seedStudio`. It is a flat, furnished studio for tests and is not a sample; the "20 ft studio" is a different house. Every piece is placed per layout (`apart`). `packages/server/test/seed-studio.test.ts` checks what the layout must achieve; the seed owns the coordinates.

- Shell: `rectangleRoom` 7 × 2.5 m on the 0.20 m walls' centre lines (clear x 0.1 to 6.9, y 0.1 to 2.4), a flat 3.05 m ceiling, a partition on x 1.5 cut to 2.03 m with a 0.80 m swing door at y 0.8 to 1.6, a 1 m window in each long wall (south at x 5.2, north at x 5.8). No outside door and no way up to the loft.
- Decks: a hollow Loft at 2.15 over x 0.1 to 2.5, y 0.1 to 2.4, in wide planks `#a99c8a`, with one railing on its 2.30 m open edge; a hollow Platform at 0.45 over x 2.6 to 4.6, y 1.3 to 2.4, with its own finish (`null`) and no guard.
- Layouts Day and Night (Night copied from Day). Rooms labelled Bathroom (mosaic) and Main room (planks `#d8bc94`). Areas Kitchen (3.105 m²) and Living (6.9 m²), sharing x 4.6. Surroundings `wheels`.

```
Day (y up)
y 2.4 ┌─────────┬───────┬════════════════════┬────────────────────┐
      │ shower  │fridge │    sofa 2 seats     │ lift bed up        │
      │ (loft   │       │ (bed stowed under)  │ over table, chairs │
      │  2.15   door    ├═════╤═══════════════┤ tucked at its ends │
      │  above) door    │ step│               │                    │
      │ washer  toilet  │ shelf    TV at 1.2  │ sink · hob · counter
y 0.1 └─────────┴───────┴─────────────────────┴──── window ────────┘
     x 0.1     1.5     2.6   3.1            4.6                  6.9
```

- The sofa (2 seats) stands on the platform in both layouts. The roll-out bed (Small single, 0.85 × 1.95 m, 0.30 high) is stowed under the platform by Day and slides out along y at Night to y 0.45 to 1.30, 0.35 m from the south wall.
- A `tvUnit` 1.2 × 0.10 m hangs at 1.20 to 1.80 on the south wall, facing the sofa.
- By Day only: an extending table, closed, turned 90° at (5.75, 2.00), flush with the north wall (y 1.60 to 2.40, ends at x 5.15 and 6.35), under the raised lift bed; two chairs tucked at its ends, each backrest flush with an end and 0.35 m under it; a "Step", a 0.5 × 0.3 × 0.225 m block on the floor touching the platform's front edge at its west end.
- At Night the lift bed is down.
- Zones fitted per layout: the stowed bed has none; out at Night, only its `left` side, 0.35 m deep. The lift bed keeps only `left` by Day and none at Night. The table keeps only `left`. The sink, hob and counter fronts are 0.90 m deep by Day, the kitchen's aisle to the table, and off at Night.
- Result: no clearance warnings by Day or by Night. The main room's free floor is 6.0725 m² by Day and 3.7025 m² at Night.

## Limits

- Seeding never changes an existing project and stores no record of what it seeded.
- The seed diff ignores furniture and finishes, and counts stairs in the first layout only.
- The Studio is not seeded by `start.sh` and has no entrance or loft access, which its tests don't need.
- No sample has wheel wells.
