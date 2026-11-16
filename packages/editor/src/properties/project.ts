import { PROJECT_FIELDS, STUDIO_FIELDS, projectFieldOf, sheetsOf } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import { reportFirstLine } from "../export/report-text";
import type { EditorState } from "../state";
import type { Field } from "../view/view-model-types";
import { field, type FieldCommand } from "./fields";

// The Project section (sheet.04, sheetset.18): the document's title block fields, then the studio's and the date of issue, shown with nothing selected, above Rooms. Like
// the entity modules, it holds the fields and the command each one sends side by side. Field ids are "project.<key>".

const PREFIX = "project.";

export function projectFields(state: EditorState): Field[] | null {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  const doc = visibleDoc(d);
  // Editable even while an edit awaits its answer: the panel holds the keys then. Marking them read-only here swaps the box for
  // another control, which throws away the focus Tab just gave it (sheetset.68).
  const fields = [...PROJECT_FIELDS, ...STUDIO_FIELDS].map((f): Field => {
    const out = field("Project", PREFIX + f.key, f.label, doc.projectFields[f.key]?.value ?? "", null, false);
    return { ...out, ...(f.multiline ? { multiline: true } : {}), ...(f.blank !== undefined ? { placeholder: f.blank } : {}) };
  });
  const report = sheetsOf(doc).find((s) => s.kind === "report");
  return report ? [...fields, { ...field("Project", `${PREFIX}report`, "Report", reportFirstLine(report.text), null), sheet: report.id }] : fields;
}

/** The command for a committed Project field, or null for an id that is not one. */
export function projectFieldCommand(fieldId: string, value: string): FieldCommand {
  if (!fieldId.startsWith(PREFIX)) return null;
  const f = projectFieldOf(fieldId.slice(PREFIX.length));
  return f ? { type: "setProjectField", key: f.key, value } : null;
}
