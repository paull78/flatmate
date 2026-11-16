import { COLORS } from "../view/colors";
import { mixColour } from "../view/finish/geometry";

/**
 * A finished wall side's or roof's shades (surfaces step 03): its true colour where lit, as a floor shows its own, and
 * shaded at the same ratio as the slots' (about 0.87 of lit); `top` is unused on a side.
 */
export function finishShades(colour: string): Shades {
  return { top: colour, lit: colour, shaded: mixColour(colour, 0.87, 100) };
}

// The 3D view's one shading rule (heights.06): flat colour per face, a lit and a shaded side by the face's direction
// to a fixed light from the north-west, and a top of its own (lighter for pieces and decks, darker for walls); the
// selection in the selection blue. Constant, so memoised
// pictures keep their arrays.

export type Shades = { top: string; lit: string; shaded: string };
/** A furniture part's material (parts.05): each slot is three shades under the one light. */
export type Slot = "wood" | "dark" | "fabric" | "linen" | "laminate" | "metal" | "ceramic" | "plain" | "flame";
export const SLOTS: readonly Slot[] = ["wood", "dark", "fabric", "linen", "laminate", "metal", "ceramic", "plain", "flame"];
/** `stair` is the stairs' shades (they keep today's grey-white); furniture takes `slots`. */
export type Style3d = { floor: string; patternLift: number; wall: Shades; roof: Shades; stair: Shades; slots: Readonly<Record<Slot, Shades>>; deck: Shades; selected: Shades; joinery: Shades; glass: string; fabric: Shades; rod: Shades; sheer: Shades; leaf: Shades; edge: string; edgePx: number; background: string };

/** Today's grey-white, kept by the stairs and the custom boxes (`plain`). */
const GREY_WHITE: Shades = { top: "#f4f3f0", lit: "#d9d7d1", shaded: "#bdbbb5" };

export const STYLE_3D: Style3d = {
  floor: "#eceae4",
  patternLift: 0.001, // a floor pattern's shapes and lines sit 1 mm above its floor face, so they never tie it (shown.06)
  wall: { top: "#4a4a4a", lit: "#b9b7b1", shaded: "#8f8d88" },
  roof: { top: "#6e6a66", lit: "#625e5b", shaded: "#55524f" }, // a slate grey, darker than the walls' sides (roofs.13)
  stair: GREY_WHITE,
  // Palette A, "Scandi", picked on the palette sheet (parts step 05, parts.24). Lit and shaded are about 0.89 and 0.775 of the top.
  slots: {
    wood: { top: "#d6b88f", lit: "#bea47f", shaded: "#a68f6f" },
    dark: { top: "#4d4945", lit: "#45413d", shaded: "#3c3935" },
    fabric: { top: "#9db09a", lit: "#8c9d89", shaded: "#7a8877" },
    linen: { top: "#f3e7d3", lit: "#d8cebc", shaded: "#bcb3a4" },
    laminate: { top: "#f8f7f3", lit: "#dddcd8", shaded: "#c0bfbc" },
    metal: { top: "#bcc1c6", lit: "#a7acb0", shaded: "#929699" },
    ceramic: { top: "#f5f5f2", lit: "#dadad7", shaded: "#bebebc" },
    plain: GREY_WHITE, // the custom boxes keep today's grey-white
    flame: { top: "#f2a33a", lit: "#e8892a", shaded: "#cf7622" }, // an electric fireplace's flame tongues (pieces.20)
  },
  deck: { top: "#c49a6c", lit: "#ae8960", shaded: "#98774f" }, // a mid oak, so a platform reads as built-in, not floor (studio.04)
  selected: { top: COLORS.objectSelected, lit: "#9fb8ec", shaded: COLORS.wallSelected },
  joinery: { top: "#fbfaf7", lit: "#f0efec", shaded: "#dcdbd7" }, // frames and door leaves: lighter than `laminate`, whose shaded side nearly matches a lit wall (openings3d.13)
  // A curtain: a muted terracotta, at least 30 off the walls, joinery and glass (openkinds.04); its folds take lit and
  // shaded in turn (openkinds.33), and the top keeps the slots' proportions.
  fabric: { top: "#e2a178", lit: "#c98f6b", shaded: "#af7c5d" },
  rod: { top: "#8a8580", lit: "#77736e", shaded: "#66625e" }, // a curtain rod: a mid grey, lighter than `dark` and at least 30 off the wall's sides (openkinds.35)
  leaf: { top: "#8cc06a", lit: "#73a656", shaded: "#5a8a44" }, // a plant's leaves: a fresh green, at least 30 off the walls, the floor and the sage slot (hangings, the user's review)
  sheer: { top: "#f6ecca", lit: "#ecdfb8", shaded: "#dccb9a" }, // a window's sheer curtain: a pale cream, at least 30 off the walls, joinery and glass (hangings.05)
  glass: "#a9cdea", // a window's pane, deeper than the plan's tint so it stands out from its white frame (openings3d.07)
  edge: "#6f6d68",
  edgePx: 0.75,
  background: "#ffffff",
};
