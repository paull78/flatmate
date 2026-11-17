# The 3D view

The 3D view shows the drawing; the plan edits it. This document covers what the view is, its camera and panel, how faces are built and drawn, walls, pieces' parts, decks in short, Claude's `look` in 3D, and how the view is tested. Openings in 3D are in [openings.md](openings.md), finishes and patterns in [finishes.md](finishes.md), the roof in [roofs.md](roofs.md), the ground and the trailer in [surroundings.md](surroundings.md), stairs in [stairs.md](stairs.md), guards in [guards.md](guards.md), the plan's renderers in [rendering.md](rendering.md).

## What it is

- **Read-only.** Clicks and drags in the panel never reach the plan; nothing is selected in 3D. Pieces and decks selected on the plan draw in the selection blue.
- **Built from plan shape and height range.** Rooms' floors, each wall's mitred outline and range, each opening's range (`openingRange`), decks, guard runs, and each piece's drawn shape, pose and range in the viewed layout. Nothing is stored for 3D.
- **Per viewer.** `View3dState` in `packages/editor/src/view3d-state.ts` is `{ open, size, yaw, tilt, roof }`, starting as `CLOSED_3D`, never synced, saved or undone.
- **Plain data first.** `view3dItems` (`view3d/items.ts`) turns the document into `Item3d` values (`floor`, `wall`, `deck`, `guard`, `piece`, in `view3d/types.ts`); `faces3d` (`view3d/faces.ts`) turns each into faces. The panel and project cards draw them with WebGL2, Claude's `look` with `raster3d`, through one camera uniform (`view3dUniform`).
- **Finishes.** The panel follows the viewer's Finishes switch ([finishes.md](finishes.md)). A project card's 3D (`cardFrame3d`) always shows finishes, selects nothing, has no ground or background, and draws a trailer only on wheels ([cards.md](cards.md)).
- During the Day/Night flip ([layouts.md](layouts.md)) pieces take the plan's tweened poses; a piece in one layout only shows until the middle of the flip, or from it.

`view3d/` paths are under `packages/editor/src/`; `triangles3d`, `raster3d` and `view3dUniform` are in `packages/render/src/`.

## The camera

The camera is orthographic (`camera3d` in `view3d/camera3d.ts`) at two angles in degrees:

- **yaw**: the direction from the drawing to the camera, counter-clockwise from +x (0 east, 90 north, 225 south-west), any value taken round the circle;
- **tilt**: how far it looks down, `TILT_MIN` 10 to `TILT_MAX` 90 (straight down).

It starts at `DEFAULT_ANGLES` (225, 35). The light is fixed in the world, from the north-west.

**Framing.** The camera frames the box of every wall's outline from the floor up to the highest ceiling, the roof's high side under a shed or gable (`shellBounds`, top `highSide(doc)`). It fits the box's 3D diagonal into the picture with a margin of 0.06 of the clip square and centres it, so the scale and centre never change while the view turns. Pieces, decks and the flip never move the frame. With surroundings it pulls back ([surroundings.md](surroundings.md)). Without walls the panel draws nothing.

**The cutaway.** The ceiling is not drawn. A wall with a room on one side only is hidden while its outer face looks toward the camera (`hiddenWalls` in `view3d/hidden.ts`); one seen exactly edge-on stays. Dividers and free walls always draw. A wall appears or disappears as the yaw crosses its edge-on angle, with no fade. Its openings and caps hide with it. With the Roof switch on no wall is hidden, and the roof draws only under a shed or gable ([roofs.md](roofs.md)).

## The panel

`View3dPanel` (`packages/web/src/panels/View3dPanel.tsx`) has two sizes, `View3dState.size`:

| Size | Where | How big |
|---|---|---|
| `corner` | floats over the plan's bottom-right, above the dock | `min(420px, 45%)` wide, `min(340px, half the stage above the dock)` tall |
| `split` | docked in the strip under the plan | the dock's height: 0.46 of the stage, 0.74 with Larger |

With a section open in the strip too, the two sit side by side: the section takes 0.20 to 0.80 of the width (0.56 at first), and Swap changes sides (`frames-state.ts`; the strip is in [sections.md](sections.md)). The title bar holds the surroundings menu, the Roof switch (absent with no roof to show), turn left and right, corner or dock, Swap and Larger when docked, and Close. A closed panel leaves a "3D" chip that reopens it. The picture fits a centred square.

**Orbit.** A primary-button drag orbits like a turntable, 0.4 degrees a pixel (`ORBIT_DEG_PER_PX`). A drag right lowers the yaw, so the camera circles clockwise and the model's near side follows the hand. A drag down raises the tilt, held to 10 and 90. A double-click resets to `DEFAULT_ANGLES`. The panel forwards only pixel deltas, as the UiAction `orbit3d { dx, dy }`; the editor owns the degrees and the range. The yaw is kept from 0 to under 360, rounded to a nanodegree.

