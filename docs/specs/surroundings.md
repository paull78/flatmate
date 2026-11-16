# Surroundings

What Flatmate draws round and under the house. This document covers the ground the 3D view shows round the house and the 3D panel's menu that picks it, the trailer under a tiny house on wheels with its settings, the steps at its outside doors, and wheel wells, the pieces where the trailer's tyres rise into the room. The ground, the trailer and the steps are only drawn, in 3D.

## The setting

The project's surroundings is one row in the sheet set's settings (`SET_FIELDS` in `packages/domain/src/project-fields.ts`), key `surroundings`, read by `surroundingsOf`. It is stored as `interior`, `outside`, `wheels` or `grid` (`SURROUNDINGS_VALUES`, with the labels Interior, Outside, On wheels and Grid). None is no row, and a project that never chose reads as None. `setProjectField` refuses any other value with "Surroundings must be interior, outside, wheels or grid; empty means None", `none` included; an empty value clears the row, and setting the value a project already has is no edit. The row is saved, undone and synced like any project field ([domain.md](domain.md)), and printed nowhere: no title block, cover or report shows it.

Only 3D pictures change with it: the 3D panel, project cards and Claude's `look`. Plans, sections, PNG, SVG and PDF sheets are the same in every style.

**The menu.** The 3D panel's header holds a native select (`SurroundingsMenu` in `packages/web/src/panels/SurroundingsMenu.tsx`) listing None and the four values. A pick sends `setSheetSetting`, which runs `setProjectField`; it works with something selected. The select blurs after a pick, so `Cmd/Ctrl+Z` and tool keys work straight after, and it shares the dropdowns' key guard (`guardClosedSelect`, [tools.md](tools.md)). It is disabled while the project can't take an edit, and dims only after 400 ms so it doesn't blink.

**Claude.** `set_project_field` sets `surroundings` and the three trailer fields; `get_drawing` lists them under fields; `look`'s caption ends "; round it, the <label> surroundings, not part of the drawing" ([mcp.md](mcp.md)).

## The ground

Each value is one row of `SURROUNDINGS` in `packages/editor/src/view3d/surroundings.ts`:

| Value | Ground | Background | Plate | Ground below the floor | Lines |
|---|---|---|---|---|---|
| `interior` | `#d9d8d3` | `#ffffff` | box | 0 | none |
| `outside` | `#b9c9a3` | `#eef3f5` | round | 0 | none |
| `wheels` | `#b9c9a3` | `#eef3f5` | round | 0.75 m | none |
| `grid` | `#dbeee3` | `#ffffff` | round | 0 | `#a9c4b4` every whole metre |

`groundFaces` in `packages/editor/src/view3d/ground-faces.ts` builds the plate round the walls' box (every wall's outline, `shellBounds` in `view3d/camera3d.ts`):

- **Round plate.** A disc about the box's plan centre, solid to 0.72 of its radius.
- **Box plate.** The walls' box grown by a reach m, with quarter-circle corners, solid to 0.35 of m past the box. The box itself is filled, so the notch of an L-shaped house is ground too.
- **The fade.** Past the solid part, 32 opaque rings blend from the ground's colour into the background by smoothstep, the last ring exactly the background. No ring is see-through or outlined: the plate has no hard edge.
- **Height.** The plate lies 5 mm under the floor, or under the lowered ground on wheels, so it never ties with a floor at 0.
- **Size.** The rim lies sqrt(Rf² − h²) × 0.995 from the frame's centre in plan, Rf being the frame's radius and h the plate's depth below the frame's centre, so the plate stays inside the picture at every yaw and tilt. A box plate's reach m is that rim less half the box's plan diagonal. With no room left, no plate draws.
- **Grid's lines.** One at every whole metre along x and y, cut where it crosses a ring and faded with it, and left out inside the walls' box.

The picture is cleared to the row's background. A project card draws neither ground nor background, so its own grid shows ([cards.md](cards.md)).

