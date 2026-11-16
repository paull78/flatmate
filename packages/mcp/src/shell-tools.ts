import { PLAN_SIDES, sideAt, sideField, type DeckGuardPatches, type Guard, type GuardPatch } from "@fm/domain";
import { LOWER_HEIGHT, MOTIFS, PLAIN_WHITE, ROOF_PRESETS, deckView, holeView, motifsFor, outsideOf, rectangleRoom, roofCovering, roomWallsOf, sheetsOf, sideFinishes, sidesOf, suits, withMotif, type Command, type Document, type EntityRef, type Finish, type SideFinish, type Surface } from "@fm/domain";
import type { Patch, Point } from "@fm/protocol";
import { NO_DRAWING } from "./session";
import { createdIn, fail, middle, noDeck, placementIn, type EditResult, type ToolKit } from "./tool-kit";
import type { CeilingArgs, DeckArgs, DrawingTools, GuardArg, NewWall } from "./tool-types";
import { FALLS_OF_WORD } from "./schemas";

// The building's tools: projects, walls, rooms, the ceiling, title block fields, delete and decks. Each is one domain
// command through the session, except draw_room and add_walls (several commands, checked together and submitted in
// one serial slot of the session, so a parallel tool call cannot land between them).
//
// Decks (decks.08, .11, .16): add_deck is one addDeck command with the given overrides, its ID read from the patch;
// set_deck is one setDeck, x and y merged with the deck's centre.
//
// set_finish (finishes.14, .37, deck-floors.03): a label's or a deck's finish (with the same motif) or withMotif's (the
// one motif-change rule), then the given fields over it; "none" clears it. The domain checks the result and its refusal
// names the field's range (finishes.27).

type ShellTools = Pick<DrawingTools,
  | "listProjects" | "createProject" | "openProject" | "getDrawing" | "drawRoom" | "addWall" | "addWalls" | "setWallLength" | "setWallThickness"
  | "setWallTop" | "setCeiling" | "moveJoint" | "moveWalls" | "splitWall" | "straightenWall" | "labelRoom" | "rename" | "setFinish" | "setProjectField" | "delete" | "addDeck" | "setDeck">;

/** A guard as Claude gives it, as the domain's commands take it: what's left out stays out. */
export function guardPatch(given: GuardArg): GuardPatch {
  return { ...(given.kind === undefined ? {} : { kind: given.kind }), ...(given.height === undefined ? {} : { height: given.height }) };
}

/**
 * The deck fields given, as addDeck and setDeck take them: a field left out stays out (exactOptionalPropertyTypes).
 * `guards` names sides by where they face on the plan at `rotation`, the deck's after the edit (edges.05).
 */
function deckFields(f: DeckArgs & { at?: Point | undefined }, rotation: number): { name?: string; at?: Point; w?: number; d?: number; rotation?: number; guard?: Guard; top?: number; solid?: boolean } & DeckGuardPatches {
  const sides: DeckGuardPatches = {};
  for (const name of PLAN_SIDES) {
    const given = f.guards?.[name];
    if (given !== undefined) sides[sideField(sideAt({ rotation }, name))] = guardPatch(given);
  }
  return {
    ...sides,
    ...(f.name === undefined ? {} : { name: f.name }),
    ...(f.at === undefined ? {} : { at: f.at }),
    ...(f.width === undefined ? {} : { w: f.width }),
    ...(f.depth === undefined ? {} : { d: f.depth }),
    ...(f.rotation === undefined ? {} : { rotation: f.rotation }),
    ...(f.top === undefined ? {} : { top: f.top }),
    ...(f.solid === undefined ? {} : { solid: f.solid }),
    ...(f.guard === undefined ? {} : { guard: f.guard }),
  };
}

const addWall = (opId: string, { a, b, thickness, on }: NewWall): Command => ({
  type: "addWall",
  opId,
  from: { at: a },
  to: { at: b },
  ...(thickness === undefined ? {} : { thickness }),
  ...(on === undefined ? {} : { base: on }),
});

