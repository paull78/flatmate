# Export

How a drawing leaves Flatmate: a PNG or SVG of the plan in view, or a PDF built from the project's sheet set. This covers the images, the sheets, papers and scales, each kind of page, the title block, the rooms table, project fields, the logo, the sheets view and how a PDF is checked. Section sheets belong to [sections.md](sections.md), Claude's sheet tools to [mcp.md](mcp.md), floors on paper to [finishes.md](finishes.md).

## Pictures, PNG and SVG

Every export draws through `planPicture(doc, view, style, zoom, finishes)`, the canvas's own layer builders, so canvas and paper cannot drift. The style is `presentationStyle(doc)` (`packages/editor/src/view/plan-style.ts`): black on white, Helvetica, no room fills. Room tags, dimensions, deck labels and section marks take the project's accent, brick red `#b3261e` unless set. `zoom` is paper millimetres per metre (1000 / scale), so widths and text sizes read as millimetres. Exports are metric only, and placed dimensions print on every page and image.

`download` (`packages/editor/src/export/panel.ts`) saves PNG and SVG of `planView(state)`, the active layout at the viewed level:
- SVG: `toSvg` at 1:100 (`SVG_ZOOM` 10 units per metre, a unit a paper millimetre).
- PNG: a `rasterise` effect with the same picture as a page, 3,000 px on its long side (`PNG_LONG_SIDE`); the shell answers `rasterised` with an opaque `ImageHandle`, then `saveFile`. A stale answer is ignored.
- Frame: `markedBounds(doc, layout)` (`packages/editor/src/view/picture.ts`), the floor's whole drawing grown to take section ends and the roof's edge; never the screen view.
- Finishes: a With or Without choice (default With), per viewer and project for the session (`exportChoices`). PNG and SVG only.
- The plan alone, unclipped, no title block; every character shows.
- File name: the project name with `/ \ : * ? " < > |` as "-", "Untitled" when empty.

## Sheets

The table `sheets` holds `{ id, kind, order, inPdf, title, scale, split, cx, cy, finishes, marks, drawings, text, size, section }` (invariant I23). Only `sheetsOf(doc)` (`packages/domain/src/queries/sheets.ts`) reads it; a lint rule forbids `doc.sheets` outside the domain.

| Kind | Drawings | Prints |
|---|---|---|
| `plan` | 1 | a plan and the title block |
| `compare` | 2 to 4 | panes at one scale and framing |
| `cover` | 1 | a cover with an index |
| `report` | 0 | text over one or more pages |
| `section` | 1 to 4 layouts | [sections.md](sections.md) |

- A drawing is a layout and a deck naming its level (`levelOf`; null is the floor), stored in four flat slots `l0, d0 … l3, d3` filled in order.
- `scale`: one of `SHEET_SCALES` 20, 25, 50, 75, 100, 200 (1:N), or null to follow the general scale.
- `cx, cy`: the framing in metres. `split`: `auto`, `stacked` or `sideBySide`.
- `finishes` (default on): the page's floors. `marks` (default on): section marks ([sections.md](sections.md)).
- `text`: a report's text, at most 20,000 characters (`MAX_SHEET_TEXT`); `size`: `small`, `normal` or `large`.

**Automatic until edited.** With no rows the list is `automaticSheets(doc)`: per layout in order, a plan at the floor, then one per loft level where that layout has pieces of its own. Ids are `auto/<index>`, titles `drawingTitle`, all In PDF at the general scale. Any sheet command first writes the whole list under those ids. After that a new layout or loft adds no sheet, and the view offers each drawing the automatic list would print that no sheet shows. A delete that empties the table makes it automatic again.

**Commands** (`packages/domain/src/commands/sheets.ts`), each depending only on its own row:

| Command | Does |
|---|---|
| `addSheet { opId, kind, after, first, …fields }` | adds `<opId>/t0` after `after` (null: last), or first |
| `setSheet { sheetId, …fields }` | changes the fields given |
| `deleteSheet { sheetId }` | refuses the last: "A project keeps at least one sheet" |
| `moveSheet { sheetId, index }` | refuses "That place isn't in the list" |
| `setSheetsInPdf { on }` | ticks or clears all in one step |

A row is refused with its I23 reason: a drawing count wrong for its kind ("A compare sheet holds 2 to 4 drawings"), gaps in the slots, a scale off the list, text over the cap, "Layout not found", "Deck not found", "Name too long"; an unknown id is "Sheet not found". A moved sheet's `order` goes halfway between its neighbours, or the list renumbers.

**When a layout or deck goes** (`sheetsInStep`, in the same command): a pane whose layout has gone, or whose level has no deck left, drops out; a sibling deck at the same level takes over a deleted one. A plan left empty is removed, a compare left with one pane becomes a plan. A cover is re-pointed, to the first layout and to the floor. A report is untouched.

## Papers and the set

