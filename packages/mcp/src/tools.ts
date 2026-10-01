import { rectangleRoom, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point, Result } from "@fm/protocol";
import { summarize, type Region } from "./drawing";
import { NO_DRAWING, type EditorSession, type OpenProject } from "./session";

// Tool handlers: validated inputs in (schemas.ts), a short text out. Every editing tool is one domain command through
// the session, except draw_room and add_walls (several walls, checked together and submitted in one serial slot of
// the session, so a parallel tool call cannot land between them). After an accepted edit, Claude's cursor moves to
// where it happened (presence).

export type Reply = { text: string; isError: boolean };

export type DrawingTools = {
  listProjects(): Promise<Reply>;
  createProject(args: { name: string }): Promise<Reply>;
  openProject(args: { id: string }): Promise<Reply>;
  getDrawing(args?: { region?: Region | undefined }): Promise<Reply>;
  drawRoom(args: { x: number; y: number; width: number; height: number }): Promise<Reply>;
  addWall(args: { a: Point; b: Point }): Promise<Reply>;
  addWalls(args: { walls: { a: Point; b: Point }[] }): Promise<Reply>;
  setWallLength(args: { wall: string; length: number }): Promise<Reply>;
  moveJoint(args: { joint: string; to: Point }): Promise<Reply>;
  labelRoom(args: { point: Point; name: string }): Promise<Reply>;
  renameRoom(args: { label: string; name: string }): Promise<Reply>;
  delete(args: { ids: string[] }): Promise<Reply>;
};

const fail = (text: string): Reply => ({ text, isError: true });
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function tableOf(doc: Document, id: string): EntityRef["table"] | null {
  if (Object.hasOwn(doc.walls, id)) return "walls";
  if (Object.hasOwn(doc.joints, id)) return "joints";
  if (Object.hasOwn(doc.zoneLabels, id)) return "zoneLabels";
  return null;
}

export function createTools(session: EditorSession): DrawingTools {
  function drawingReply(region?: Region): Reply {
    const project = session.project();
    const doc = session.drawing();
    if (project === null || doc === null) return fail(NO_DRAWING);
    return { text: JSON.stringify(summarize(project, doc, region)), isError: false };
  }

  function opened(r: Result<OpenProject, string>): Reply {
    return r.ok ? drawingReply() : fail(r.error);
  }

  /** One command; on success the cursor moves to `near` (where the edit happened) and the drawing comes back. */
  async function edit(command: Command, near: () => Point | null): Promise<Reply> {
    const r = await session.edit(command);
    if (!r.ok) return fail(r.error);
    const p = near();
    if (p !== null) session.pointAt(p);
    return drawingReply();
  }

  function jointPoint(id: string): Point | null {
    const j = session.drawing()?.joints[id];
    return j ? { x: j.x, y: j.y } : null;
  }

  return {
    async listProjects() {
      const r = await session.listProjects();
      return r.ok ? { text: JSON.stringify({ projects: r.value }), isError: false } : fail(r.error);
    },
    async createProject({ name }) {
      return opened(await session.createProject(name));
    },
    async openProject({ id }) {
      return opened(await session.openProject(id));
    },
    async getDrawing(args = {}) {
      return drawingReply(args.region);
    },
    async drawRoom({ x, y, width, height }) {
      const r = await session.editAll(rectangleRoom({ x, y }, width, height, session.newId()));
      if (r.ok) {
        session.pointAt({ x: x + width / 2, y: y + height / 2 });
        return drawingReply();
      }
      const { error, done, refused } = r.error;
      if (refused) return fail(`${error}: nothing was drawn`);
      return fail(done === 0 ? error : `${error} (after ${done} of 4 walls: the room is not closed)`);
    },
    async addWall({ a, b }) {
      return edit({ type: "addWall", opId: session.newId(), from: { at: a }, to: { at: b } }, () => middle(a, b));
    },
    async addWalls({ walls }) {
      const commands = walls.map(({ a, b }): Command => ({ type: "addWall", opId: session.newId(), from: { at: a }, to: { at: b } }));
      const r = await session.editAll(commands);
      if (r.ok) {
        const last = walls.at(-1);
        if (last !== undefined) session.pointAt(middle(last.a, last.b));
        return drawingReply();
      }
      const { error, done, refused, at } = r.error;
      const n = walls.length;
      if (refused) return fail(`Wall ${at + 1} of ${n}: ${error}: nothing was drawn`);
      return fail(done === 0 ? error : `${error} (after ${done} of ${n} walls)`);
    },
    async setWallLength({ wall, length }) {
      const w = session.drawing()?.walls[wall];
      return edit({ type: "setWallLength", wallId: wall, length, keep: "a" }, () => (w ? jointPoint(w.b) : null));
    },
    async moveJoint({ joint, to }) {
      return edit({ type: "moveJoints", moves: [{ jointId: joint, to }] }, () => to);
    },
    async labelRoom({ point, name }) {
      return edit({ type: "labelZone", id: session.newId(), at: point, name }, () => point);
    },
    async renameRoom({ label, name }) {
      const at = session.drawing()?.zoneLabels[label]?.at ?? null;
      return edit({ type: "renameZone", id: label, name }, () => at);
    },
    async delete({ ids }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const refs: EntityRef[] = [];
      for (const id of ids) {
        const table = tableOf(doc, id);
        if (table === null) return fail(`No wall, joint or room label has the id ${id}`);
        refs.push({ table, id });
      }
      return edit({ type: "deleteEntities", ids: refs }, () => null);
    },
  };
}