function tableOf(doc: Document, id: string): EntityRef["table"] | null {
  if (Object.hasOwn(doc.walls, id)) return "walls";
  if (Object.hasOwn(doc.joints, id)) return "joints";
  if (Object.hasOwn(doc.zoneLabels, id)) return "zoneLabels";
  if (Object.hasOwn(doc.openings, id)) return "openings";
  if (Object.hasOwn(doc.dimensions, id)) return "dimensions";
  if (deckView(doc, id) !== null) return "decks";
  if (holeView(doc, id) !== null) return "deckHoles";
  if (Object.hasOwn(doc.objects, id)) return "objects";
  if (Object.hasOwn(doc.sections, id)) return "sections";
  if (Object.hasOwn(doc.areas, id)) return "areas";
  return null;
}

export function shellTools({ session, drawingReply, editReply, opened, edit, jointPoint, wallMiddle }: ToolKit): ShellTools {
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
    async drawRoom({ corner, width, depth, thickness }) {
      const before = session.drawing();
      const r = await session.editAll(rectangleRoom(corner, width, depth, session.newId(), thickness));
      if (r.ok) {
        session.pointAt({ x: corner.x + width / 2, y: corner.y + depth / 2 });
        return editReply(before, r.value);
      }
      const { error, done, refused } = r.error;
      if (refused) return fail(`${error}: nothing was drawn`);
      return fail(done === 0 ? error : `${error} (after ${done} of 4 walls: the room is not closed)`);
    },
    async addWall(wall) {
      return edit(addWall(session.newId(), wall), () => middle(wall.a, wall.b));
    },
    async addWalls({ walls }) {
      const commands = walls.map((wall) => addWall(session.newId(), wall));
      const before = session.drawing();
      const r = await session.editAll(commands);
      if (r.ok) {
        const last = walls.at(-1);
        if (last !== undefined) session.pointAt(middle(last.a, last.b));
        return editReply(before, r.value);
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
    async setWallThickness({ wall, thickness }) {
      return edit({ type: "setWallThickness", wallId: wall, thickness }, () => wallMiddle(wall));
    },
    async setWallTop({ wall, top }) {
      return edit({ type: "setWallTop", wallId: wall, top }, () => wallMiddle(wall));
    },
    async setCeiling(args) {
      return edit(ceilingCommand(args), () => null);
    },
    async moveJoint({ joint, to }) { // connects where it lands (straight.18), as the canvas drag does
      return edit({ type: "connectJoint", opId: session.newId(), jointId: joint, to }, () => to);
    },
    async straightenWall({ wall }) { // straight.43: the whole nearly straight side, as Properties' Straighten
      return edit({ type: "straightenWalls", wallId: wall }, () => wallMiddle(wall), () => ({ wall }));
    },
    async splitWall({ wall, offset }) {
      return edit({ type: "splitWall", opId: session.newId(), wallId: wall, offset }, () => wallMiddle(wall), () => ({ wall }));
    },
    async moveWalls({ walls, by, objects, layout }) { // straight.14: the walls (and pieces) named, by a delta; the same command as a wall or group drag
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const placements: string[] = [];
      if (objects !== undefined && layout === undefined) return fail("objects need layout: pass the layout the pieces are in");
      for (const object of objects ?? []) {
        const found = placementIn(doc, layout ?? "", object);
        if (!found.ok) return fail(found.error);
        placements.push(found.value.placement.id);
      }
      return edit({ type: "moveWalls", walls, by, ...(placements.length > 0 ? { placements } : {}) }, () => (walls[0] === undefined ? null : wallMiddle(walls[0])));
    },
    async labelRoom({ point, name }) {
      const id = session.newId();
      return edit({ type: "labelZone", id, at: point, name, finish: null }, () => point, () => ({ label: id }));
    },
    async rename({ id, name }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      // One rename for what has no set_ tool of its own (mcp.07); the rest name the tool that renames them.
      if (Object.hasOwn(doc.zoneLabels, id)) return edit({ type: "renameZone", id, name }, () => doc.zoneLabels[id]?.at ?? null);
      if (Object.hasOwn(doc.states, id)) return edit({ type: "renameState", stateId: id, name }, () => null);
      if (Object.hasOwn(doc.objects, id)) return edit({ type: "renameObject", objectId: id, name }, () => null);
      if (deckView(doc, id) !== null) return fail(`${id} is a deck: rename it with set_deck`);
      if (Object.hasOwn(doc.areas, id)) return fail(`${id} is a named area: rename it with set_area`);
      if (sheetsOf(doc).some((s) => s.id === id)) return fail(`${id} is a sheet: rename it with set_sheet`);
      return fail(`No room label, layout or piece has the id ${id}`);
    },
    async setFinish({ label, deck, wall, side, wallsOf, roof, outside, reset, lower, height, motif: given, colour, strength, size, angle }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const targets = [label, deck, wall, wallsOf, roof, outside].filter((t) => t !== undefined).length;
      if (targets !== 1) return fail("Pass one of label, deck, wall, wallsOf, roof or outside");
      if (reset) { // a custom side back to the default it faces (inherit.04)
        if (wall === undefined || side === undefined) return fail("reset returns a custom wall side: pass it with wall and side");
        if (given !== undefined) return fail("reset takes no motif: it returns the side to the default it faces");
        const row = Object.hasOwn(doc.walls, wall) ? doc.walls[wall] : undefined;
        if (row === undefined) return fail(`No wall has the id ${wall}`);
        const [a, b] = [doc.joints[row.a], doc.joints[row.b]];
        return edit({ type: "resetWallSide", wallId: wall, side }, () => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null));
      }
      if (given === undefined) return fail('Pass motif: a motif id, or "none" to remove the part named');
      const motif = given;
      // The surface the target is, and the motif must suit it (surfaces step 14).
      const surface: Surface = wall !== undefined || wallsOf !== undefined || outside ? "wall" : roof ? "roof" : "floor";
      if (motif !== "none" && !suits(motif, surface)) {
        return fail(`${motif} suits ${MOTIFS[motif].surfaces.map((s) => `${s}s`).join(" and ")}, not ${surface}s: a ${surface} takes ${motifsFor(surface).join(", ")}`);
      }
      const next = (current: Finish | null): Finish | null => motif === "none" ? null : {
        ...(current?.motif === motif ? current : withMotif(current, motif)),
        ...(colour === undefined ? {} : { colour }), // the domain lower-cases it
        ...(strength === undefined ? {} : { strength }),
        ...(size === undefined ? {} : { size }),
        ...(angle === undefined ? {} : { angle }),
      };
      const part = lower ? "lower" : "finish";
      /** A default's command for one part, from what it holds now (a room's or the house's, inherit.01). */
      const partOf = (was: SideFinish | null) => {
        const current = lower ? (was?.lower?.finish ?? null) : (was?.finish ?? null);
        return { part, finish: next(current), ...(lower ? { height: height ?? was?.lower?.height ?? LOWER_HEIGHT.default } : {}) } as const;
      };
      if (wall !== undefined) {
        const row = Object.hasOwn(doc.walls, wall) ? doc.walls[wall] : undefined;
        if (row === undefined) return fail(`No wall has the id ${wall}`);
        if (side === undefined) return fail("Pass side with wall: left or right, looking from joint a to joint b");
        const [a, b] = [doc.joints[row.a], doc.joints[row.b]];
        const at = () => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
        const KEEPS = "A custom side keeps a finish: pass reset to return it to the default it faces";
        const custom = sidesOf(row)?.[side] ?? null;
        if (custom) { // a custom side: one part (inherit.08)
          if (!lower && motif === "none") return fail(KEEPS);
          return edit({ type: "setWallFinish", wallId: wall, side, ...partOf(custom) }, at);
        }
        // An inherited side becomes custom from what it shows, as Customize does (inherit.04), then the part is set.
        const shown = sideFinishes(doc, wall)?.[side] ?? null;
        const band = shown?.lower ?? null;
        if (lower) {
          const finish = next(band?.finish ?? null);
          return edit({ type: "setWallSide", wallId: wall, side, finish: shown?.finish ?? PLAIN_WHITE, lower: finish, height: height ?? band?.height ?? LOWER_HEIGHT.default }, at);
        }
        const finish = next(shown?.finish ?? null);
        if (finish === null) return fail(KEEPS);
        return edit({ type: "setWallSide", wallId: wall, side, finish, lower: band?.finish ?? null, ...(band ? { height: band.height } : {}) }, at);
      }
      if (wallsOf !== undefined) {
        const row = Object.hasOwn(doc.zoneLabels, wallsOf) ? doc.zoneLabels[wallsOf] : undefined;
        if (row === undefined) return fail(`No room label has the id ${wallsOf}`);
        return edit({ type: "setRoomWallFinishes", labelId: wallsOf, ...partOf(roomWallsOf(row)) }, () => row.at);
      }
      if (outside) return edit({ type: "setOutsideFinish", ...partOf(outsideOf(doc)) }, () => null);
      if (roof) return edit({ type: "setRoofCovering", finish: next(roofCovering(doc)) }, () => null);
      if (deck !== undefined) {
        const view = deckView(doc, deck);
        if (view === null) return fail(`No deck has the id ${deck}`);
        return edit({ type: "setDeckFinish", deckId: deck, finish: next(view.finish) }, () => view.at);
      }
      if (label === undefined) return fail("Pass label (a room) or deck");
      const row = Object.hasOwn(doc.zoneLabels, label) ? doc.zoneLabels[label] : undefined;
      if (row === undefined) return fail(`No room label has the id ${label}`);
      return edit({ type: "setFinish", id: label, finish: next(row.finish) }, () => row.at);
    },
    async setProjectField({ key, value }) {
      return edit({ type: "setProjectField", key, value }, () => null);
    },
    async delete({ ids, layout: state }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      // A layout goes on its own: deleteState is its own command (mcp.07), the domain refusing the last one.
      const layout = ids.find((id) => Object.hasOwn(doc.states, id));
      if (layout !== undefined) return ids.length === 1 ? edit({ type: "deleteState", stateId: layout }, () => null) : fail("Delete a layout on its own");
      const refs: EntityRef[] = [];
      for (const id of ids) {
        const table = tableOf(doc, id);
        if (table === null) return fail(`No wall, column, joint, room label, opening, dimension, deck, hole, piece, section, named area or layout has the id ${id}`);
        if (table !== "objects") {
          refs.push({ table, id });
          continue;
        }
        // A piece leaves one layout, as canvas Delete does; with no placement left it goes (cleanup.08).
        if (state === undefined) return fail(`${doc.objects[id]?.name ?? "Object"} (${id}) is a piece: pass layout to say which one`);
        const found = placementIn(doc, state, id);
        if (!found.ok) return fail(found.error);
        refs.push({ table: "placements", id: found.value.placement.id });
      }
      return edit({ type: "deleteEntities", ids: refs }, () => null);
    },
    async addDeck({ preset = "platform", centre, ...fields }) {
      const command: Command = { type: "addDeck", opId: session.newId(), preset, ...deckFields(fields, fields.rotation ?? 0), at: centre };
      const added = (patch: Patch | null): EditResult => {
        const id = createdIn(patch, "decks");
        return id === undefined ? {} : { deck: id };
      };
      return edit(command, () => centre, added);
    },
    async setDeck({ deck, centre, ...fields }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const now = deckView(doc, deck);
      if (now === null) return fail(noDeck(deck));
      const at = centre;
      const command: Command = { type: "setDeck", deckId: deck, ...deckFields({ ...fields, at }, fields.rotation ?? now.rotation) };
      return edit(command, () => {
        const after = session.drawing();
        return (after && deckView(after, deck)?.at) ?? null;
      }, () => ({ deck }));
    },
  };
}

/** set_ceiling's command: a preset's shape, low side and pitch, then what was given over it (roofs.14). */
function ceilingCommand(a: CeilingArgs): Command {
  const p = ROOF_PRESETS.find((x) => x.id === a.preset);
  const given = {
    ...(a.shape === undefined ? {} : { shape: a.shape }), ...(a.height === undefined ? {} : { height: a.height }),
    ...(a.pitch === undefined ? {} : { pitch: a.pitch }), ...(a.highSide === undefined ? {} : { highSide: a.highSide }),
    ...(a.falls === undefined ? {} : { falls: FALLS_OF_WORD[a.falls] }), ...(a.overhang === undefined ? {} : { overhang: a.overhang }),
  };
  const fromPreset = p ? { shape: p.shape, height: p.height, ...(a.highSide === undefined ? { pitch: p.pitch } : {}) } : {};
  return { type: "setCeiling", ...fromPreset, ...given };
}
