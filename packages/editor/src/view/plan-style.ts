import { isRug, sheetSetAccent, type Document } from "@fm/domain";
import { COLORS } from "./colors";
import { TAG_SIZE } from "./fonts";
import { memoLast } from "./memo";
import type { Color, Dash, Font } from "./scene-types";

/**
 * How the document layers draw a plan (export.11): colours, and sizes in drawing units, which are screen pixels on
 * the canvas and paper millimetres in an export (the picture's zoom is then millimetres per metre). Each is a constant,
 * or memoised as `presentationStyle` is, so memoised layers keep their arrays.
 */
export type PlanStyle = {
  font: Font; // every text the style draws (render.15): Inter on the canvas and in look, Helvetica on paper
  wall: Color;
  wallEdge: number; // the outline segments drawn over each wall fill (WebGL antialiasing, spec: rendering)
  objectFill: Color;
  kindFill?: (kind: string) => Color | null; // a card's plan colours each kind (cards.01); null, or none: the fills below
  rugFill: Color; // a rug's fill, in every look (catalog.15): opaque, so the floor's pattern never shows through
  objectLine: Color;
  objectLineWidth: number; // the plan symbol's outline
  objectDetail: Color; // the plan symbol's lines inside the outline
  objectDetailWidth: number;
  objectFront: number; // the heavier front edge
  objectGhost: Color; // the Object tool's ghost and a duplicate's: the fill, see-through (canvas only)
  objectName: number; // a selected object's name (canvas only: exports select nothing)
  stairLabel: number; // a stair's "UP · 10 R 0.215 / 0.221" (stairs.02)
  stairDot: number; // the radius of the dot that starts a stair's walking line
  openingFloor: Color; // a door's span showing a labelled room without a finish, opaque over the wall (thresholds.06)
  spanBackground: Color; // a door's span showing an unlabelled room: the picture's background
  openingGlass: Color; // a window's glass line
  openingLine: Color; // leaves, frames, swings and a window's low-wall lines
  // Line weights in order: frame and leaf, then low wall and glass, then the arc and threshold (reports/Drawing doors and windows.md).
  openingWeights: { frame: number; line: number; hair: number };
  openingDetailFrom: number; // draw frames when a frame is this wide in the picture's units; Infinity: never
  // line: between line centres; plate: the box behind a tag, or none (on paper it would hide the furniture under it)
  tag: { size: number; line: number; pad: number; plate: Color | null; text: Color; muted: Color }; // size: the text, in the style's font
  accent: Color; // the annotation ink (sheet.11): room tags and the sheet number on paper; unused on the canvas
  // Placed dimensions (dims.09, dims.19): line and tick widths; tick length; the extension lines' gap from the measured
  // point and overshoot past the line; the value's size and its gap above the line; ink, and the selected colour.
  dim: { line: number; tick: number; tickWidth: number; gap: number; overshoot: number; textSize: number; textGap: number; ink: Color; selected: Color };
  // The cut (heights.15): a piece wholly above it is a dashed outline (dash and gap, then the line's width); a wall
  // ending at or below it is a thin unfilled outline.
  aboveDash: Dash;
  aboveWidth: number;
  projectionWidth: number;
  // Decks (decks.07): the fill below the cut; the outline's ink and width, the outline's width when the deck crosses
  // the cut, and the dash above it; the "Loft +2.15" label, sized like a room tag's second line.
  deck: { tint: Color; line: { color: Color; width: number }; cutLine: number; dash: Dash; label: { size: number; color: Color } };
  // The roof (roofs.11, .37), overhead at every level: its edge's and ridge's ink, width and dash, a long dash apart from
  // `aboveDash` and the decks', and the size of the pitch's text and of "Ridge".
  roof: { ink: Color; line: number; dash: Dash; textSize: number };
  // A deck's guards (spec "Guards"): a Railing's ink, the line's width, and its posts' radius.
  guard: { ink: Color; line: number; post: number };
  // At an upper level (levels.04): a wall or deck whose top is at or below the level, an unfilled hairline outline.
  ghost: { line: Color; width: number };
  // A section's marks (section.15): the thin line and its dash, one dash-and-gap pair as Dash allows; each thick end's length
  // and width; the arrow's stem and width, its head's length and half width; the letter, centred `textGap` past the end.
  mark: { ink: Color; selected: Color; line: number; dash: Dash; end: number; thick: number; stem: number; stemWidth: number; head: number; headHalf: number; textSize: number; textGap: number };
  // A section's picture: the cut's fill; cut furniture's fill and outline; a cut window's pane and outline. Past the cut:
  // the fill; a wall's outline, a piece's or deck's, a panel's; the fills of a door and of a window. Heights at the
  // side: a line `heightLength` long, `heightGap` past the end of the cut, its value `heightTextGap` past that, in the
  // value's size and ink. The title, `titleGap` above the ceiling's band.
  section: { cut: Color; furniture: Color; furnitureLine: Color; furnitureWidth: number; pane: Color; paneLine: Color; paneWidth: number; beyond: Color; beyondWall: Color; beyondWallWidth: number; beyondPart: Color; beyondPartWidth: number; beyondPanel: Color; beyondPanelWidth: number; door: Color; glass: Color; heightLine: Color; heightWidth: number; heightGap: number; heightLength: number; heightTextGap: number; heightSize: number; heightText: Color; titleSize: number; titleGap: number; titleColor: Color };
  // Floor finishes (finishes.05, .16): the pattern's hairline, and the finest line spacing drawn; null draws none (look).
  finish: { line: number; minSpacing: number } | null;
};