`PAPERS` (`packages/editor/src/export/paper.ts`), in millimetres: A4 210 × 297, A3 297 × 420, A2 420 × 594, A1 594 × 841, Letter 215.9 × 279.4. The title block column is 60 mm wide on A4 and Letter, 75 mm on the rest. Pages are in paper millimetres, origin bottom-left, y up, with a 10 mm margin; the drawing area is inside it, left of the column.

`sheetSet(doc, options)` (`packages/editor/src/export/sheet.ts`) holds what every page shares:
- paper: the set setting, else A4;
- general scale: the setting, else Fit, the largest scale at which the floor drawing of every layout fits centred, else 1:200;
- one orientation, from the largest drawn width and height on paper of every In PDF sheet with a drawing except section sheets, each at its own scale; `orientationFor` picks the one holding it larger, landscape for a wide drawing on a tie. Framing never turns pages;
- one column fit (below), each In PDF sheet's first page number and the page total;
- the date: the date of issue as typed, else `Host.today()`.

`pagesOf(doc, sheet, set)` draws one sheet, kept in a WeakMap by document; `sheetPages` gives every In PDF page in order. A page's floors follow its own sheet's `finishes` flag alone. Nothing refuses a save: a scale that doesn't fit prints clipped. Save PDF is disabled only with nothing ticked ("Tick a sheet to save a PDF"); Export needs walls ("Draw some walls first").

## Framing and fit

A plan, compare or cover frame centres on the middle of the floor's drawing over every layout (`sheetBounds`) plus `(cx, cy)`, so sheets line up when flipped through. A frame drag commits once on release, in paper millimetres; `framedBy` stores metres to the millimetre.