**Keys** (`view3dKey`), never with Ctrl or Cmd: `3` shows or hides the view; `Shift+3` (or `#`, `£`) switches corner and split, opening it; `[` and `]` turn the yaw 90 degrees from wherever it is, while open, Alt allowed.

**Renderer.** WebGL2 is the only one (`packages/web/src/view3d-renderer.ts`). Without it, or after a lost context, the panel says "The 3D view needs WebGL2" and the app carries on. The frame is `{ scene, angles, size }`; the scene keeps its identity while only the angles change, so WebGL builds its triangles once per scene and sets the camera's uniform per draw, at most once per animation frame.

## Faces

A `Face3d` is a flat ring with holes, a colour, its owner (`itemKey`, as `wall/<id>`), optional `lines`, and `outline: false` to leave out its outline.

- **Wound from outside.** Every builder lists every side of its solid, counter-clockwise seen from outside, through `orient(points, n)` in `view3d/prism.ts`, stating the outward normal it means. `triangles3d` winds each triangle as its face, and both renderers cull back faces. Nothing depends on the camera or is sorted.
- **No bottom faces.** Prisms and slabs list sides and top only: the camera always looks down.
- **Depth.** A depth buffer hides what is behind. Fills are pushed back by `FACE3D_POLYGON_OFFSET` (`render/src/shaders3d.ts`), so edges draw on top, in `#6f6d68`.
- **Shading.** Flat colour per face: the top shade facing up, else lit or shaded by its direction to the light (`sideShade`).
- **Ties.** A panel (a door front, a handle, a hob ring) stands 0.5 mm off its face, 0.25 mm more for each panel it overlaps. A pattern sits 1 mm above its floor (`patternLift`).

`sceneFaces` (`view3d/scene-faces.ts`) gives floors, the walls not hidden, decks, guards and pieces, then the roof when shown and the trailer. The ground is drawn apart, first.

## Walls in 3D

A wall is its mitred plan outline ([walls-rooms.md](walls-rooms.md)) raised from its bottom to its top as one holed solid (`wallFaces` in `view3d/wall-faces.ts`). Along the wall and up it is a grid cut at every opening's ends, sill and head; a cell is wall where no opening covers it:

```
   top  ┌────┬────┬─────┬────┐
        │ ■  │ ■  │  ■  │ ■  │
  head  ├────┼────┼─────┼────┤
        │ ■  │door│ win │ ■  │
  sill  ├────┼────┼─────┼────┤
        │ ■  │    │  ■  │ ■  │
 floor  └────┴────┴─────┴────┘
```

The long sides are the traced boundaries of the wall cells, with jambs, sills under windows and a threshold under a door in its floor's colour. Openings are kept to the wall's clear span (`wall-spans.ts`), so none reaches into a corner; one under 0.10 m tall is not cut. Long sides draw in their finishes' bands ([finishes.md](finishes.md)); under a slope a full wall is cut under the roof's planes ([roofs.md](roofs.md)).

**Joint caps.** At a joint of three or more walls, the share held by a shorter wall is empty above its top. Where a wall's share sits below both of its neighbours in `jointOrder`, the lower neighbour carries it as a cap from the shorter wall's top to its own (`jointCaps` in `view3d/joint-caps.ts`; a tie goes to the lower wall ID). Tops are compared at the joint (`wallTopAt`). A cap is part of its owner's `WallItem.caps`, drawn and hidden with it. An L joint has no caps.

**No seams.** `wallSeams` (`view3d/wall-seams.ts`) runs on the faces a scene shows, so a split wall, plain or in one finish, or a cap over a partition, reads as one flat wall:

- a wall face wholly covered by wall faces in its plane facing the other way lies inside the solid and draws no outline;
- the stretch of outline two shown wall faces share, in one plane, of one colour, facing the same way, is not drawn.

A wall's own faces take part: those in the plain wall or selected colours, and those in a shade of a finish the scene's walls show (`finishedShades` in `view3d/scene-faces.ts`). Two halves in different colours keep the line between them. Frames, leaves and glass, pieces, decks, guards and the trailer keep every line, as do real corners, edges between colours and back-to-back faces.

## Pieces' parts

The box stays the rule: fit, collisions, zones, headroom and selection see only the box or drawn shape; parts are a picture inside it. `faces3d` draws a stair's body ([stairs.md](stairs.md)), else a kind's own faces (plants, the clock, the washing machine, taps: `ownFaces`), else its parts (`partSolids` in `view3d/parts/solids.ts`).