/** A piece's own fill in a style: a rug's lighter one (catalog.15), any other kind's the pieces' fill. */
export const pieceFill = (style: PlanStyle, kind: string): Color => style.kindFill?.(kind) ?? (isRug(kind) ? style.rugFill : style.objectFill);

/** A section's colours, the same on screen, on paper and for Claude. */
const SECTION_INKS = { cut: "#2a2a2a", furniture: "#d4d4d0", furnitureLine: "#555555", pane: "#cfe3ee", paneLine: "#7a9aac", beyond: "#ffffff", beyondWall: "#777777", beyondPart: "#8b8b88", beyondPanel: "#a8a8a4", door: "#fafaf8", glass: "#e8f1f6", heightLine: "#444444", heightText: "#333333", titleColor: "#222222" };

/** The canvas, as drawn before export existed: sizes in screen pixels. */
export const CANVAS_STYLE: PlanStyle = {
  font: "inter",
  wall: COLORS.wall,
  wallEdge: 1,
  objectFill: COLORS.object,
  rugFill: COLORS.rug,
  objectLine: COLORS.objectEdge,
  objectLineWidth: 1,
  objectDetail: COLORS.objectDetail,
  objectDetailWidth: 0.75,
  objectFront: 1.6,
  objectGhost: COLORS.ghostFill,
  objectName: 11,
  stairLabel: 11,
  stairDot: 3.5,
  openingFloor: COLORS.openingFloor,
  spanBackground: COLORS.background,
  openingGlass: COLORS.windowGlass,
  openingLine: COLORS.ink,
  openingWeights: { frame: 1.25, line: 1, hair: 0.75 },
  openingDetailFrom: 4, // about 67 px per metre (smalls.14)
  tag: { size: TAG_SIZE, line: 16, pad: 4, plate: COLORS.background, text: COLORS.text, muted: COLORS.textMuted },
  accent: COLORS.text, // the canvas keeps its tag colours
  dim: { line: 1, tick: 8, tickWidth: 1.5, gap: 3, overshoot: 6, textSize: 11, textGap: 3, ink: COLORS.text, selected: COLORS.wallSelected },
  aboveDash: [6, 4],
  aboveWidth: 1.25,
  projectionWidth: 1.25,
  guard: { ink: COLORS.ink, line: 1.25, post: 2 },
  roof: { ink: COLORS.deckEdge, line: 1, dash: [16, 4], textSize: 11 },
  deck: { tint: COLORS.deck, line: { color: COLORS.deckEdge, width: 1 }, cutLine: 2, dash: [6, 4], label: { size: TAG_SIZE, color: COLORS.textMuted } },
  ghost: { line: COLORS.belowLevel, width: 1 },
  mark: { ink: COLORS.sectionMark, selected: COLORS.wallSelected, line: 1, dash: [10, 4], end: 14, thick: 3, stem: 14, stemWidth: 1.25, head: 8, headHalf: 4.5, textSize: 14, textGap: 10 },
  section: { ...SECTION_INKS, furnitureWidth: 1, paneWidth: 0.8, beyondWallWidth: 1.1, beyondPartWidth: 0.9, beyondPanelWidth: 0.7, heightWidth: 1, heightGap: 6, heightLength: 20, heightTextGap: 4, heightSize: 11, titleSize: 14, titleGap: 6 },
  finish: { line: 0.75, minSpacing: 4 },
};

