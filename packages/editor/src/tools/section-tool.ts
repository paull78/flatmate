import { nextSectionLetter, type Section } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { switchTool, type EditorState, type Step } from "../state";
import { refuse } from "../toast";
import { reasonOf } from "../toast-text";
import type { SnapResult } from "../types";
import { acrossLine } from "../view/dimension-layout";
import { snapCursor } from "./dimension-tool";
import type { SectionToolState } from "./types";

export const SECTION_PROMPTS: Record<SectionToolState["kind"], string> = { idle: "First point", second: "Second point", side: "Pick the side to look at" };

/**
 * Spec "Drawing a section": a press sets A, then B, then the side, which commits one `addSection` and selects the row it
 * made; the tool then goes back to Select. Releases are ignored. B is refused with the domain's reason, so a line too
 * short, or no letter left, stops there and A stays. The side is the raw pointer's, and a press on the line looks left.
 */
export function sectionPointer(state: EditorState, tool: SectionToolState, e: PointerInput, host: Host): Step {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc) return { state, effects: [] };
  const press = e.type === "pointerDown";
  switch (tool.kind) {
    case "idle": {
      const snap = snapCursor(state, doc, null);
      return { state: withSection(state, press ? { kind: "second", a: snap.point } : tool, snap), effects: [] };
    }
    case "second": {
      const snap = snapCursor(state, doc, tool.a);
      const next = withSection(state, tool, snap);
      if (!press) return { state: next, effects: [] };
      const b = snap.point;
      const reason = reasonOf(doc, { type: "addSection", a: tool.a, b, side: 1 });
      if (reason !== null) return refuse(next, reason, host);
      return { state: withSection(state, { kind: "side", a: tool.a, b, side: sideAt(state, tool.a, b) }, null), effects: [] };
    }
    case "side": {
      const { a, b } = tool;
      const side = sideAt(state, a, b);
      const next = withSection(state, { kind: "side", a, b, side }, null);
      if (!press) return { state: next, effects: [] };
      const out = runCommand(next, { type: "addSection", a, b, side }, host);
      if (out.committed === null) return { state: out.state, effects: out.effects }; // the toast says why; A and B stay
      const id = out.patch?.puts.find((p) => p.table === "sections")?.entity.id;
      const placed = switchTool(out.state, "select"); // one section at a time: the next click selects, and Delete works
      return { state: id === undefined ? placed : { ...placed, selection: [{ table: "sections", id }] }, effects: out.effects };
    }
    default:
      return assertNever(tool);
  }
}

/** Esc goes back one stage: B, then A; with nothing placed it picks the Select tool. The stage it returns to draws without waiting for a move. */
export function sectionEscape(state: EditorState, tool: SectionToolState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const snap = (origin: Point | null) => (doc && state.pointer ? snapCursor(state, doc, origin) : null);
  switch (tool.kind) {
    case "idle":
      return switchTool(state, "select");
    case "second":
      return withSection(state, { kind: "idle" }, snap(null));
    case "side":
      return withSection(state, { kind: "second", a: tool.a }, snap(tool.a));
    default:
      return assertNever(tool);
  }
}

/** The row the tool would make, under the letter it would take, for the preview; null with nothing to draw or no letter left. */
export function sectionDraft(state: EditorState): Section | null {
  const tool = state.tool;
  if (tool.name !== "section" || !state.pointer || !state.document) return null;
  const id = nextSectionLetter(visibleDoc(state.document));
  if (id === undefined) return null;
  const t = tool.state;
  switch (t.kind) {
    case "idle":
      return null;
    case "second":
      return state.snap ? { id, a: t.a, b: state.snap.point, side: 1, depth: null } : null;
    case "side":
      return { id, a: t.a, b: t.b, side: t.side, depth: null };
    default:
      return assertNever(t);
  }
}

function sideAt(state: EditorState, a: Point, b: Point): 1 | -1 {
  const p = state.pointer;
  return p && acrossLine(a, b, p.world) < 0 ? -1 : 1;
}

function withSection(state: EditorState, tool: SectionToolState, snap: SnapResult | null): EditorState {
  return { ...state, tool: { name: "section", state: tool }, snap };
}
