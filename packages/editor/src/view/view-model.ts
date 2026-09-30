import { WALL_THICKNESS, wallHelperDimension } from "@fm/domain";
import { assertNever, type Point, type ProjectMeta } from "@fm/protocol";
import { canCommit, isDirty, status, visibleDoc } from "../document/open-document";
import type { DocumentStatus } from "../document/types";
import { canRedo, canUndo } from "../history/history";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import type { SnapKind, ToolName } from "../types";
import { areaFieldText, zoneOfLabel } from "./tags";

// What the panels show, not how (spec §5.9).
export type Field = { id: string; label: string; value: string; unit: string | null; readOnly: boolean };

export type ViewModel = {
  activeTool: ToolName;
  commandBar: { prompt: string; value: string; unit: "m" | null };
  properties: { kind: "none" } | { kind: "wall" | "joint" | "zone"; fields: Field[] };
  cursor: "default" | "crosshair" | "move" | "pointer";
  snap: { kind: Exclude<SnapKind, "none">; at: Point } | null;
  presence: { clientId: string; name: string; color: string; at: Point | null }[];
  project: { name: string; status: DocumentStatus; dirty: boolean; canEdit: boolean } | null;
  projectList: { items: ProjectMeta[]; loading: boolean; error: string | null } | null; // only when no document is open
  toast: string | null;
  canUndo: boolean;
  canRedo: boolean;
};

export function buildViewModel(state: EditorState, host: Host): ViewModel {
  const d = state.document;
  return {
    activeTool: state.tool.name,
    commandBar: commandBar(state),
    properties: properties(state),
    cursor: cursorFor(state),
    snap: state.snap && state.snap.kind !== "none" ? { kind: state.snap.kind, at: state.snap.point } : null,
    presence: Object.values(state.presence).map((p) => ({ clientId: p.clientId, name: p.name, color: p.color, at: p.cursor })),
    project: d ? { name: d.project.name, status: status(d), dirty: isDirty(d), canEdit: canCommit(d) } : null,
    projectList: d ? null : { items: state.workspace.projects, loading: state.workspace.loading, error: state.workspace.error },
    toast: state.toast && state.toast.until > host.now() ? state.toast.text : null,
    canUndo: d !== null && canCommit(d) && canUndo(state.undo),
    canRedo: d !== null && canCommit(d) && canRedo(state.undo),
  };
}

function commandBar(state: EditorState): ViewModel["commandBar"] {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      switch (tool.state.kind) {
        case "idle":
          return { prompt: "First point", value: "", unit: "m" };
        case "drawing":
          return { prompt: "Next point or length", value: tool.state.value, unit: "m" };
        case "paused":
          return { prompt: "Waiting for server", value: "", unit: null };
        default:
          return assertNever(tool.state);
      }
    case "select":
      return tool.state.kind === "editingHelper"
        ? { prompt: "Wall length", value: tool.state.value, unit: "m" }
        : { prompt: "Select", value: "", unit: null };
    case "zone":
      return { prompt: "Click inside a room", value: "", unit: null };
    default:
      return assertNever(tool);
  }
}

function field(id: string, label: string, value: string, unit: string | null, readOnly = true): Field {
  return { id, label, value, unit, readOnly };
}

function properties(state: EditorState): ViewModel["properties"] {
  const ref = state.selection[0];
  if (!ref || !state.document) return { kind: "none" };
  const doc = visibleDoc(state.document);
  switch (ref.table) {
    case "walls": {
      const h = wallHelperDimension(doc, ref.id);
      if (!h) return { kind: "none" };
      return {
        kind: "wall",
        fields: [field("length", "Length", h.length.toFixed(2), "m"), field("thickness", "Thickness", WALL_THICKNESS.toFixed(2), "m")],
      };
    }
    case "joints": {
      const j = doc.joints[ref.id];
      if (!j) return { kind: "none" };
      return { kind: "joint", fields: [field("x", "X", j.x.toFixed(2), "m"), field("y", "Y", j.y.toFixed(2), "m")] };
    }
    case "zoneLabels": {
      // Spec §5.6: an editable name and a read-only area; the area is derived, so it follows geometry changes.
      const label = doc.zoneLabels[ref.id];
      if (!label) return { kind: "none" };
      return {
        kind: "zone",
        fields: [field("name", "Name", label.name, null, false), field("area", "Area", areaFieldText(zoneOfLabel(doc, ref.id)), null)],
      };
    }
    default:
      return assertNever(ref.table);
  }
}

function cursorFor(state: EditorState): ViewModel["cursor"] {
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return "crosshair";
    case "zone":
      return "pointer";
    case "select":
      return tool.state.kind === "moving" ? "move" : state.hover ? "pointer" : "default";
    default:
      return assertNever(tool);
  }
}
