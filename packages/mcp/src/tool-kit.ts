import { footprints, quadCentre, type Command, type Document, type LayoutObject, type Placement } from "@fm/domain";
import { err, ok, type Patch, type Point, type Result, type TableName } from "@fm/protocol";
import { summarize, warningsOf, xy, type Region, type StateSummary, type XY } from "./drawing";
import { NO_DRAWING, type EditorSession, type OpenProject } from "./session";
import type { Reply } from "./tool-types";

// What every tool group shares: the replies, the lookups by id, and the kit built on one session (createKit), so the
// groups keep no state of their own. After an accepted edit, Claude's cursor moves to where it happened (presence).

/** What a layout or opening edit touched, at the head of its reply. */
export type EditResult = {
  object?: string; objects?: string[]; layout?: StateSummary; note?: string; label?: string; opening?: string; wall?: string; dimension?: string; deck?: string; column?: string; hole?: string; area?: string; sheet?: string; section?: string;
};

export type ToolKit = {
  session: EditorSession;
  /** The drawing as get_drawing gives it, headed by `result` when given. */
  drawingReply: (region?: Region, result?: EditResult) => Reply;
  opened: (r: Result<OpenProject, string>) => Reply;
  /**
   * One command; on success the cursor moves to `near` (where the edit happened) and the edit's reply comes back with
   * `result` when given (both read after the edit, and both get the patch the edit submitted, for created ids).
   */
  edit: (command: Command, near: (patch: Patch | null) => Point | null, result?: (patch: Patch | null) => EditResult) => Promise<Reply>;
  /** An edit's reply (mcp.01): `result`, every row its patches wrote, and the blocked clearances it added and cleared; no drawing. */
  editReply: (before: Document | null, patches: readonly (Patch | null)[], result?: EditResult) => Reply;
  jointPoint: (id: string) => Point | null;
  wallMiddle: (id: string) => Point | null;
};

export const fail = (text: string): Reply => ({ text, isError: true });

export const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The id of the row an edit created in `table`, read from its patch (cleanup step 09); undefined when none. */
export function createdIn(patch: Patch | null, table: TableName): string | undefined {
  return patch?.puts.find((p) => p.table === table)?.entity.id;
}

/** The ids of every row an edit put in `table`, in the patch's order. */
export function allCreatedIn(patch: Patch | null, table: TableName): string[] {
  return (patch?.puts ?? []).filter((p) => p.table === table).map((p) => p.entity.id);
}

export const noLayout = (id: string): string => `No layout has the id ${id}`;
export const noObject = (id: string): string => `No object has the id ${id}`;
export const noDeck = (id: string): string => `No deck has the id ${id}`;

export function stateRef(doc: Document, id: string): StateSummary | null {
  const s = Object.hasOwn(doc.states, id) ? doc.states[id] : undefined;
  return s ? { id: s.id, name: s.name } : null;
}

export function objectOf(doc: Document, id: string): LayoutObject | null {
  return (Object.hasOwn(doc.objects, id) ? doc.objects[id] : undefined) ?? null;
}

/** The placement of `objectId` in the layout `stateId`: the row a layout tool's (object, layout) pair names. */
export function placementIn(doc: Document, stateId: string, objectId: string): Result<{ placement: Placement; state: StateSummary }, string> {
  const state = stateRef(doc, stateId);
  if (state === null) return err(noLayout(stateId));
  const o = objectOf(doc, objectId);
  if (o === null) return err(noObject(objectId));
  const placement = Object.values(doc.placements).find((p) => p.object === objectId && p.state === stateId);
  if (placement === undefined) return err(`${o.name} (${o.id}) is not in the layout ${state.name} (${state.id}): it has no placement there`);
  return ok({ placement, state });
}

export function centreOf(doc: Document | null, placementId: string): Point | null {
  const quad = doc ? footprints(doc).get(placementId) : undefined;
  return quad ? quadCentre(quad) : null;
}

export function createKit(session: EditorSession): ToolKit {
  function drawingReply(region?: Region, result?: EditResult): Reply {
    const project = session.project();
    const doc = session.drawing();
    if (project === null || doc === null) return fail(NO_DRAWING);
    const s = summarize(project, doc, region);
    return { text: JSON.stringify(result === undefined ? s : { result, ...s }), isError: false };
  }

  function opened(r: Result<OpenProject, string>): Reply {
    return r.ok ? drawingReply() : fail(r.error);
  }

  function editReply(before: Document | null, patches: readonly (Patch | null)[], result?: EditResult): Reply {
    const after = session.drawing();
    if (after === null) return fail(NO_DRAWING);
    const reply = { ...(result === undefined ? {} : { result }), changed: changedBy(before, after, patches), warnings: warningsBy(before, after) };
    return { text: JSON.stringify(reply), isError: false };
  }

  async function edit(command: Command, near: (patch: Patch | null) => Point | null, result?: (patch: Patch | null) => EditResult): Promise<Reply> {
    const before = session.drawing();
    const r = await session.edit(command);
    if (!r.ok) return fail(r.error);
    const p = near(r.value);
    if (p !== null) session.pointAt(p);
    return editReply(before, [r.value], result?.(r.value));
  }

  function jointPoint(id: string): Point | null {
    const j = session.drawing()?.joints[id];
    return j ? { x: j.x, y: j.y } : null;
  }

  function wallMiddle(id: string): Point | null {
    const w = session.drawing()?.walls[id];
    const a = w ? jointPoint(w.a) : null;
    const b = w ? jointPoint(w.b) : null;
    return a && b ? middle(a, b) : null;
  }

  return { session, drawingReply, editReply, opened, edit, jointPoint, wallMiddle };
}

