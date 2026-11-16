import { columnOf, type Command } from "@fm/domain";
import { NO_DRAWING } from "./session";
import { allCreatedIn, fail, type ToolKit } from "./tool-kit";
import type { DrawingTools } from "./tool-types";

// Columns (pillars.15, .19, .48): add_column is one placeColumn, `on` its base and `top` its top, its ID the column row
// among the walls the patch puts (in a wall's line it also puts the split wall and its new half); set_column is one
// setColumn, fields left out keeping the column's. Both run the domain's commands, as the Column tool does, so every refusal is the domain's text.

type ColumnTools = Pick<DrawingTools, "addColumn" | "setColumn">;

const noColumn = (id: string): string => `No column has the id ${id}`;

export function columnTools({ session, edit }: ToolKit): ColumnTools {
  return {
    async addColumn({ centre, width, depth, rotation, on, top }) {
      const command: Command = {
        type: "placeColumn",
        opId: session.newId(),
        at: centre,
        width,
        depth,
        ...(rotation === undefined ? {} : { rotation }),
        ...(on === undefined ? {} : { base: on }),
        ...(top === undefined ? {} : { top }),
      };
      return edit(command, () => centre, (patch) => {
        const after = session.drawing();
        const id = allCreatedIn(patch, "walls").find((w) => after?.walls[w]?.column === true);
        return id === undefined ? {} : { column: id };
      });
    },
    async setColumn({ column, centre, width, depth, rotation, top }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (!Object.hasOwn(doc.walls, column)) return fail(noColumn(column));
      const command: Command = {
        type: "setColumn",
        wallId: column,
        ...(centre === undefined ? {} : { at: centre }),
        ...(width === undefined ? {} : { width }),
        ...(depth === undefined ? {} : { depth }),
        ...(rotation === undefined ? {} : { rotation }),
        ...(top === undefined ? {} : { top }),
      };
      return edit(command, () => {
        const after = session.drawing();
        return (after && columnOf(after, column)?.centre) ?? null;
      }, () => ({ column }));
    },
  };
}
