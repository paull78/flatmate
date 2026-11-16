import { add, isStraightJoint, scale, sub, wallFrame, wallRunOf, type Document } from "@fm/domain";
import { COLORS } from "./colors";
import type { Primitive } from "./scene-types";
import type { EditorState } from "../state";

// The run highlight (straight.16): what a wall drag will move shows before the drag. In Select, the hovered wall's run,
// a lone selected wall's run, and while a walls drag moves, its walls, draw in the hover colour; the selection itself
// stays one wall, drawn blue.

/** The walls drawn in the hover colour: the hovered wall's run, a lone selected wall's run, a moving drag's walls. */
export function highlightedWalls(state: EditorState, doc: Document): string[] {
  if (state.tool.name !== "select") return state.hover?.table === "walls" ? [state.hover.id] : [];
  const t = state.tool.state;
  if (t.kind === "moving" && t.target.kind === "walls") return [...t.target.wallIds];
  const lit = new Set<string>();
  const [only, ...more] = state.selection;
  if (only?.table === "walls" && more.length === 0 && doc.walls[only.id]?.column !== true) for (const id of wallRunOf(doc, only.id)) lit.add(id);
  if (state.hover?.table === "walls" && doc.walls[state.hover.id]?.column !== true) for (const id of wallRunOf(doc, state.hover.id)) lit.add(id);
  else if (state.hover?.table === "walls") lit.add(state.hover.id);
  return [...lit];
}

/**
 * A tick across the wall at each straight joint inside the lit walls (straight.42): where a run is in pieces, the
 * joint between two pieces shows, so it can be found, clicked and joined.
 */
export function runJointTicks(state: EditorState, doc: Document): Primitive[] {
  const seen = new Set<string>();
  const out: Primitive[] = [];
  for (const id of highlightedWalls(state, doc)) {
    const w = doc.walls[id];
    const f = wallFrame(doc, id);
    if (!w || !f) continue;
    for (const jointId of [w.a, w.b]) {
      const j = doc.joints[jointId];
      if (!j || seen.has(jointId) || !isStraightJoint(doc, jointId)) continue;
      seen.add(jointId);
      const half = scale(f.left, f.half);
      out.push({ kind: "segment", a: sub(j, half), b: add(j, half), width: { px: 2 }, color: COLORS.handle, cap: "butt" });
      out.push({ kind: "disc", center: { x: j.x, y: j.y }, radius: { px: 3 }, color: COLORS.handle });
    }
  }
  return out;
}
