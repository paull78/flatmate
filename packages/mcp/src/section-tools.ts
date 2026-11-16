import type { Command } from "@fm/domain";
import { createdIn, middle, type ToolKit } from "./tool-kit";
import type { DrawingTools } from "./tool-types";

// add_section (section.15): one addSection, as the Section tool sends, the letter read from the patch. Left is the domain's
// side 1 (section.16). There's no set_section: delete and re-add, which loses the section's sheets. Every refusal is the domain's text.

type SectionTools = Pick<DrawingTools, "addSection">;

export function sectionTools({ edit }: ToolKit): SectionTools {
  return {
    async addSection({ a, b, side, depth }) {
      const command: Command = { type: "addSection", a, b, side: side === "left" ? 1 : -1, ...(depth === undefined ? {} : { depth }) };
      return edit(command, () => middle(a, b), (patch) => {
        const section = createdIn(patch, "sections");
        return section === undefined ? {} : { section };
      });
    },
  };
}
