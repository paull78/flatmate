import { BASIC } from "./basic";
import { BATHROOM } from "./bathroom";
import { CORNERS } from "./corners";
import { KITCHEN } from "./kitchen";
import { SETS } from "./sets";
import { SIT_AND_EAT } from "./sit-and-eat";
import { SLEEP } from "./sleep";
import { STORAGE } from "./storage";
import { HUNG } from "./hung";
import { boxOf, type Appearance, type AppearanceTable } from "./types";

// Every live furniture kind's look in 3D, in one table (parts.09): real parts, or `boxOf(slot)`. Stairs draw their own
// bodies (stairs.39); retired kinds and unknown ones fall back to a plain box.

export const APPEARANCE: AppearanceTable = new Map([...SLEEP, ...SIT_AND_EAT, ...SETS, ...CORNERS, ...KITCHEN, ...BATHROOM, ...STORAGE, ...BASIC, ...HUNG]);

const PLAIN = boxOf("plain");

/** A kind's appearance, or a plain box for a kind without one. */
export const appearanceOf = (kind: string): Appearance => APPEARANCE.get(kind) ?? PLAIN;