**The frame.** With any surroundings, the camera frames the walls' box and then pulls back to 0.88 of the scale about the same centre (`framedBounds`, the `bottom` and `pull` of `Bounds3` in `view3d/types.ts`), so the ground has room. On wheels the box starts at the ground, 0.75 m below the floor. With a pull the depth range covers the frame's whole sphere, a metre each side. Under None the frame has no pull and no bottom. A card frames as the panel only on wheels; under the other values it keeps None's frame. The camera itself is in [view3d.md](view3d.md).

`aroundShell` is the one owner of what a style adds to a scene (the framed box, the ground, the background and, on wheels, the trailer), for the panel and `look`. `onWheels` gives a card the trailer and its frame alone, and nothing unless the ground lies below the floor.

## The trailer

On wheels, a trailer stands under the house (`trailerFaces` in `packages/editor/src/view3d/trailer-faces.ts`). It is read along the walls' box's long axis u (x on a tie), pointing toward the hitch, and across it v. For the low end the frame is mirrored, so everything below holds at either end.

```
 side view, the hitch on the right
              ┌──────────── house ────────────┐┌──┐ tongue box, on the bar
 floor 0      ├───────────────────────────────┤│  │
              └────────── steel deck ─────────┘╘══╧═══╡ drawbar, its tip
                           ◯   ◯                   ▌ jack
 ground −0.75 ──────────────────────────────────────────
                           └─┬─┘ axles' middle 0.3 m toward the hitch
```

**Settings.** Three more `SET_FIELDS`, read as one value by `trailerOf` in `packages/domain/src/trailer.ts`. A default is stored as no row; a wrong value is refused with its reason.

| Key | Values | Empty means |
|---|---|---|
| `trailerHitch` | `low`, `high`: the end of the long axis the drawbar is on | `high` |
| `trailerAxles` | `2`, `3` | `2` |
| `tongueBox` | `on` | none |

With nothing selected and Surroundings On wheels, Properties shows a Trailer section after Ceiling and Outside walls (`trailerFields` in `packages/editor/src/properties/trailer.ts`), closed by default: Hitch, named as the plan shows the ends (`hitchName`: Left and Right on a house long along x, Lower and Upper along y), Axles (Two, Three) and Tongue box (Off, On). Picking a default clears its row.

**The parts.** Steel parts use the style's `dark` slot, the hubs its `metal` slot. Of the trailer's steel only the deck is outlined; the steps below are outlined too.

