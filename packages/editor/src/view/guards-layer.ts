import { guardPosts, guardRuns, relationAt, type Document, type Level } from "@fm/domain";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";

// A deck's guards on the plan and on paper (AC-06, spec "Guards"): a thin line, with post marks on a Railing. They read the
// domain's one list of runs, as the 3D view and the section do, and draw only where the level's cut can see them.

/** The guards the `level` shows: not one above its cut, as a loft's at the floor, nor one hidden under the level. */
export function guardPrimitives(doc: Document, level: Level, style: PlanStyle): Primitive[] {
  return guardRuns(doc).flatMap((run): Primitive[] => {
    const relation = relationAt({ bottom: run.bottom, top: run.top }, level);
    if (relation === "above" || relation === "under") return [];
    const color = run.kind === "glass" ? style.openingGlass : style.guard.ink;
    const line: Primitive = { kind: "segment", a: run.a, b: run.b, width: { px: style.guard.line }, color, cap: "butt" };
    return run.kind === "glass" ? [line] : [line, ...guardPosts(run).map((center): Primitive => ({ kind: "disc", center, radius: { px: style.guard.post }, color }))];
  });
}