const PAPER = "#ffffff";
const INK = "#1a1a1a";
const ACCENT = "#b3261e"; // brick red, picked from the sheet mockup (sheet.16)

/**
 * Exports (export.11, sheet.11): black on white, solid walls, furniture in the canvas's greys (smart AC-13), room tags in
 * the accent; sizes in paper millimetres.
 */
export const PRESENTATION_STYLE: PlanStyle = {
  font: "helvetica",
  wall: INK,
  wallEdge: 0.25, // wide enough to close the seams where mitred wall fills meet
  objectFill: COLORS.object,
  rugFill: COLORS.rug,
  objectLine: COLORS.objectEdge,
  objectLineWidth: 0.18,
  objectDetail: COLORS.objectDetail,
  objectDetailWidth: 0.135, // the canvas's detail-to-outline ratio
  objectFront: 0.35,
  objectGhost: COLORS.ghostFill, // unused: exports draw no ghost
  objectName: 2.5,
  stairLabel: 1.8, // a note, ISO 3098's small size; room names keep 2.5
  stairDot: 0.5,
  openingFloor: PAPER,
  spanBackground: PAPER,
  openingGlass: INK,
  openingLine: INK,
  openingWeights: { frame: 0.25, line: 0.18, hair: 0.13 },
  openingDetailFrom: 1, // a 6 cm frame reaches 1 mm: so 1:50, not 1:100
  tag: { size: 2.5, line: 3.4, pad: 0.8, plate: null, text: ACCENT, muted: ACCENT },
  accent: ACCENT,
  dim: { line: 0.18, tick: 2, tickWidth: 0.35, gap: 1, overshoot: 2, textSize: 2.5, textGap: 1, ink: ACCENT, selected: ACCENT },
  aboveDash: [1.2, 0.8],
  aboveWidth: 0.25,
  projectionWidth: 0.25,
  guard: { ink: INK, line: 0.25, post: 0.4 },
  roof: { ink: INK, line: 0.18, dash: [3.2, 0.8], textSize: 2.2 },
  deck: { tint: "#efe9df", line: { color: INK, width: 0.18 }, cutLine: 0.35, dash: [1.2, 0.8], label: { size: 2.5, color: ACCENT } },
  ghost: { line: "#bdbdbd", width: 0.13 },
  mark: { ink: ACCENT, selected: ACCENT, line: 0.18, dash: [3, 1], end: 3.5, thick: 0.5, stem: 3, stemWidth: 0.25, head: 1.8, headHalf: 1, textSize: 3.5, textGap: 3 },
  section: { ...SECTION_INKS, furnitureWidth: 0.2, paneWidth: 0.15, beyondWallWidth: 0.2, beyondPartWidth: 0.16, beyondPanelWidth: 0.12, heightWidth: 0.18, heightGap: 1, heightLength: 3, heightTextGap: 0.6, heightSize: 2.2, titleSize: 3.5, titleGap: 1 },
  finish: { line: 0.1, minSpacing: 0.8 },
};

const accented = memoLast((accent: Color): PlanStyle => {
  const { tag, dim, deck, mark } = PRESENTATION_STYLE;
  return {
    ...PRESENTATION_STYLE,
    accent,
    tag: { ...tag, text: accent, muted: accent },
    dim: { ...dim, ink: accent, selected: accent },
    deck: { ...deck, label: { ...deck.label, color: accent } },
    mark: { ...mark, ink: accent, selected: accent },
  };
});

/** The presentation style in the set's accent (sheetset.18): the same object while the accent stays, so a picture's layers keep their arrays. */
export function presentationStyle(doc: Document): PlanStyle {
  const accent = sheetSetAccent(doc);
  return accent === null || accent === ACCENT ? PRESENTATION_STYLE : accented(accent);
}

const LOOK_INK = "#e5007d"; // magenta: far from any grey, so it reads over the grey underlay
const LOOK_TEXT = 14; // look pixels

