import { DEFAULT_OPENING_KIND, OPENING_KINDS, OPENING_KIND_IDS, defaultOpeningHeights, openingGeometry, openingHeightsFor, type Command, type OpeningKind } from "@fm/domain";
import type { Patch, Point } from "@fm/protocol";
import { NO_DRAWING } from "./session";
import { createdIn, fail, middle, noLayout, stateRef, type EditResult, type ToolKit } from "./tool-kit";
import type { DrawingTools, OpeningChange, Reply } from "./tool-types";

// Opening tools (spec: openings) add a door or window on a wall; their replies start with `result`: the new opening and
// its wall. Whether it fits is the domain's check (I12), whose refusal names the opening.
//
// add_layout and copy_layout reply with the new layout at the head (`result`). add_dimension (dims) passes the two
// points as given: the domain anchors each end (dims.16), and the reply's `result` gives the new ID, read from the
// edit's patch.

/** add_window's default kind: the first window row of the domain's table, the fixed window. */
const DEFAULT_WINDOW_KIND = OPENING_KIND_IDS.find((k) => OPENING_KINDS[k].tool === "add_window") ?? DEFAULT_OPENING_KIND;

type OpeningTools = Pick<DrawingTools, "addDoor" | "addWindow" | "setOpening" | "addLayout" | "copyLayout" | "addDimension">;
type Heights = { sill?: number | undefined; height?: number | undefined };

/**
 * A new opening's sill and head from the sill and height Claude gave (sills.08): none given, none sent, so the domain's
 * defaults apply on the wall; one given, the other from a new opening of the kind (a window's 0.90 sill, its 1.20).
 */
function newHeights(kind: OpeningKind, { sill, height }: Heights): { sill?: number; head?: number } {
  if (sill === undefined && height === undefined) return {};
  const d = defaultOpeningHeights(OPENING_KINDS[kind].fromFloor, Infinity);
  return openingHeightsFor({ kind, ...d }, kind, { sill, height });
}

export function openingTools({ session, edit, editReply }: ToolKit): OpeningTools {
  /** A new opening on an existing wall; the cursor moves to its centre. */
  async function addOpening(
    wall: string,
    kind: OpeningKind,
    fields: { offset: number; width?: number | undefined; side?: "left" | "right" | undefined; hinge?: "a" | "b" | undefined; glazed?: boolean | undefined; sill?: number; head?: number; sheer?: "none" | "glass" | "floor" | undefined; shutterBox?: boolean | undefined },
  ): Promise<Reply> {
    const doc = session.drawing();
    if (doc === null) return fail(NO_DRAWING);
    if (!Object.hasOwn(doc.walls, wall)) return fail(`No wall has the id ${wall}`);
    const opId = session.newId();
    const near = (patch: Patch | null): Point | null => {
      const now = session.drawing();
      const opening = createdIn(patch, "openings");
      const g = now && opening !== undefined ? openingGeometry(now, opening) : null;
      return g ? middle(g.start, g.end) : null;
    };
    const added = (patch: Patch | null): EditResult => {
      const opening = createdIn(patch, "openings");
      return opening === undefined ? { wall } : { opening, wall };
    };
    return edit({ type: "addOpening", opId, wall, kind, ...fields }, near, added);
  }

  /** The new state an addState or copyState made, for the reply. */
  function newState(patch: Patch | null): EditResult {
    const doc = session.drawing();
    const id = createdIn(patch, "states");
    const state = doc && id !== undefined ? stateRef(doc, id) : null;
    return state ? { layout: state } : {};
  }

  return {
    async addDoor({ wall, kind = DEFAULT_OPENING_KIND, height, ...fields }) {
      return addOpening(wall, kind, { ...fields, ...newHeights(kind, { height }) });
    },
    async addWindow({ wall, kind = DEFAULT_WINDOW_KIND, sill, height, ...fields }) {
      return addOpening(wall, kind, { ...fields, ...newHeights(kind, { sill, height }) });
    },
    async setOpening({ opening, offset, kind, width, side, hinge, glazed, sill, height, sheer, shutterBox }: OpeningChange) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const o = Object.hasOwn(doc.openings, opening) ? doc.openings[opening] : undefined;
      if (o === undefined) return fail(`No opening has the id ${opening}`);
      const heights = sill === undefined && height === undefined ? {} : openingHeightsFor(o, kind ?? o.kind, { sill, height });
      const result = (): EditResult => ({ opening, wall: o.wall });
      const near = (): Point | null => {
        const g = openingGeometry(session.drawing() ?? doc, opening);
        return g ? middle(g.start, g.end) : null;
      };
      const change: Command = { type: "setOpening", openingId: opening, kind, width, side, hinge, glazed, sheer, shutterBox, ...heights };
      if (offset === undefined) return edit(change, near, result);
      const move: Command = { type: "moveOpening", openingId: opening, offset };
      const others = [kind, width, side, hinge, glazed, sill, height, sheer, shutterBox].some((v) => v !== undefined);
      if (!others) return edit(move, near, result);
      // Both, checked together before anything is sent (mcp.07): a wider door may fit only once moved, a moved one only
      // once narrower, so the first order the rules accept goes; if neither, the first order's reason.
      let first: string | null = null;
      for (const commands of [[move, change], [change, move]]) {
        const r = await session.editAll(commands);
        if (r.ok) {
          const p = near();
          if (p !== null) session.pointAt(p);
          return editReply(doc, r.value, result());
        }
        if (!r.error.refused) return fail(r.error.done === 0 ? r.error.error : `${r.error.error} (after ${r.error.done} of 2 changes)`);
        first ??= r.error.error;
      }
      return fail(first ?? "Refused");
    },
    async addLayout({ name }) {
      const opId = session.newId();
      return edit({ type: "addState", opId, name }, () => null, newState);
    },
    async copyLayout({ from, name }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (stateRef(doc, from) === null) return fail(noLayout(from));
      const opId = session.newId();
      return edit({ type: "copyState", opId, from, name }, () => null, newState);
    },
    async addDimension({ from, to, offset }) {
      const command: Command = { type: "addDimension", opId: session.newId(), a: from, b: to, offset };
      const added = (patch: Patch | null): EditResult => {
        const id = createdIn(patch, "dimensions");
        return id === undefined ? {} : { dimension: id };
      };
      return edit(command, () => middle(from, to), added);
    },
  };
}