type Warning = ReturnType<typeof warningsOf>[number];

/**
 * The blocked clearances an edit made and those it ended (mcp-fixes.04): a warning standing before and after is in
 * neither, so a reply never repeats one. Added in the order of the drawing after, cleared in the order before.
 */
export function warningsBy(before: Document | null, after: Document): { added: Warning[]; cleared: Warning[] } {
  const key = (w: Warning): string => `${w.layout}\n${w.zone}\n${w.by}`;
  const was = before === null ? [] : warningsOf(before);
  const now = warningsOf(after);
  const wasKeys = new Set(was.map(key));
  const nowKeys = new Set(now.map(key));
  return { added: now.filter((w) => !wasKeys.has(key(w))), cleared: was.filter((w) => !nowKeys.has(key(w))) };
}

/**
 * A row as Claude addresses it (mcp-fixes.03): a wall with its ends, a joint with its point, a placement as its piece
 * and layout, any other row its id.
 */
export type ChangedRef = string | { id: string; from: XY; to: XY } | { id: string; at: XY } | { object: string; layout: string };
/** The rows an edit wrote under one action, by kind as get_drawing names it; a kind with no rows is left out. */
export type ChangedKinds = Partial<Record<string, ChangedRef[]>>;
export type Changed = { created: ChangedKinds; updated: ChangedKinds; deleted: ChangedKinds };

/** Each table's key in `changed`, the word get_drawing uses for it; a column row of `walls` is a column. */
const KIND: Record<TableName, string> = {
  joints: "joints", walls: "walls", zoneLabels: "labels", decks: "decks", deckHoles: "holes", states: "layouts", objects: "objects", placements: "placements",
  openings: "openings", dimensions: "dimensions", projectFields: "fields", underlays: "underlay", logos: "logos", ceilings: "ceiling", sheets: "sheets",
  sections: "sections", areas: "areas",
};

/**
 * Every row the edits wrote, read from their patches in order (mcp.01): created when the row wasn't in the drawing
 * before them, else updated; deleted rows named from the drawing before (a gone wall keeps its ends, a gone placement
 * its piece and layout). A row created then deleted by the same edits is left out. Grouped by kind (mcp-fixes.03).
 */
export function changedBy(before: Document | null, after: Document, patches: readonly (Patch | null)[]): Changed {
  const status = new Map<string, { table: TableName; id: string; how: keyof Changed }>();
  const existed = (table: TableName, id: string): boolean => before !== null && Object.hasOwn(before[table], id);
  for (const patch of patches) {
    for (const { table, entity } of patch?.puts ?? []) {
      const key = `${table}/${entity.id}`;
      const was = status.get(key)?.how;
      status.set(key, { table, id: entity.id, how: was === "created" || (was === undefined && !existed(table, entity.id)) ? "created" : "updated" });
    }
    for (const { table, id } of patch?.deletes ?? []) {
      const key = `${table}/${id}`;
      if (status.get(key)?.how === "created") status.delete(key);
      else status.set(key, { table, id, how: "deleted" });
    }
  }
  const changed: Changed = { created: {}, updated: {}, deleted: {} };
  for (const { table, id, how } of status.values()) {
    const { kind, ref } = rowRef(how === "deleted" ? before : after, table, id);
    (changed[how][kind] ??= []).push(ref);
  }
  return changed;
}

/** A written row's kind and how Claude reads it, from `doc` (the drawing after, or before for a deleted row). */
function rowRef(doc: Document | null, table: TableName, id: string): { kind: string; ref: ChangedRef } {
  const row = <T,>(rows: Record<string, T> | undefined): T | undefined => (rows !== undefined && Object.hasOwn(rows, id) ? rows[id] : undefined);
  if (table === "placements") {
    const p = row(doc?.placements);
    return { kind: KIND.placements, ref: p ? { object: p.object, layout: p.state } : id };
  }
  if (table === "joints") {
    const j = row(doc?.joints);
    return { kind: KIND.joints, ref: j ? { id, at: xy(j) } : id };
  }
  if (table === "walls") {
    const w = row(doc?.walls);
    if (w?.column === true) return { kind: "columns", ref: id };
    const a = w ? doc?.joints[w.a] : undefined;
    const b = w ? doc?.joints[w.b] : undefined;
    return { kind: KIND.walls, ref: a && b ? { id, from: xy(a), to: xy(b) } : id };
  }
  return { kind: KIND[table], ref: id };
}
