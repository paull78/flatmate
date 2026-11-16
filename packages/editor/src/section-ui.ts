import type { EntityRef } from "@fm/domain";
import { visibleDoc } from "./document/open-document";
import type { UiAction } from "./ports/events";
import { entityExists, pruneSelection, type EditorState } from "./state";

// What a viewer does with sections beyond the document: the frame's letters and close, and the marks' switch (spec "The
// strip", section.46, .52, .59). Never synced, saved or undone.

type SectionUi = Extract<UiAction, { type: "showSection" | "closeSection" | "setSectionMarks" }>;

export function onSectionUi(state: EditorState, action: SectionUi): EditorState {
  switch (action.type) {
    case "showSection":
      return showSection(state, action.section);
    case "closeSection":
      return { ...state, stripSection: null, selection: state.selection.filter((r) => r.table !== "sections") }; // nothing shows it now, and a click opens it again
    case "setSectionMarks":
      return { ...state, sectionMarksOn: action.on };
    default: {
      const never: never = action;
      return never;
    }
  }
}

/**
 * A letter in the section's frame: it switches the picture and, in the Select tool, selects that section as a click on
 * its mark does. Mid-gesture in another tool, only the picture changes.
 */
function showSection(state: EditorState, section: string): EditorState {
  const ref: EntityRef = { table: "sections", id: section };
  const idle = state.tool.name === "select" && state.tool.state.kind === "idle";
  const selects = idle && state.document !== null && entityExists(visibleDoc(state.document), ref);
  return { ...(selects ? pruneSelection({ ...state, selection: [ref] }) : state), stripSection: section };
}
