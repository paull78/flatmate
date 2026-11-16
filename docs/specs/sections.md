# Sections

A section is a vertical cut through the drawing along a straight line, seen for one layout. This document covers the stored row, drawing and editing one, depth, what the picture shows and in what order, the strip under the plan, the marks on the plan, a section on paper and Claude's `add_section`. Only the marks follow a standard (ISO 128-3).

## The data

The shared table `sections` holds `Section = { id, a, b, side, depth }` (`packages/domain/src/section.ts`), read in letter order through `sectionsOf` (`packages/domain/src/queries/sections.ts`).

| Field | Meaning |
|---|---|
| `id` | the letter, A to Z; it is the row's ID, so it never changes |
| `a`, `b` | the line's ends, kept to the millimetre |
| `side` | `1` looks to the left of a → b, `-1` to the right |
| `depth` | `null` sees the whole drawing, `0` only the cut, else metres past the line |

- `addSection { a, b, side, depth? }` takes the first free letter; `setSection { sectionId, a?, b?, side?, depth? }` changes what it is given (`depth: null` sets whole); `deleteEntities` removes one (`packages/domain/src/commands/sections.ts`). Each depends on its own row only, so two people taking one letter clash like any edit of one row.
- Invariant I25 (`packages/domain/src/validate-sections.ts`): one capital letter, a line of at least `MIN_SECTION_LENGTH` (0.50 m), a depth not negative. With every letter taken, `addSection` is refused. No rule reads another table, so no other edit can make a section invalid.
- A file with no `sections` table reads as having none.
- A section is called "A–A" (`sectionLabel`). Deleting it deletes its section sheets in the same command (`sheetsInStep` in `packages/domain/src/commands/sheets-strip.ts`).

## Drawing and editing

The Section tool (`S`, [tools.md](tools.md)) is floor only ([levels.md](levels.md)). `sectionPointer` in `packages/editor/src/tools/section-tool.ts` takes three presses:

1. A sets the first point.
2. B sets the second, with the Dimension tool's snaps from A. A B the domain would refuse (too short, no letter left) toasts its reason and A stays.
3. The side comes from the raw pointer; a press on the line looks left. This commits one `addSection`, selects the new row and picks Select.

The preview draws the mark under the letter it would take. Esc steps back: B, then A, then Select. Picking the tool turns the viewer's marks back on.

A selected section edits on the canvas (`packages/editor/src/tools/section-edit.ts`):

- **End grips** move one end with the tool's snaps, angles and Shift's axis, measured from the other end.
- **Far grip**, on the far line's middle, sets the depth: the distance from the cut towards the seen side, on the grid (to the millimetre with Ctrl), stopping at 0. With whole depth it sits `WHOLE_GRIP_PX` (24 px) off the cut.
- **Arrow click** on the only selected section flips its side. The first click on an unselected section's mark only selects it.
- **Properties** (`packages/editor/src/properties/section.ts`): Letter and Length to read, Depth (blank is Whole, 0 only the cut) and Flip.

Each change is one `setSection`.

## The marks on the plan

```
  A  ▬▬▬ ─ ─ ─ ─ ─ ─ ▬▬▬  A
      |               |
      ▼               ▼      arrows point at what the section sees
```

`sectionMarksLayer` (`packages/editor/src/view/section-marks-layer.ts`) draws every section in every layout and at every level: a thin dashed line between thick ends, an arrow at each end and the letter past each end, sized in screen pixels by the style's `mark`. A selected section draws in the selected colour and, with a depth above 0, shades the band it sees. Marks select at every level; their place in the hit order is in [tools.md](tools.md).

- **On screen.** A Sections switch in the canvas's corner chip (`CanvasCorner` in `packages/web/src/panels/RendererToggle.tsx`), shown once there is a section, hides this viewer's marks (`sectionMarksOn`, never synced, saved or undone). A selected section stays drawn and clickable; hidden marks take no clicks.
- **Per sheet.** A sheet's `marks` (true by default) is the Section marks switch in its settings, shown once there is a section. Off, the page prints no marks and nothing else moves. Framing around marks is in [export.md](export.md).

## The picture

`sectionPicture(doc, section, layout, style, zoom)` (`packages/editor/src/view3d/section-picture.ts`) is shared by the strip, paper and Claude. It is in metres, x along the line to the viewer's right and y up, so a flip mirrors it; the line's ends set its width. It reads every level's walls, decks and pieces in the layout, and uses `SECTION_INKS` in every style. Its title, "A–A · Day", comes apart.

Drawing order, far to near:

1. **Beyond** (`section-beyond.ts`): what lies past the cut within the depth, white with outlines, clipped at the cut, the far line and the line's ends. Walls show the finish of the side facing the viewer. A piece draws its parts and the panels facing the viewer; a stair, plant or clock draws its own faces as one unit. Doors and windows are rectangles on their wall. Guards are thin outlines. `farToNear` (`section-order.ts`) orders overlapping solids by depth along the ray at the middle of their overlap.
2. **Cut furniture**: parts the plane passes through, light grey and outlined. A stair is never cut.
3. **Window panes** where the plane passes through a window.
4. **The dark cut** (`section-cut.ts`): walls with their joint caps, decks and the two bands, traced as one shape with no seams. A cell fills only where bodies lie on both sides of the plane, so a plane on a free face cuts nothing. A door leaves a gap, a window its sill and head. Guards are too thin to cut.
5. **Heights**: a line and value at the side for 0.00 ("±0.00"), each deck top the section sees and the ceiling. Values too close to read stack upward.

The bands are `SECTION_BAND` (0.10 m) below 0.00 and above the ceiling, graphics only: no measurement changes. Under a shed or gable roof ([roofs.md](roofs.md)) the cut is clipped under the ceiling, the band follows the roof, walls beyond show their sloped tops, and the heights give the ceiling at the walls' box and the ridge.

## The strip under the plan

Each viewer's section frame keeps `state.stripSection` apart from the selection (`stripAfter` in `packages/editor/src/view/section-strip.ts`, `packages/editor/src/section-ui.ts`):

- Selecting a section opens or switches the strip; selecting anything else leaves it; the section's delete, local or remote, closes it.
- The title bar shows the label and layout, then a letter per section when there is more than one. In idle Select a letter switches the picture and selects that section; mid-gesture in another tool it only switches the picture.
- Close deselects a selected section, so a click on it opens the strip again.
- The picture follows the viewed layout and the saved document, not a drag's preview. It is centred, as large as fits, with fixed margins in CSS pixels (76 on the right for the heights) and fixed-size text, drawn on Canvas2D through `PageCanvas` whatever the plan's renderer.

The dock (`packages/editor/src/frames-state.ts`) is per viewer and never saved:

| Value | Constant | |
|---|---|---|
| dock height | `DOCK_HEIGHT` | 0.46 of the stage |
| Larger | `LARGER_HEIGHT` | 0.74 |
| section beside 3D | `sectionShare` | 0.56 at first, 0.20 to 0.80 |
| least dock, least plan | `styles.css` | 200 px, 180 px |

Dragging the sash above the dock resizes it; a double-click resets it. Larger, or a double-click on a title bar, toggles 0.74. Beside the 3D panel, Swap exchanges places, each keeping its width; the 3D panel is in [view3d.md](view3d.md). With every frame closed the plan is whole.

## On paper

A sheet of kind `section` draws the section its `section` letter names, for 1 to 4 layouts, never levels (I23 in `packages/domain/src/validate-sheets.ts`). `sectionPage` (`packages/editor/src/export/page-section.ts`) splits it into panes as a compare sheet, through `panesPage`, at one scale and one framing. Each pane's band names its layout, so the picture's title stays out. Framing is metres along the cut and up from the centre of `sectionBounds`, the same in every layout, so panes align; it leaves 0.10 m left, below and above, 1.30 m right for the heights.

- A new section sheet draws the viewed layout, titled "Section A–A" (`sectionSheetTitle`). Changing its letter, in the panel or with `set_sheet`, moves a title still in that form to the new letter.
- The sheets view offers each section with no sheet (`missingSections` in `packages/editor/src/export/sheet-list.ts`).
- A section sheet has no floor finishes and no marks switch. Scales, orientation and the page's parts are in [export.md](export.md).

## Claude

`add_section` (`packages/mcp/src/section-tools.ts`) takes `a`, `b`, `side` ("left" or "right" going from a to b; left is side 1) and an optional `depth` (0 only the cut; left out, whole), and replies with the letter. `get_drawing` lists sections as `{ id, a, b, side, depth }`. `look` with `view: "section"` takes the letter and a layout, the first by default (`lookSection` in `packages/editor/src/view/look-section.ts`). The rest is in [mcp.md](mcp.md).

## Limits

- At most 26 sections, A to Z.
- Claude has no `set_section`: it deletes and re-adds, which deletes the section's sheets and may change its letter.
- No gesture moves a whole section, and the far grip can't give back whole depth (a blank Depth does).
- Doors and windows beyond can't be seen through.
- Solids that interlock beyond can form a cycle; one is drawn out of turn.

## At levels

A section cuts every level: the picture shows the floor, platforms and lofts, their decks cut dark and their pieces in the layout, with each deck top it sees at the side. The marks draw and select at every level ("Section: any" in [levels.md](levels.md)). Drawing one is floor only: picking the Section tool views the floor, and viewing a level above drops it to Select. A section sheet draws layouts, never a level.