/**
 * Claude's look picture (import.12): walls, openings, room names and dimension lines in one strong ink over the grey
 * underlay; sizes in look pixels (the picture's zoom is look pixels per metre). Walls are opaque, so a misplaced wall
 * shows the picture's own wall beside it; spans are white, which hides nothing since they lie inside the opaque wall.
 * Rejected: translucent walls (mitred fills and edge outlines overlap, doubling the alpha at every seam).
 */
export const LOOK_STYLE: PlanStyle = {
  font: "inter",
  wall: LOOK_INK,
  wallEdge: 1,
  objectFill: `${LOOK_INK}26`, // the object fields draw only stairs (AC-13), never furniture (import.07); faint, so treads and underlay show
  rugFill: `${LOOK_INK}26`, // unused: look draws no furniture
  objectLine: LOOK_INK,
  objectLineWidth: 1,
  objectDetail: LOOK_INK,
  objectDetailWidth: 1,
  objectFront: 1.5,
  objectGhost: `${LOOK_INK}26`, // unused: look draws no ghost
  objectName: 12,
  stairLabel: 12,
  stairDot: 3.5,
  openingFloor: PAPER,
  spanBackground: PAPER,
  openingGlass: LOOK_INK,
  openingLine: LOOK_INK,
  openingWeights: { frame: 1.5, line: 1.5, hair: 1.5 },
  openingDetailFrom: Infinity,
  tag: { size: LOOK_TEXT, line: 18, pad: 4, plate: null, text: LOOK_INK, muted: LOOK_INK },
  accent: LOOK_INK,
  dim: { line: 1, tick: 8, tickWidth: 1.5, gap: 3, overshoot: 6, textSize: 12, textGap: 3, ink: LOOK_INK, selected: LOOK_INK },
  aboveDash: [6, 4],
  aboveWidth: 1.5,
  projectionWidth: 1.5,
  guard: { ink: LOOK_INK, line: 1.5, post: 2.5 },
  roof: { ink: LOOK_INK, line: 1.5, dash: [16, 4], textSize: LOOK_TEXT },
  // A faint ink fill, so the underlay still shows through a deck.
  deck: { tint: `${LOOK_INK}1a`, line: { color: LOOK_INK, width: 1.5 }, cutLine: 2.5, dash: [6, 4], label: { size: LOOK_TEXT, color: LOOK_INK } },
  ghost: { line: `${LOOK_INK}55`, width: 1 }, // unused: look draws the floor level only (levels.17)
  mark: { ink: LOOK_INK, selected: LOOK_INK, line: 1.5, dash: [10, 4], end: 14, thick: 3.5, stem: 14, stemWidth: 1.5, head: 8, headHalf: 4.5, textSize: LOOK_TEXT, textGap: 10 },
  section: { ...SECTION_INKS, furnitureWidth: 1, paneWidth: 1, beyondWallWidth: 1, beyondPartWidth: 1, beyondPanelWidth: 1, heightWidth: 1, heightGap: 6, heightLength: 20, heightTextGap: 4, heightSize: LOOK_TEXT, titleSize: LOOK_TEXT, titleGap: 6 },
  finish: null, // look traces walls over the underlay, which a floor would hide (finishes.10)
};

// The white look's sizes, in canvas pixels (the mockup's): each scales the style's grey size by its ratio to the canvas's.
const ON_FINISH = { line: 0.9, detail: 0.75, front: 1.4 };
const onFinishStyles = new WeakMap<PlanStyle, PlanStyle>();

/**
 * The style's pieces over finishes (seating.02): an opaque white fill, the mockup's thin grey outline and lighter detail;
 * a rug keeps its fill, off-white under the white pieces.
 * The one owner of the white look. Memoised per style, so the objects layer's memo keeps its array frame to frame.
 */
export function onFinishes(style: PlanStyle): PlanStyle {
  const known = onFinishStyles.get(style);
  if (known) return known;
  const c = CANVAS_STYLE;
  const white: PlanStyle = {
    ...style,
    objectFill: COLORS.objectOnFinish,
    objectLine: COLORS.objectEdgeOnFinish,
    objectLineWidth: style.objectLineWidth * (ON_FINISH.line / c.objectLineWidth),
    objectDetail: COLORS.objectDetailOnFinish,
    objectDetailWidth: style.objectDetailWidth * (ON_FINISH.detail / c.objectDetailWidth),
    objectFront: style.objectFront * (ON_FINISH.front / c.objectFront),
    objectGhost: COLORS.ghostFillOnFinish,
  };
  onFinishStyles.set(style, white);
  return white;
}