- **The table.** `APPEARANCE` (`view3d/parts/index.ts`) maps every live furniture kind to `(config, w, d, h, options, arms, flue) → Part[]`. A kind without an entry is one plain box.
- **Parts.** An upright prism: a `box`, a 12-sided `cylinder` inscribed in its box, the piece's own `outline`, or a convex `ring`, built in the piece's local frame (`view3d/local-frame.ts`: x across, y from the front at −d/2 to the back, z up from its bottom). Parts are convex by convention.
- **Sizes by rule** (`parts/sizes.ts`). Legs, frames, arms, plinths and worktops keep a real size capped by a share of the box (`capped`), at every size and every step of the flip; tops, seats and cushions span the rest. A repeated part is counted from the size (`countOf`), at most 8 (`MAX_REPEAT`).
- **Shared with the plan.** `sofaArm`, `sofaSeats` and `bedPillows` (`view/piece-counts.ts`), and the domain's `MURPHY_MATTRESS_INSET`.
- **Configurations.** Parts depend on the configuration: a closed Murphy bed is a cabinet, an open one lies out on two front legs. During the flip the target's parts are rebuilt each frame in the tweened box.
- **One box.** `block`, `roundBlock`, `cornerBlock`, `wheelWell` in `plain`; `beam` in `wood`; `rug`, `roundRug` in `linen`.
- **Sets.** A table or desk with chairs draws the table's parts and each chair's own ([seating.md](seating.md)). The round chair is four legs under a cylinder seat, with a back of five short pieces along a curve.
- **No piece reads another.** A table's legs may cut a chair tucked at a corner, and a shelf over a desk may meet its monitor.
- **Face budget.** At most 150 faces per piece at any size up to 10 m; 150 × (1 + chairs) for a table or desk with chairs.

**Colour.** Each part has a slot, three shades (top, lit, shaded) in `STYLE_3D.slots` (`view3d/style.ts`). Tops: `wood` `#d6b88f`, `dark` `#4d4945`, `fabric` `#9db09a`, `linen` `#f3e7d3`, `laminate` `#f8f7f3`, `metal` `#bcc1c6`, `ceramic` `#f5f5f2`, `plain` `#f4f3f0`, `flame` `#f2a33a`. Every slot's top stays more than 14 apart from the floor, a deck's top, the selection blue and the background. A selected piece draws all its parts in the selection blue.

## Decks

A deck is its slab ([heights-decks.md](heights-decks.md)) extruded with its holes open (`slabPrism`): a solid deck from the floor, a hollow one from its underside, to its top. It draws in mid oak (`STYLE_3D.deck`, top `#c49a6c`), its top in its finish if any ([finishes.md](finishes.md)), all blue when selected. The roof's slab draws only with the Roof switch on ([roofs.md](roofs.md)).

## look in 3D

`look` with `view: "3d"` ([mcp.md](mcp.md)) takes optional `yaw` and `tilt` (the panel's first view by default), `layout`, and `roof` (the Roof switch for that picture). `lookScene3d` (`view3d/look3d.ts`) returns faces, bounds, angles and colours, never pixels. It refuses a tilt outside 10 to 90 ("The tilt is 10 to 90 degrees"), a drawing without walls ("Nothing to look at in 3D yet: draw some walls") and an unknown layout. It always shows finishes, selects nothing and has no flip. The MCP draws it with `raster3d` at 1100 px square (`LOOK_LONG_SIDE`) through the panel's uniform. `raster3d` mirrors the WebGL pass: depth test LEQUAL, back faces culled, the same fill offset, outlines about one pixel wide. The caption names the layout and both angles, what the cutaway or Roof switch shows, and any surroundings as not part of the drawing.

## Testing

Two renderers draw one picture. `raster3d` with culling must equal drawing every triangle both ways, and the panel's WebGL picture of the sample studio must agree with `look`'s PNG on at least 97 % of pixels within 8 per channel.

## Limits

- No zoom, pan or perspective; no lights or shadows beyond flat shading; nothing see-through.
- No selecting or editing in 3D.
- The frame reads only walls and ceilings, never door leaves or the roof's overhang: a wide door leaf swinging outward from a very small room can run off the picture.
- A leaf has one pose ([openings.md](openings.md)). No piece's parts read another's.
- No textures, imported models, bevels, lying cylinders or sloped parts.
- No 3D view on the PDF and no WebGPU 3D renderer.
- An L joint whose walls have different tops keeps its mitred corner.
- A wall's own faces are told by colour, not by a mark: a frame or leaf drawn in exactly a wall finish's shade, in the wall's plane, would lose a line it shares with the wall. The joinery colours are fixed, so it takes a finish typed to match one.

## At levels

The 3D view has no viewed level and no cut: changing the viewed level never changes it, and every level draws at once ([levels.md](levels.md)). Walls never draw thin or dashed in 3D. Rooms' floors draw at 0.00. A platform is a solid slab from the floor to its top, its pieces on its top. A loft is a hollow slab with room under it, its pieces on its top, the walls standing on it from its top (`wallRange`) with their openings, and its guards. The cutaway asks the same question of every wall, a loft's included: a room on one side only. Claude's `look` in 3D shows the same, for the layout it names.
