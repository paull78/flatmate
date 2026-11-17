import {
  anchorAtMm, armsOf, assertNever, configsOf, deckView, defaultSize, depthOf, familyKinds, heightsOf, inEveryLayout, kindConfigs, kindOf, levelOf,
  MESSAGES, SIDE_IDS, presetSize, sortedIds, withSide, zoneExtent, type Arms, type Command, type Document, type Heights, type LayoutObject, type ObjectKind, type ObjectOption, type Preset, type Side,
} from "@fm/domain";
import { brokenApart, furnitureSet, groupCentre, pieceLandsOn, placeNote, setBox, setHeight, setPieces, turnedPlaces } from "@fm/editor";
import { err, ok, type Point, type Result } from "@fm/protocol";
import { NO_DRAWING } from "./session";
import { presetNamed, presetNamesOf } from "./preset-names";
import { centreOf, createdIn, fail, noDeck, noObject, noLayout, objectOf, placementIn, stateRef, type ToolKit } from "./tool-kit";
import type { DrawingTools, Reply, ZoneArg } from "./tool-types";

// Layout tools (spec: layouts) speak in footprint centres, like a click with the editor's Object tool; the document
// stores each placement's anchor, the middle of the footprint's back edge (layout-states.49, .54). Their replies
// start with `result`: the object and the layout the edit touched.
//
// Smart objects (smart.12, .16, .21): place_object and set_size take a preset of the object's own kind, checked here
// so the reply names that kind's presets; set_zones turns use-zone sides on or off in one state and sets a side's depth
// and insets (furnish.14, .20), its commands checked together before any is sent and submitted in one serial slot of
// the session; set_opens_into switches a built-in unit within its family, found by the kinds table's `opensInto`
// column, never by kind id.
//
// Decks (decks.08, .11, .16): place_object and move_object pass `on` as the placement's surface; without it the
// domain's landing rule picks it from the piece's fit shape and footprint centre, as the editor's Object tool and a
// drag do. move_object with only `on` keeps the anchor and the rotation.
//
// Options (library.10): set_desk turns a desk's "With computer" on or off, set_chairs a set's "Round chairs", in every
// layout, both through `setOption`; the domain refuses a kind that doesn't list the option with its own reason.
//
// Stairs (stairs.10, .18, stairdraw.08): place_object and move_object pass `reaches` ("nothing" unlinks on a move); the
// domain links the stair, sets its height from the deck and places it in every layout state. Touching an edge links
// nothing. The kind's default heights here only feed the landing rule; the command sends none.
//
// Height (clarity.06): place_object's `height` is the one way Claude gets a lower piece, as it never lowers by itself. It
// sends a size whose width and depth repeat the kind's or the preset's, which the command needs with `h`.

type ObjectTools = Pick<DrawingTools, "placeObject" | "moveObject" | "breakApart" | "placeSet" | "setConfiguration" | "setStair" | "setSize" | "setZones" | "setOpensInto" | "setDesk" | "setChairs">;

/** `on` as a surface: null for the floor, the deck's ID, or the refusal naming an unknown deck. */
function surfaceOf(doc: Document, on: string): Result<string | null, string> {
  if (on === "floor") return ok(null);
  return deckView(doc, on) === null ? err(noDeck(on)) : ok(on);
}

/**
 * Where a single piece put somewhere new by position lands (decks.11): the editor's own question (`pieceLandsOn`, what
 * the Object tool's ghost and a drag ask), so the piece's role goes with it: a stair's pose, a wheel well, a beam, a
 * seat's tuck, a rug. At the floor level (levels.08), where landing always answers a surface.
 */
function landsOn(
  doc: Document,
  piece: { state: string; kind: string; config: string; w: number; d: number; arms?: Arms; riser?: number | null; heights: Heights; current: string | null | undefined; ignore: readonly string[] },
  at: Point,
  rotation: number,
): string | null {
  const asked = { kind: piece.kind, config: piece.config, ...(piece.arms === undefined ? {} : { arms: piece.arms }), riser: piece.riser ?? null, heights: piece.heights, ignore: piece.ignore, level: levelOf(doc, null), land: true as const, current: piece.current };
  const landed = pieceLandsOn(doc, piece.state, asked, { w: piece.w, d: piece.d }, at, rotation);
  switch (landed.kind) {
    case "surface":
      return landed.deck;
    case "none": // the floor level always has the floor
      return null;
    default:
      return assertNever(landed);
  }
}

