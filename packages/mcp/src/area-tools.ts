import type { Command } from "@fm/domain";
import { NO_DRAWING } from "./session";
import { allCreatedIn, fail, type ToolKit } from "./tool-kit";
import type { DrawingTools } from "./tool-types";

// Named areas (areas.13): add_area is one addArea, its centre in plan coordinates, its id read from the patch; set_area
// is one setArea, fields left out keeping the area's. Both run the domain's commands, as the Zone tool does, so every
// refusal is the domain's text ("Overlaps Kitchen", "Draw an area inside a room").

type AreaTools = Pick<DrawingTools, "addArea" | "setArea">;

export function areaTools({ session, edit }: ToolKit): AreaTools {
  return {
    async addArea({ name, centre, width, depth }) {
      const command: Command = { type: "addArea", opId: session.newId(), at: centre, w: width, d: depth, ...(name === undefined ? {} : { name }) };
      return edit(command, () => centre, (patch) => {
        const [area] = allCreatedIn(patch, "areas");
        return area === undefined ? {} : { area };
      });
    },
    async setArea({ area, name, centre, width, depth }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (!Object.hasOwn(doc.areas, area)) return fail(`No named area has the id ${area}`);
      const command: Command = {
        type: "setArea",
        areaId: area,
        ...(name === undefined ? {} : { name }),
        ...(centre === undefined ? {} : { at: centre }),
        ...(width === undefined ? {} : { w: width }),
        ...(depth === undefined ? {} : { d: depth }),
      };
      return edit(command, () => session.drawing()?.areas[area]?.at ?? null, () => ({ area }));
    },
  };
}
