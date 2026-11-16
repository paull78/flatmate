import { deckView, type Command } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { NO_DRAWING } from "./session";
import { allCreatedIn, centreOf, createdIn, fail, noDeck, noLayout, placementIn, stateRef, type EditResult, type ToolKit } from "./tool-kit";
import type { DrawingTools } from "./tool-types";

// add_stair (stairdraw.16, .20): the gesture's domain command, placeStair, standing on the floor. The domain owns which
// edges catch, the stair's pose and size, and every refusal; this tool checks only that the ids name a layout and
// a deck, and words nothing itself; a handrail left out is the domain's to pick (guards.28). The new ids come from the patch (dims.38): an L's patch holds its landing deck,
// then the upper flight and the lower (stairdraw.34).

type StairTools = Pick<DrawingTools, "addStair">;

export function stairTools({ session, edit }: ToolKit): StairTools {
  return {
    async addStair({ layout: state, kind, deck, at, shape = "straight", handrail }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const ref = stateRef(doc, state);
      if (ref === null) return fail(noLayout(state));
      if (deckView(doc, deck) === null) return fail(noDeck(deck));
      const command: Command = { type: "placeStair", opId: session.newId(), state, kind, deck, at, shape, surface: null, ...(handrail === undefined ? {} : { handrail }) };
      /** Claude's cursor after the edit: an L's landing, else the flight, in `state`. */
      const near = (landing: string | undefined, flight: string | undefined): Point | null => {
        const now = session.drawing();
        if (now === null) return null;
        const deckNow = landing === undefined ? null : deckView(now, landing);
        if (deckNow !== null) return deckNow.at;
        const found = flight === undefined ? null : placementIn(now, state, flight);
        return found?.ok ? centreOf(now, found.value.placement.id) : null;
      };
      return edit(command, (patch) => near(createdIn(patch, "decks"), createdIn(patch, "objects")), (patch): EditResult => {
        const objects = allCreatedIn(patch, "objects");
        const [object] = objects;
        if (object === undefined) return { layout: ref };
        const landing = createdIn(patch, "decks");
        return landing === undefined ? { object, layout: ref } : { object, objects, deck: landing, layout: ref };
      });
    },
  };
}
