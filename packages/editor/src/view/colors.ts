// One palette for every renderer. Light theme.
// Hex only, lowercase #rrggbb or #rrggbbaa (COLOR_PATTERN, render.12): renderers and tests compare these values, and
// colorChannels below is the one function that reads them.
// Keep background equal to --fm-bg in packages/web/src/styles.css.
export const COLORS = {
  background: "#f4f4f2", // light warm grey canvas
  grid: "#e7e7e3",
  gridMajor: "#d8d8d3",
  wall: "#8a8c93", // mid-grey cut walls, so thin dark detail reads against them (smalls.10)
  ink: "#1d1d1f", // what's drawn on them: doors and windows
  wallSelected: "#2563eb", // blue selection
  sectionMark: "#c2410c", // a section's marks: annotation, so not the walls' near-black
  sectionBand: "#2563eb1f", // what a selected section sees: the selection's blue, faint, so the plan reads through it
  wallHover: "#4b4b50",
  preview: "#2563eb99", // translucent blue preview
  invalid: "#e5484d", // red invalid preview and ghost
  invalidFill: "#e5484d88", // a refused object place, or furniture a drag would strand
  refusalText: "#b91c1c", // the plate's words: a darker red than `invalid`, to read as text (clarity.02)
  warningLine: "#92400e", // a warned zone's outline and its mark's ring, a note plate's border (clarity.02)
  warningMark: "#f59e0b", // a warned zone's "!" disc: the amber at full strength
  warningGlyph: "#111111", // the "!" on it
  handle: "#ffffff",
  handleFixed: "#2563eb",
  snap: "#d97706",
  snapGuide: "#d9770680", // translucent snap orange: the line an aligned point lines up along
  zoneFill: "#dce8f7aa", // soft blue floor
  zoneFillSelected: "#b9d0f2cc",
  zoneHint: "#2563eb1f", // faint unlabelled-room hint while Z is active
  zoneFinishTint: "#2563eb59", // the selection blue at 35 %: a finished room the Zone tool hovers, over its floor (finishes.03, .47)
  text: "#1d1d1f",
  textMuted: "#6b6b6b", // same grey as DEFAULT_ME_COLOR in state.ts
  field: "#ffffff", // a value being typed (the helper while editing)
  fieldSelection: "#2563eb33", // light selection blue: the value typing will replace
  boxFill: "#2563eb14", // faint selection blue: the Select tool's box (direct.07)
  object: "#e0e0de", // furniture footprint: light grey, visible on the canvas and the room fill (smart.32, brightened on request)
  objectEdge: "#2a2c2f", // furniture outline and front edge: near-black grey
  objectDetail: "#8f9296", // furniture lines inside the outline: a lighter grey
  objectSelected: "#c7d7f5",
  // Over finishes (seating.02): a picture showing finishes in a document holding one draws every piece white, the mockup's look.
  rug: "#ecebe6", // a rug's fill, in both looks: lighter than the grey pieces, and off the white ones, so a piece on it reads (catalog.15)
  objectOnFinish: "#ffffff", // opaque white, so the floor's pattern never shows through a piece
  objectEdgeOnFinish: "#5d6166", // its thin outline: a mid grey
  objectDetailOnFinish: "#9a9ea3", // its inner lines: a lighter grey
  deck: "#ebe4d8", // a deck below the cut: a light warm grey, apart from the blue room floors and the furniture grey (decks.07)
  deckEdge: "#5c5347", // its outline: a warm dark grey
  belowLevel: "#bcbcb6", // a wall or deck under the viewed upper level: a light grey hairline (levels.04)
  ghostFill: "#e0e0decc", // the Object tool's ghost: the furniture fill, see-through (more opaque, so it stays 16 from the canvas)
  ghostFillOnFinish: "#ffffffcc", // the ghost over finishes: white at the grey ghost's alpha (seating.02)
  ghostEdge: "#2a2c2faa",
  warning: "#f59e0b55", // translucent amber: a use zone or door swing that something blocks
  zoneOutline: "#2563eb80", // a selected piece's use zones: a faint dashed selection blue (smart.09)
  chip: "#1d4ed8", // an active zone's "×" chip: a blue disc (smart.24)
  chipOff: "#b6babf", // an inactive side's "+" chip: its ring and glyph, light grey, on a white disc (furnish.09)
  chipOffHover: "#5f6368", // the same "+" ring and glyph while the pointer is over the chip
  chipGlyph: "#ffffff", // the "×" on its blue disc
  openingFloor: "#e4ecf5", // a door's gap: zoneFill over background, opaque, so the wall under it is hidden
  windowTint: "#d6e6f5", // a window's pane in 3D
  windowGlass: "#5b93c7", // a window's glass line on the canvas
  helper: "#0f766e", // teal: distinct from the selection blue, so helper text is easy to tell apart (and to filter in tests)
} as const;

/** The hard constraint on every colour the editor draws (render.12): lowercase `#rrggbb` or `#rrggbbaa`. */
export const COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

/** A colour the constraint refuses: drawn loudly instead of throwing inside a frame. */
const BAD_COLOR: readonly [number, number, number, number] = [1, 0, 1, 1];

/**
 * A colour as straight (not premultiplied) RGBA in 0..1, each channel `byte / 255` (the SVG writer's opacities round
 * the same way). The one colour parser: WebGL's records, the SVG and PDF writers and the 3D triangles read through it.
 */
export function colorChannels(color: string): [number, number, number, number] {
  if (!COLOR_PATTERN.test(color)) return [...BAD_COLOR];
  const byte = (i: number): number => parseInt(color.slice(i, i + 2), 16) / 255;
  return [byte(1), byte(3), byte(5), color.length === 9 ? byte(7) : 1];
}
