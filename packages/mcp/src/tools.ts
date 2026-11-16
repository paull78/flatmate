import { columnTools } from "./column-tools";
import { holeTools } from "./hole-tools";
import { areaTools } from "./area-tools";
import { lookTools } from "./look-tools";
import { objectTools } from "./object-tools";
import { openingTools } from "./opening-tools";
import type { EditorSession } from "./session";
import { sectionTools } from "./section-tools";
import { sheetTools } from "./sheet-tools";
import { shellTools } from "./shell-tools";
import { stairTools } from "./stair-tools";
import { createKit } from "./tool-kit";
import type { DrawingTools } from "./tool-types";

export type { DrawingTools, LookReply, Reply } from "./tool-types";

// Tool handlers: validated inputs in (schemas.ts), a short text out. Every editing tool is one domain command through
// the session, except draw_room, add_walls and set_zones (several commands, checked together and submitted in one
// serial slot of the session, so a parallel tool call cannot land between them).
//
// The handlers live in ten groups built on one kit (tool-kit.ts): the building (shell-tools.ts), holes in decks
// (hole-tools.ts), named areas (area-tools.ts), columns (column-tools.ts), furniture (object-tools.ts), a stair on a deck's edge (stair-tools.ts), openings, states and
// dimensions (opening-tools.ts), the picture and underlay (look-tools.ts), sections (section-tools.ts), and the PDF's sheets (sheet-tools.ts).
// Each group is typed as its slice of DrawingTools (tool-types.ts), so the spread below is checked against the whole.

/** Every tool as one turn of the session, so a handler reads the drawing after the calls before it have settled (spec: mcp). */
function inTurns(session: EditorSession, tools: DrawingTools): DrawingTools {
  return new Proxy(tools, {
    get(target, key) {
      const tool: unknown = Reflect.get(target, key);
      return typeof tool === "function" ? (...args: unknown[]) => session.serial(() => Reflect.apply(tool, target, args)) : tool;
    },
  });
}

export function createTools(session: EditorSession): DrawingTools {
  const kit = createKit(session);
  return inTurns(session, { ...shellTools(kit), ...holeTools(kit), ...areaTools(kit), ...columnTools(kit), ...objectTools(kit), ...stairTools(kit), ...openingTools(kit), ...lookTools(kit), ...sectionTools(kit), ...sheetTools(kit) });
}