| Part | Rule |
|---|---|
| Deck | covers the walls' box; top 2 mm under the floor; 0.25 m thick, or deeper so each wheel's top reaches at least 0.4 of its radius into it |
| Axles | two or three, 0.84 m apart, square 0.06 m; their middle 0.3 m from the long side's middle toward the hitch |
| Wheels | one at each end of each axle; radius 0.33 m, 0.22 m wide, 0.03 m in from the deck's sides; lowest point exactly on the ground; hub disc 0.55 of the radius |
| Shrinking | gear, wheels and axles scale by one factor when the deck is shorter than 2.16 m (two axles) or 3.00 m (three), or narrower than 0.56 m |
| Drawbar | a wedge from the deck's end, from the deck's width less 0.5 m a side to a 0.08 m tip, 0.08 m tall above the deck's underside; 1.30 m long, or shorter so its tip and the jack stay inside the frame's sphere (× 0.995); none under 0.35 m |
| Jack | a 0.10 m square column from the ground to the bar, its centre 0.25 m in from the tip |
| Tongue box | on the bar against the end wall when `tongueBox` is on and the bar is at least 0.90 m long: 0.60 m along the bar; as wide as the deck less 0.30 m a side (half the deck's width when it is under 1.20 m); 0.90 m tall above the bar at the wall, 0.70 m at the hitch's side, the lid sloping between (`tongueBoxFaces` in `view3d/tongue-box.ts`) |

**Steps at doors.** On wheels, each outside door gets steps down to the ground (`doorSteps` in `view3d/door-steps.ts`). An outside door is an opening whose kind is `walkThrough` (every door and the open passage; not windows or the curtain) on a floor wall with a room on one side only, tested 1 cm past each face (`outsideDoors` in `packages/domain/src/queries/outside-doors.ts`). The steps are one stepped solid in the style's `wood` slot: four equal risers from the floor to the ground, three treads 0.28 m deep, so 0.84 m out from the wall's outer face, as wide as the opening plus 0.10 m a side. They draw on any wall, the hitch's end too, and the frame does not grow for them. The panel, `look` and cards draw the same trailer and steps.

## Wheel wells

A Wheel well (kind `wheelWell`, `well` flag, in `packages/domain/src/kinds-more.ts`) is 1.80 × 0.40 m and 0.35 m tall, with presets Single, Tandem and Triple, 0.90, 1.80 and 2.70 m long (`WHEEL_WELL_PRESETS`). It is in the palette under every surroundings ([furniture.md](furniture.md)) and stands in every layout at one place ([layouts.md](layouts.md)). Claude places it with `place_object`; without `on`, its landing is asked as for an ordinary piece (`landsOn` in `packages/mcp/src/object-tools.ts` passes no well flag), then the command applies the well's rules.

**Under walls.** A well meets no wall (`solidsCollide` in `packages/domain/src/queries/fit.ts`). On the floor it needs only its centre in a room, outside every floor wall's body (`wellRoom` in `queries/footprints.ts`); a well with its centre under a wall is refused as not inside a room.

**Its part.** The well's part outside the walls is its rectangle cut at the inner face of each floor wall it overlaps, keeping its centre's side (`wellPart` in `queries/wells.ts`). Where a partition ends inside the well, the part beside its end is dropped too.

```
 wall ════════╤══════════╤═══   outer half under the wall: cut at the inner face
              │░░ part ░░│
              └──────────┘
```

**Covered.** A piece covers a well when the well's part, pulled in by 1 mm so a shared edge counts, lies wholly inside one of the piece's convex parts, and the well's top is below the piece's (`covers`). Then the two may overlap; any other overlap is refused as between any two pieces. `coveredWell` asks whether a piece in the well's layout covers it. Free floor counts the well's part, or nothing where a piece covers it ([layouts.md](layouts.md)).

**Drawn.** On the plan a well draws its outline and one tyre outline per about 0.90 m of its length (each up to 0.66 m long, inset from the sides). Covered, it draws as a dashed hidden line over its cover, as a stool under a table does. Walls draw after pieces, so a wall covers the part under it. In the stacking order a well counts as a seat: first among pieces at its bottom when drawing, last when picking. In 3D it is one plain box.

## Limits

- The trailer and the steps are only drawn: nothing checks the steps, the tongue box, the road height or what the trailer carries against anything. The tongue box's sizes are fixed.
- No gooseneck trailer: it needs walls standing on a raised floor ([roadmap.md](roadmap.md)).
- No porch and no cantilevered loft over the trailer.
- A well whose part spans two arms of an `L` piece is not covered by it. Only a piece on the well's centre's side of a partition crossing it can cover it.
- The ground has no textures, sky or shadows.
- No test covers a wheel well on a deck; the At levels lines below rest on the code.

## At levels

- **Ground and trailer.** They belong to the whole house: the frame comes from every wall's outline and the highest ceiling. The 3D view has no viewed level, so they draw the same at every level ([levels.md](levels.md)).
- **Door steps.** Floor only: `outsideDoors` takes only openings on floor walls, and the steps run from the floor to the ground. A door on a wall standing on a loft gets none; no wall stands on a platform ([levels.md](levels.md)).
- **Wheel wells.** A well lands by the landing rule as any piece, so it may stand on a platform or a loft. There it lies on its deck by the deck's rules ([heights-decks.md](heights-decks.md)), so it can't run under a floor wall. It still meets no wall, so on a loft it may cross a wall standing on the loft. Its part is cut only at floor walls.
