// The sample houses people see in the project list (samples.01): each a seed on the kit, in the order they're listed.
import type { Step } from "../seed-kit";
import { studio20ftSteps } from "./studio-20ft";
import { gooseneck30ftSteps } from "./gooseneck-30ft";
import { notchedCottageSteps } from "./notched-cottage";
import { twoLofts28ftSteps } from "./two-lofts-28ft";
import { tokyoLoftSteps } from "./tokyo-loft";

export type Sample = { readonly name: string; readonly prefix: string; readonly steps: () => readonly Step[] };

export const SAMPLES: readonly Sample[] = [
  { name: "20 ft studio", prefix: "studio20", steps: studio20ftSteps },
  { name: "28 ft two lofts", prefix: "lofts28", steps: twoLofts28ftSteps },
  { name: "30 ft gooseneck", prefix: "goose30", steps: gooseneck30ftSteps },
  { name: "Notched cottage", prefix: "cottage", steps: notchedCottageSteps },
  { name: "Tokyo loft", prefix: "tokyo", steps: tokyoLoftSteps },
];