/** The configuration IDs of an object's kind, or the refusal naming the ones it has. */
function checkConfig(o: LayoutObject, config: string): string | null {
  const ids = configsOf(o).map((c) => c.id);
  return ids.includes(config) ? null : `${o.name} has the configurations ${ids.join(", ")}`;
}

/** A kind's preset by the name Claude gives it (preset-names.ts), or the refusal naming the ones it has. */
function presetIn(kind: ObjectKind, name: string): Result<Preset, string> {
  const preset = presetNamed(kind.id, name);
  if (preset !== null) return ok(preset);
  const names = presetNamesOf(kind.id);
  return err(names.length === 0 ? `${kind.label} has no presets` : `${kind.label} has the presets ${names.join(", ")}`);
}

export function objectTools({ session, editReply, edit }: ToolKit): ObjectTools {
  /**
   * A group move (mcp-fixes.02): the pieces of one layout moved and turned as the canvas's group drag and R do, about
   * the centre of their footprints' box, then by the offset that puts that centre at `at`; one movePlacements, so the
   * fit is checked once, at the end, and nothing moves if a piece doesn't fit. Each piece keeps its surface.
   */
  async function moveGroup(doc: Document, state: string, objects: readonly string[], at: Point | undefined, turn: number): Promise<Reply> {
    if (![0, 90, 180, 270].includes(turn)) return fail("turn is 0, 90, 180 or 270");
    const ref = stateRef(doc, state);
    if (ref === null) return fail(noLayout(state));
    const ids: string[] = [];
    for (const object of objects) {
      const found = placementIn(doc, state, object);
      if (!found.ok) return fail(found.error);
      ids.push(found.value.placement.id);
    }
    const c = groupCentre(doc, ids);
    const offset = at === undefined ? { x: 0, y: 0 } : { x: at.x - c.x, y: at.y - c.y };
    const moves = turnedPlaces(doc, ids, c, turn, offset);
    if (moves === null) return fail("A piece of the group has no footprint");
    return edit({ type: "movePlacements", moves }, () => at ?? c, () => ({ objects: [...objects], layout: ref }));
  }

  /** Where an edit to a whole object happened: the centre of its first placement, read after the edit. */
  function objectCentre(doc: Document, objectId: string): () => Point | null {
    const first = sortedIds(doc.placements).find((id) => doc.placements[id]?.object === objectId);
    return () => (first === undefined ? null : centreOf(session.drawing(), first));
  }
  /** Turns an object's option on or off (library.10); the domain answers for a kind that doesn't list it. */
  async function setOption(object: string, option: ObjectOption, on: boolean): Promise<Reply> {
    const doc = session.drawing();
    if (doc === null) return fail(NO_DRAWING);
    if (objectOf(doc, object) === null) return fail(noObject(object));
    return edit({ type: "setOption", objectId: object, option, on }, objectCentre(doc, object), () => ({ object }));
  }

  return {
    async placeObject({ layout: state, kind, centre: at, rotation = 0, name, preset, on, reaches, height, width: givenWidth, depth: givenDepth, everyLayout }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const ref = stateRef(doc, state);
      if (ref === null) return fail(noLayout(state));
      const k = kindOf(kind);
      if (k === null) return fail(`Unknown kind ${kind}`);
      if (k.retired) return fail(`${k.label} (${k.id}) is retired: stored ones stay, new ones can't be placed`);
      // everyLayout is placeObject's link (mcp-fixes.05); a stair, beam or wheel well stands in every layout.
      if (everyLayout === false && inEveryLayout(kind)) return fail(`A ${k.label.toLowerCase()} stands in every layout: place it without everyLayout false`);
      const p = preset === undefined ? null : presetIn(k, preset);
      if (p !== null && !p.ok) return fail(p.error);
      // A size of its own (sizing.11 d): both or neither; a stair's size is its run and rise.
      if (givenWidth !== undefined && givenDepth === undefined) return fail("Give depth with width");
      if (givenDepth !== undefined && givenWidth === undefined) return fail("Give width with depth");
      const sized = givenWidth !== undefined && givenDepth !== undefined ? { w: givenWidth, d: givenDepth } : null;
      if (sized !== null && k.stair !== null) return fail("A stair's size comes from its run and rise: place it without width and depth, then use set_stair");
      // The anchor is the back edge of the footprint the object is placed with: the first configuration's, sized and
      // raised as placeObject sizes it (its preset's heights, catalog.07, else its kind's).
      const first = kindConfigs(kind)[0]?.id;
      const size = p === null ? defaultSize(kind) : presetSize(kind, p.value.id);
      const depth = sized?.d ?? (first === undefined ? undefined : size?.d[first]);
      const width = sized?.w ?? (first === undefined ? undefined : size?.w[first]);
      const own = first === undefined || size === null ? null : heightsOf(size, first);
      if (first === undefined || depth === undefined || width === undefined || own === null) return fail(`Unknown kind ${kind}`);
      const heights = height === undefined ? own : { ...own, h: height };
      const anchor = anchorAtMm(at, depth, rotation);
      const given = on === undefined ? null : surfaceOf(doc, on);
      if (given !== null && !given.ok) return fail(given.error);
      const deck = given !== null ? given.value : landsOn(doc, { state, kind, config: first, w: width, d: depth, heights, current: undefined, ignore: [] }, anchor, rotation);
      if (reaches !== undefined && deckView(doc, reaches) === null) return fail(noDeck(reaches));
      const opId = session.newId();
      const command: Command = {
        type: "placeObject",
        opId,
        state,
        object: { kind, ...(name === undefined ? {} : { name }), ...(p === null || !p.ok ? {} : { preset: p.value.id }), ...(height === undefined && sized === null ? {} : { size: { w: width, d: depth, ...(height === undefined ? {} : { h: height }) } }) },
        at: anchor,
        rotation,
        deck,
        ...(reaches === undefined ? {} : { reaches }),
        ...(everyLayout === undefined ? {} : { linked: everyLayout }),
      };
      return edit(command, () => at, (patch) => {
        const object = createdIn(patch, "objects");
        const after = session.drawing();
        const note = after === null ? null : placeNote(doc, after, command, state); // one layout only (review.06)
        return { ...(object === undefined ? {} : { object }), layout: ref, ...(note === null ? {} : { note }) };
      });
    },
    async moveObject({ layout: state, object, objects, turn: groupTurn, centre: at, rotation, on, reaches, everyLayout }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (objects !== undefined) {
        if (object !== undefined) return fail("Pass object or objects, not both");
        if (rotation !== undefined || on !== undefined || reaches !== undefined || everyLayout !== undefined) {
          return fail("A group takes centre and turn: move a piece alone for rotation, on, reaches or everyLayout");
        }
        return moveGroup(doc, state, objects, at, groupTurn ?? 0);
      }
      if (object === undefined) return fail("Pass object, or objects for a group");
      if (groupTurn !== undefined) return fail("turn moves a group: pass objects, or rotation for one piece");
      const found = placementIn(doc, state, object);
      if (!found.ok) return fail(found.error);
      const { placement: p, state: ref } = found.value;
      // The link (review.07), as the Properties switch sets it: alone, or with a move as two edits, unlinked before
      // the move and linked after it, so the move is this layout's and a link copies where it ended up. The two are
      // checked together on the current drawing before either is sent (`editAll`): a refused one leaves nothing done.
      const link = (linked: boolean): Command => ({ type: "setLinked", placementId: p.id, on: linked });
      const moving = at !== undefined || rotation !== undefined || on !== undefined || reaches !== undefined;
      if (everyLayout !== undefined && !moving) return edit(link(everyLayout), () => centreOf(doc, p.id), () => ({ object, layout: ref }));
      const o = objectOf(doc, object);
      const centre = at ?? centreOf(doc, p.id);
      const depth = depthOf(doc, p);
      const width = o?.w[p.config];
      const heights = o === null ? null : heightsOf(o, p.config);
      if (o === null || centre === null || depth === null || width === undefined || heights === null) return fail(noObject(object));
      const given = on === undefined ? null : surfaceOf(doc, on);
      if (given !== null && !given.ok) return fail(given.error);
      const turn = rotation ?? p.rotation;
      // Neither moved nor turned: keep the stored anchor exactly, so nothing drifts by rounding.
      const unchanged = at === undefined && ((turn % 360) + 360) % 360 === p.rotation;
      const anchor = unchanged ? p.at : anchorAtMm(centre, depth, turn);
      // A piece put somewhere new by position lands (decks.11); one left in place keeps its surface unless `on` names one.
      const piece = { state, kind: o.kind, config: p.config, w: width, d: depth, arms: o.arms, riser: o.riser ?? null, heights, current: p.deck, ignore: [p.id] };
      const deck = given !== null ? given.value : unchanged ? undefined : landsOn(doc, piece, anchor, turn);
      if (reaches !== undefined && reaches !== "nothing" && deckView(doc, reaches) === null) return fail(noDeck(reaches));
      const reached = reaches === undefined ? {} : { reaches: reaches === "nothing" ? null : reaches };
      const move: Command = { type: "movePlacement", placementId: p.id, at: anchor, rotation: turn, ...(deck === undefined ? {} : { deck }), ...reached };
      if (everyLayout === undefined) return edit(move, () => centre, () => ({ object, layout: ref }));
      const commands = everyLayout ? [move, link(true)] : [link(false), move];
      const r = await session.editAll(commands);
      if (r.ok) {
        session.pointAt(centre);
        return editReply(doc, r.value, { object, layout: ref });
      }
      const { error, done, refused } = r.error;
      if (refused) return fail(error); // checked together on the current drawing: nothing was sent
      return fail(done === 0 ? error : `${error} (after ${done} of ${commands.length} changes)`);
    },
    async setConfiguration({ layout: state, object, config }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const found = placementIn(doc, state, object);
      if (!found.ok) return fail(found.error);
      const { placement: p, state: ref } = found.value;
      const o = objectOf(doc, object);
      const refused = o === null ? noObject(object) : checkConfig(o, config);
      if (refused !== null) return fail(refused);
      return edit({ type: "setConfiguration", placementId: p.id, config }, () => centreOf(session.drawing(), p.id), () => ({ object, layout: ref }));
    },
    async setSize({ object, preset, config, width, depth, height, elevation, backArm, leftArm }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const heights = height !== undefined || elevation !== undefined;
      const armsGiven = backArm !== undefined || leftArm !== undefined;
      if (preset !== undefined && (config !== undefined || width !== undefined || depth !== undefined || heights || armsGiven)) {
        return fail("Pass either a preset, or a size (width, depth, height, elevation, config, arms), not both");
      }
      if (preset === undefined && width === undefined && depth === undefined && !heights && !armsGiven) return fail("Pass a preset, or width and depth, or a height, elevation or arm");
      const o = objectOf(doc, object);
      if (o === null) return fail(noObject(object));
      // The arms go in the same size command as the width and depth, checked once with them (catalog.18).
      const current = armsOf(o);
      if (armsGiven && current === null) return fail(MESSAGES.noArms);
      const arms = armsGiven && current !== null ? { arms: { back: backArm ?? current.back, left: leftArm ?? current.left } } : {};
      if (preset !== undefined) {
        const k = kindOf(o.kind);
        const p = k === null ? err(`${o.name} has no presets`) : presetIn(k, preset);
        if (!p.ok) return fail(p.error);
        const size = presetSize(o.kind, p.value.id, o); // its heights where it gives them, else the piece's (catalog.07)
        if (size === null) return fail(noObject(object));
        return edit({ type: "setObjectSize", objectId: object, w: p.value.w, d: size.d, h: size.h, z: size.z }, objectCentre(doc, object), () => ({ object }));
      }
      if ((width === undefined) !== (depth === undefined)) return fail("Pass both width and depth");
      const configs = configsOf(o).map((c) => c.id);
      const only = configs.length === 1 ? configs[0] : undefined;
      const which = config ?? only;
      if (which === undefined) return fail(`${o.name} has the configurations ${configs.join(", ")}: pass config`);
      const refused = checkConfig(o, which);
      if (refused !== null) return fail(refused);
      // Heights or arms alone keep the width (every configuration shares it) and every depth.
      const w = width ?? o.w[which];
      if (w === undefined) return fail(noObject(object));
      return edit({
        type: "setObjectSize", objectId: object, w, d: depth === undefined ? {} : { [which]: depth },
        ...(height === undefined ? {} : { h: { [which]: height } }),
        ...(elevation === undefined ? {} : { z: { [which]: elevation } }),
        ...arms,
      }, objectCentre(doc, object), () => ({ object }));
    },
    async setZones({ layout: state, object, ...args }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const found = placementIn(doc, state, object);
      if (!found.ok) return fail(found.error);
      const { placement: p, state: ref } = found.value;
      const o = objectOf(doc, object);
      if (o === null) return fail(noObject(object));
      if (configsOf(o).every((c) => c.zone === null)) return fail(`${o.name} (${o.id}) has no use zone`);
      const given: Record<Side, ZoneArg | undefined> = { front: args.front, back: args.back, left: args.left, right: args.right };
      // A boolean turns its side on or off; "default" and numbers turn it on; a side left out stays as it is.
      const on = (side: Side): boolean => {
        const arg = given[side];
        return arg === undefined ? p.sides[side] : typeof arg === "boolean" ? arg : true;
      };
      const commands: Command[] = [{ type: "setZoneSides", placementId: p.id, sides: { front: on("front"), back: on("back"), left: on("left"), right: on("right") } }];
      for (const side of SIDE_IDS) {
        const arg = given[side];
        if (arg === undefined || typeof arg === "boolean") continue;
        if (arg === "default") {
          commands.push({ type: "setZoneExtent", placementId: p.id, side, extent: null });
          continue;
        }
        // Read as on: the side may be about to turn on, and zoneExtent is null for a side that is off.
        const now = zoneExtent(doc, { ...p, sides: withSide(p.sides, side, true) }, side);
        const { depth = now?.depth, start = now?.start, end = now?.end } = arg;
        if (depth === undefined || start === undefined || end === undefined) {
          return fail(`${o.name} (${o.id}) has no use zone in this configuration: pass depth, start and end`);
        }
        commands.push({ type: "setZoneExtent", placementId: p.id, side, extent: { depth, start, end } });
      }
      const r = await session.editAll(commands);
      if (r.ok) {
        const centre = centreOf(session.drawing(), p.id);
        if (centre !== null) session.pointAt(centre);
        return editReply(doc, r.value, { object, layout: ref });
      }
      const { error, done, refused } = r.error;
      if (refused) return fail(error); // checked together on the current drawing: nothing was sent
      return fail(done === 0 ? error : `${error} (after ${done} of ${commands.length} changes)`);
    },
    async setOpensInto({ object, into }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const o = objectOf(doc, object);
      if (o === null) return fail(noObject(object));
      const units = familyKinds("builtIn");
      if (kindOf(o.kind)?.family !== "builtIn") return fail(`${o.name} (${o.id}) is not a built-in unit`);
      const kind = units.find((k) => k.opensInto?.toLowerCase() === into);
      if (kind === undefined) return fail(`A built-in unit opens into ${units.flatMap((k) => k.opensInto?.toLowerCase() ?? []).join(", ")}`);
      return edit({ type: "setObjectKind", objectId: object, kind: kind.id }, objectCentre(doc, object), () => ({ object }));
    },
    async setStair({ object, riser, going, handrail, handrailLeft: left, handrailRight: right, hooks, leftEntry }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if ([riser, going, handrail, left, right, hooks, leftEntry].every((v) => v === undefined)) return fail("Pass a riser, a going, a handrail, hooks, leftEntry or several");
      const o = objectOf(doc, object);
      if (o === null) return fail(noObject(object));
      const sides = { ...(left === undefined ? {} : { handrailLeft: left }), ...(right === undefined ? {} : { handrailRight: right }) };
      const options = { ...(hooks === undefined ? {} : { hooks }), ...(leftEntry === undefined ? {} : { leftEntry }) };
      const values = { ...(riser === undefined ? {} : { riser }), ...(going === undefined ? {} : { going }), ...(handrail === undefined ? {} : { handrail }), ...sides, ...options };
      return edit({ type: "setStair", objectId: object, ...values }, objectCentre(doc, object), () => ({ object }));
    },
    setDesk: ({ object, computer }) => setOption(object, "computer", computer),
    setChairs: ({ object, round }) => setOption(object, "roundChairs", round),
    async placeSet({ set, layout: state, centre: at, rotation = 0 }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const ref = stateRef(doc, state);
      if (ref === null) return fail(noLayout(state));
      const found = furnitureSet(set);
      if (found === undefined) return fail(`Unknown set ${set}`);
      const { w, d } = setBox(found);
      const anchor = anchorAtMm(at, d, rotation);
      // The whole box lands as one piece: a block as tall as the set's tallest piece, on the floor or one deck (seated.11).
      const deck = landsOn(doc, { state, kind: "block", config: "standard", w, d, heights: { h: setHeight(found), z: 0 }, current: undefined, ignore: [] }, anchor, rotation);
      return edit({ type: "placePieces", opId: session.newId(), pieces: setPieces(found, anchor, rotation, state, deck) }, () => at, (patch) => ({
        objects: (patch?.puts ?? []).filter((p) => p.table === "objects").map((p) => p.entity.id),
        layout: ref,
      }));
    },
    async breakApart({ object }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (objectOf(doc, object) === null) return fail(noObject(object));
      const broken = brokenApart(doc, object);
      if (!broken.ok) return fail(broken.error);
      const near = objectCentre(doc, object)(); // read now: the set is gone after the edit
      return edit({ type: "placePieces", opId: session.newId(), ...broken.value }, () => near, (patch) => ({
        objects: (patch?.puts ?? []).filter((p) => p.table === "objects").map((p) => p.entity.id),
      }));
    },
  };
}
