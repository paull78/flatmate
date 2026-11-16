import { holeView, type Command } from "@fm/domain";
import { NO_DRAWING } from "./session";
import { allCreatedIn, fail, type ToolKit } from "./tool-kit";
import { guardPatch } from "./shell-tools";
import type { DrawingTools } from "./tool-types";

// Holes in decks (stairwell.10, .14, .20): add_hole is one addDeckHole, its centre in plan coordinates, its id read
// from the patch; set_hole is one setDeckHole, fields left out keeping the hole's. Both run the domain's commands, as
// the Hole tool does, so every refusal is the domain's text; holes are found through deckViews, never the table.

type HoleTools = Pick<DrawingTools, "addHole" | "setHole">;

export function holeTools({ session, edit }: ToolKit): HoleTools {
  return {
    async addHole({ deck, centre, width, depth, guard }) {
      const command: Command = { type: "addDeckHole", opId: session.newId(), deck, at: centre, w: width, d: depth, ...(guard === undefined ? {} : { guard: guardPatch(guard) }) };
      return edit(command, () => centre, (patch) => {
        const [hole] = allCreatedIn(patch, "deckHoles");
        return hole === undefined ? {} : { hole };
      });
    },
    async setHole({ hole, centre, width, depth, guard }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (holeView(doc, hole) === null) return fail(`No hole has the id ${hole}`);
      const command: Command = {
        type: "setDeckHole",
        holeId: hole,
        ...(centre === undefined ? {} : { at: centre }),
        ...(width === undefined ? {} : { w: width }),
        ...(depth === undefined ? {} : { d: depth }),
        ...(guard === undefined ? {} : { guard: guardPatch(guard) }),
      };
      return edit(command, () => {
        const after = session.drawing();
        return (after && holeView(after, hole)?.hole.at) ?? null;
      }, () => ({ hole }));
    },
  };
}