`planFits` (`packages/editor/src/export/fit.ts`) asks whether what is drawn lies 5 mm (`FRAME_INSET_MM`) inside the frame. What is drawn (`drawnBounds` at the drawing's level): walls, the layout's pieces shown there, door swings, the roof's edge, and at the floor labels and dimensions. A compare measures the union of its panes against one pane. Showing part is a note, never an error: the scale grid marks each scale that would cut; shortcuts centre it, or offer the largest scale showing it whole and the next larger paper; the status chip counts sheets showing part and sheets with their own scale. A new cover, compare or section sheet that the general scale would cut opens at the largest scale showing it whole.

## Pages

**Plan.** A solid frame round the drawing area, sharing its edge with the column. The plan is clipped to it (`ExportPage.clips`: `q … re W n … Q` in the PDF). Bottom left, on a white plate with an accent rule, outside the clip: "TITLE  ·  scale 1:50", the title upper-case and cut with "…".

**Compare.** Equal panes sharing their edges, one scale and framing. Each has a 9 mm band with its drawing's name; its plan is centred in and clipped to the box under it, the fit test's frame. Automatic picks the split that draws larger, stacked on a tie, never reading scale or framing. One title. No rooms table.

**Cover.** An accent band on the left edge, the plan clipped to the left part with no border, title and scale at its bottom left, and a tinted column (41 % of the width): logo (up to 16 mm), title (13 to 6 mm, the largest holding the whole name), date, an index of the sheets In PDF with their numbers (2 to 4 columns, 4 to 2 mm; none with fewer than two sheets), and at the foot studio details, north and scale. It takes a number but prints none, and has no title block. A new cover goes first, titled "<drawing> cover".

**Report** (`report-text.ts`, `report-flow.ts`). A `#` line before anything else is the title, a later `#` a heading, `##` a bold upper-case heading, a blank line splits paragraphs; `**bold**` and `*italic*` touch their words and don't nest. Anything else prints as typed. Columns are `clamp(floor(inner width / 90 mm), 2, 4)`, each filled to the bottom before the next, onto more pages with their own numbers. Body 2.8, 3.3 or 3.9 mm by `size`; title 8 mm, at most 3 lines. No scale bar or north. A new one is "Project report".

Titles: a plan's is `drawingTitle` ("Day", "Day · Loft"), a compare's lists its panes ("Day, Night and Guests"), a duplicate's "<title> copy". A title still naming its drawing follows a change of drawing; a typed one stays.

## The title block column

`packages/editor/src/export/column.ts`: on plan, compare, report and section pages, two stacks of blocks measured in Helvetica (`helveticaWidth`, `wrapText`), cut with "…" so nothing leaves the column.

```
 +------------------+
 | logo (<= 10 mm)  |  top, down
 | studio letterhead|
 | Project name     |  5.5 mm, 2 lines
 | Subtitle         |
 | FIELD  value     |  each set field, 2 lines
 | NOTES  text      |  8 or 2 lines
 | rooms table      |
 |                  |
 | Sheet 02 / 05    |  foot, up
 | A4         date  |
 | disclaimer       |
 | scale bar  north |
 +------------------+
```

- Letterhead: studio name in the accent, address, contact; nothing when unset. An empty project name prints "Untitled".
- The disclaimer is "Dimensions are approximate; check on site."
- The scale bar is the longest of 20, 10, 5, 2, 1 and 0.5 m that fits. No bar on a report; no north on a report, a section sheet or with north unset. The arrow turns north's degrees clockwise from up.
- "Sheet NN / NN" in the accent prints when the PDF has two or more pages.

**Too full.** `COLUMN_FITS`: notes at 8 lines with the rooms table, then at 2, then no rooms table; the first that fits every column page is used. Without the table a note says "Title block too full for A4; try A3", naming each paper that holds it all, or "for any paper". The PDF still saves.

## The rooms table

`roomsTable(doc, layout)` (`packages/editor/src/export/rooms-table.ts`): one row per labelled room by name, with a detail line (a rectangle's clear size, "4.20 × 3.10 m", and the floor's motif), its clear area, and free floor in the layout for a furnished room. Named areas follow their room, indented, with m² and no free floor; an unnamed room holding areas gets "Unnamed room". The total sums the rooms only. A plan uses its drawing's layout; a report has none, so no Free column (it prints only when a row has a figure). Compare, cover and section pages carry no table. Properties shows the same table with nothing selected.

## Project fields and the logo

`packages/domain/src/project-fields.ts`: rows of `projectFields`, `{ id, value }` keyed by the field. `setProjectField { key, value }` sets one, "" removes it; each depends only on its row.

| List | Keys |
|---|---|
| `PROJECT_FIELDS`, printed in this order | `subtitle`, `address`, `client`, `number`, `phase`, `revision`, `revisionDate`, `author`, `notes` |
| `STUDIO_FIELDS` | `issueDate` (blank: today), `studioName`, `studioAddress`, `studioContact` |
| `SET_FIELDS`, never printed as text | `paper`, `generalScale` (unset: Fit), `north` (unset: no arrow), `accent` (unset: brick), the studio fields, and [surroundings.md](surroundings.md)'s settings |

Values are plain text up to 80 characters; `notes` up to 500 and alone in taking line breaks. Refusals name the field: "Client is longer than 80 characters", "Address must be one line", "Unknown project field <key>". Checks: paper A4, A3, A2, A1 or Letter; scale one of the six; north whole degrees 0 to 359; accent lowercase `#rrggbb`. Swatches: Brick red, Blue `#1d4ed8`, Teal `#0f766e`, Black `#1d1d1f`.

The logo is the singleton table `logos`, `{ id: "logo", data, width, height }` (invariant I24): base64 JPEG checked by its first bytes, at most 200,000 characters, 1 to 600 whole pixels a side. `setLogo`, `removeLogo`. The web imports it with the picture importer. It prints in each column's box and on the cover, keeping its shape and white background, and never reaches an MCP reply or the view model.

## The sheets view

Export opens it full screen over an `inert` workspace: a top bar (Close, undo, redo, paper, general scale, status chip, screen zoom, PNG · SVG, Save PDF); the list on the left (320 px: add by kind, All and None, rows with a checkbox and a thumbnail, reordered by drag or Alt + arrows); the real pages in the centre, drawn only on screen; the selected sheet's settings on the right (288 px), then the set's north dial and accent.

- Keys go to `sheetsViewKey` (`packages/editor/src/keys.ts`): only Cmd or Ctrl + Z (Shift: redo) and Escape, which leaves. Saving keeps the view open.
- Each stored change is one undo step; a frame or dial drag draws live and commits on release. The selection is per viewer.
- A report's draft lives in the editor, sent on leaving the box, kept on a refusal and when over 20,000 characters.
- Characters outside Windows-1252 warn ("Some names use characters the PDF can't show").

## Writers and checking a PDF

`@fm/export` (`packages/export/src/`) is pure and DOM-free; only shells import it. `toPdf(pages)` writes uncompressed PDF 1.4: built-in Helvetica regular, bold and oblique, not embedded; Windows-1252 text, other characters as "?"; clips; JPEGs passed through as `/DCTDecode`. `toSvg(primitives, frame)` frames metres at `zoom` on white. The charset (`toWinAnsi`, `unsupportedChars`) and Helvetica widths live in the editor's `export/`.

To check a PDF: unit tests read bytes with `packages/export/test/pdf-reader.ts`; `packages/web/e2e/sheets.spec.ts` reads a saved file with poppler's `pdfinfo` and `pdftotext`, and `section-sheet.spec.ts` renders one with `pdftoppm`. By hand: `qpdf --check` and a real viewer, as seams and bold or oblique type show only in a render.

## Limits

- No DXF, imperial units or other plan styles; no export from MCP or the server (`look` is a picture for Claude).
- PNG and SVG: the plan only, fixed size, the whole drawing.

## At levels

- PNG and SVG draw the viewed level, framed as the floor is, so a loft image keeps a blank margin ([levels.md](levels.md)).
- Each plan on a PDF sheet names its own level by its deck and draws through `paperView(layout, level)`; the viewed level never changes the PDF. A loft sheet centres on the floor's drawing.
- The automatic list prints a loft for a layout only with pieces of its own there; a compare can mix levels, a cover can show a loft.
- Rooms, the rooms table and free floor are floor only ([levels.md](levels.md)): a loft sheet's table lists its layout's floor rooms.
- Labels and dimensions count toward fit only at the floor, where they draw.
