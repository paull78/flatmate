import { deepEqual, err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { armsFor, armsOf, parseArms } from "../arms";
import { MESSAGES, domainError } from "../errors";
import { lowerable } from "../lowering";
import { MAX_OBJECT_SIZE, canSwitchKind, configOf, configsOf, defaultSides, defaultSize, isElevation, isObjectHeight, isObjectSize, isSide, kindConfigs, kindOf, presetSize, stairRuleOf, type OrCeiling, type Sides } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId, isValidName, parseSides, parseZoneExtents } from "../shape";
import { finish, givenSurface, key, normaliseRotation, parseExtentArg, placementDeps, placementsOf, validPoint } from "./object-helpers";
import { roundMm, zoneLength } from "../queries/footprints";
import { newSides } from "../queries/stair-edge";
import { squareSize } from "../queries/stairs";
import { MIN_ZONE_SIZE, SIDE_ZONE_KEYS, nullZones, withZoneExtent } from "../use-zone";
import { withoutOptions } from "../options";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { syncDeps, syncLinkedCopies } from "./linked-copies";
import { placeLinked, withLink } from "./link";
import { linkStair, stairDeps } from "./stairs";
import type { CommandOf, CommandResult } from "./types";

// Object and placement commands (spec: layouts). Each result is validated, so fit (I10, I11) refuses an edit with a
// message naming the object and the state.

/**
 * Places a new object of a kind (`${opId}/o0`, the default sizes, a preset's or a drawn size, the kind's label as
 * name) or an existing object in a state where it has no placement yet; the placement is `${opId}/p0`, with the kind's
 * default sides. A preset sets every configuration's size, and its height and elevation where it gives them, in the
 * same command (`presetSize`), so fit checks the preset's piece. A drawn `size` sets the width of every configuration
 * and the depth of the first; the others keep the kind's default depth (furnish.04), or the preset's when one is
 * given with it, whose heights the drawn piece takes (the Object tool's drawn ghost, catalog.07). A `size` with `h`
 * sets the height of a kind that may be lowered (`lowerable`), refused on any other; validation does the rest.
 */
export function placeObject(doc: Document, cmd: CommandOf<"placeObject">): CommandResult {
  // An existing object placed again keeps its link; a new one links when it fits everywhere (review.06).
  return "existing" in cmd.object ? placeOnce(doc, cmd, false) : placeLinked(cmd.linked, (link) => placeOnce(doc, cmd, link));
}

/** placeObject with a new object linked or not (`link`), or an existing object placed in one more layout. */
function placeOnce(doc: Document, cmd: CommandOf<"placeObject">, link: boolean): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  const state = isValidId(cmd.state) ? doc.states[cmd.state] : undefined;
  if (!state) return err(domainError("notFound", "Layout not found"));
  if (!validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const rotation = normaliseRotation(cmd.rotation ?? 0);
  if (rotation === null) return err(domainError("invalidInput", "Invalid rotation"));
  const deck = givenSurface(doc, cmd.deck);
  if (deck === undefined) return err(domainError("notFound", "Deck not found"));

  let object: LayoutObject;
  const deps: EntityKey[] = [key("states", state.id), ...(deck === null ? [] : [key("decks", deck)])];
  if ("existing" in cmd.object) {
    const found = isValidId(cmd.object.existing) ? doc.objects[cmd.object.existing] : undefined;
    if (!found) return err(domainError("notFound", "Object not found"));
    if (Object.values(doc.placements).some((p) => p.object === found.id && p.state === state.id)) {
      return err(domainError("invalidInput", "Already placed in this state"));
    }
    object = found;
    deps.push(key("objects", found.id), ...placementsOf(doc, found.id).map((id) => key("placements", id)));
  } else {
    const kind = kindOf(cmd.object.kind);
    if (!kind) return err(domainError("invalidInput", "Unknown kind"));
    const name = cmd.object.name ?? kind.label;
    if (!isValidName(name)) return err(domainError("invalidInput", "Name too long"));
    const wanted = cmd.object.preset;
    const drawn = cmd.object.size;
    if (drawn !== undefined && (!isObjectSize(drawn.w) || !isObjectSize(drawn.d))) return err(domainError("invalidInput", MESSAGES.objectSize));
    const sizes = wanted === undefined ? defaultSize(kind.id) : presetSize(kind.id, wanted);
    if (!sizes) return err(domainError("invalidInput", "Unknown preset"));
    if (drawn !== undefined) {
      // A drawn footprint (furnish.04): one width for every configuration (smart.05), its depth for the first only.
      const side = squareSize(stairRuleOf(kind.id), drawn, drawn); // a spiral's box stays square (stairs.21)
      kindConfigs(kind.id).forEach((c, i) => {
        sizes.w[c.id] = drawn.w;
        if (i === 0) sizes.d[c.id] = side ?? drawn.d;
      });
    }
    if (drawn?.h !== undefined) { // a piece lowered to fit (clarity.06): the height wins over a preset's, the elevation stays
      const h = roundMm(drawn.h);
      if (!lowerable(kind.id)) return err(domainError("invalidInput", MESSAGES.fixedHeight));
      if (!isObjectHeight(h)) return err(domainError("invalidInput", MESSAGES.objectHeight));
      for (const c of kindConfigs(kind.id)) sizes.h[c.id] = h;
    }
    // A stair starts unlinked (stairs.10); an `L` kind's object takes the kind's arms (catalog.17), clamped into its
    // box as its ghost fits them, so a drawn or typed size places what its ghost shows (sizing.04).
    const first = kindConfigs(kind.id)[0]?.id;
    const box = first === undefined ? undefined : { w: sizes.w[first], d: sizes.d[first] };
    const arms = kind.arms === null ? null : box?.w !== undefined && box.d !== undefined ? armsFor(kind.id, box.w, box.d) : { ...kind.arms };
    object = withLink({ id: `${cmd.opId}/o0`, kind: kind.id, name, ...sizes, ...(kind.stair === null ? {} : { reaches: null, startsAt: null }), ...(arms === null ? {} : { arms }) }, link);
  }
  const config = cmd.config ?? configsOf(object)[0]?.id;
  if (!config || !configOf(object, config)) return err(domainError("invalidInput", "Unknown configuration"));
  const sides = defaultSides(object.kind);
  if (!sides) return err(domainError("invalidInput", "Unknown kind"));
  const placement: Placement = {
    id: `${cmd.opId}/p0`, object: object.id, state: state.id, at: { x: cmd.at.x, y: cmd.at.y }, rotation, config, sides, zones: nullZones(), deck,
  };
  const next: Document = {
    ...doc,
    objects: { ...doc.objects, [object.id]: object },
    placements: { ...doc.placements, [placement.id]: placement },
  };
  const linked = linkStair(next, placement.id, cmd.reaches);
  if (!linked.ok) return linked;
  const placedSides = entrySidesOf(linked.value, placement.id); // a spiral's from its rise once linked (edge-catch.10)
  const lp = linked.value.placements[placement.id];
  const out = placedSides && lp ? { ...linked.value, placements: { ...linked.value.placements, [placement.id]: { ...lp, sides: placedSides } } } : linked.value;
  return finish(doc, out, [...deps, ...stairDeps(out, object.id)]);
}

export function movePlacement(doc: Document, cmd: CommandOf<"movePlacement">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  if (!p) return err(domainError("notFound", "Placement not found"));
  if (!validPoint(cmd.at)) return err(domainError("invalidInput", "Invalid position"));
  const rotation = normaliseRotation(cmd.rotation);
  if (rotation === null) return err(domainError("invalidInput", "Invalid rotation"));
  const deck = cmd.deck === undefined ? p.deck : givenSurface(doc, cmd.deck);
  if (deck === undefined) return err(domainError("notFound", "Deck not found"));
  const still = p.at.x === cmd.at.x && p.at.y === cmd.at.y && p.rotation === rotation && p.deck === deck;
  if (still && cmd.reaches === undefined) return ok({ doc, patch: diffPatch(doc, doc, placementDeps(p)) });
  const moved: Placement = { ...p, at: { x: cmd.at.x, y: cmd.at.y }, rotation, deck };
  const linked = linkStair({ ...doc, placements: { ...doc.placements, [p.id]: moved } }, p.id, cmd.reaches);
  if (!linked.ok) return linked;
  const deps = [...placementDeps(p), ...(deck !== null && deck !== p.deck ? [key("decks", deck)] : []), ...stairDeps(linked.value, p.object)];
  return finish(doc, linked.value, deps);
}

export function setConfiguration(doc: Document, cmd: CommandOf<"setConfiguration">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  const object = p ? doc.objects[p.object] : undefined;
  if (!p || !object) return err(domainError("notFound", "Placement not found"));
  if (!configOf(object, cmd.config)) return err(domainError("invalidInput", "Unknown configuration"));
  if (p.config === cmd.config) return ok({ doc, patch: diffPatch(doc, doc, placementDeps(p)) });
  return finish(doc, { ...doc, placements: { ...doc.placements, [p.id]: { ...p, config: cmd.config } } }, placementDeps(p));
}

/**
 * An object's width, written to every configuration (smart.05), and the depths, heights and elevations given per
 * configuration (heights kept to the millimetre, heights.09), in every state where it is placed, as one patch
 * (smart.16). `d: {}` sets the width only; a spiral's depth follows its width (stairs.21). Shared width is a rule of the size commands, not an invariant: a piece
 * stored with different widths is aligned by its next setObjectSize. An `L` piece's `arms`, when given, are its final
 * arms, checked once with the final sizes (catalog.18).
 */
export function setObjectSize(doc: Document, cmd: CommandOf<"setObjectSize">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  const depths = Object.entries(cmd.d);
  const heights = Object.entries(cmd.h ?? {}).map(([id, v]): [string, number] => [id, roundMm(v)]);
  const elevations = Object.entries(cmd.z ?? {}).map(([id, v]): [string, unknown] => [id, isFiniteNumber(v) ? roundMm(v) : v]);
  if ([...depths, ...heights, ...elevations].some(([id]) => !configOf(object, id))) return err(domainError("invalidInput", "Unknown configuration"));
  if (!isObjectSize(cmd.w) || depths.some(([, v]) => !isObjectSize(v))) return err(domainError("invalidInput", MESSAGES.objectSize));
  if (heights.some(([, v]) => !isObjectHeight(v))) return err(domainError("invalidInput", MESSAGES.objectHeight)); // from 0.01 (catalog.22)
  // Commands come from JSON: two finite numbers, only on an `L` piece; their bounds are validation's (catalog.18, .26).
  const arms = cmd.arms === undefined ? undefined : parseArms(cmd.arms);
  if (arms !== undefined && armsOf(object) === null) return err(domainError("invalidInput", MESSAGES.noArms));
  if (arms === null) return err(domainError("invalidInput", "Invalid arms"));
  const z: Record<string, OrCeiling> = { ...object.z };
  for (const [id, v] of elevations) if (isElevation(v)) z[id] = v; else return err(domainError("invalidInput", MESSAGES.elevation));
  const deps = [key("objects", object.id), ...placementsOf(doc, object.id).map((id) => key("placements", id))];
  const w: Record<string, number> = { ...object.w };
  const d: Record<string, number> = { ...object.d };
  const h: Record<string, number> = { ...object.h, ...Object.fromEntries(heights) };
  for (const c of configsOf(object)) w[c.id] = cmd.w;
  for (const [id, depth] of depths) d[id] = depth; // a configuration id of the kind, checked above
  for (const c of configsOf(object)) { // a spiral's box stays square (stairs.21): the side that changed sets both
    const side = squareSize(stairRuleOf(object.kind), { w: object.w[c.id] ?? cmd.w, d: object.d[c.id] ?? cmd.w }, { w: cmd.w, d: d[c.id] ?? cmd.w });
    if (side !== null) [w[c.id], d[c.id]] = [side, side];
  }
  const next = { ...object, w, d, h, z, ...(arms === undefined ? {} : { arms }) };
  if (deepEqual(next, object)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  return finish(doc, { ...doc, objects: { ...doc.objects, [object.id]: next } }, deps);
}

/** A stair's copy without its target riser: another kind has other bounds (riser.11). */
function withoutTarget(object: LayoutObject): LayoutObject {
  const plain: LayoutObject = { ...object };
  delete plain.riser;
  return plain;
}

/**
 * Switches an object to another kind that `canSwitchKind` allows (furnish.17): both share their configuration ids, so
 * the widths and depths stay, as an `L`'s arms do (only to another `L` kind, catalog.28), while heights and elevations become the new kind's (heights.24): a height belongs to the
 * mechanism, except a linked stair's, which stays its rise (stairdraw.03). Fit can refuse it then (a Murphy bed under a
 * 2.20 ceiling). A name still equal to the old kind's label takes the new kind's label; a name the user chose stays
 * (smart.38), and every option goes (seating.12, library.10). Between single-configuration kinds every placement's use-zone
 * sides become the new kind's defaults and its stored zones null, in every state; a built-in unit's Opens into keeps
 * both (smart.21, furnish.21).
 */
export function setObjectKind(doc: Document, cmd: CommandOf<"setObjectKind">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  const kind = kindOf(cmd.kind);
  if (!kind) return err(domainError("invalidInput", "Unknown kind"));
  const deps = [key("objects", object.id), ...placementsOf(doc, object.id).map((id) => key("placements", id)), ...stairDeps(doc, object.id)];
  if (kind.id === object.kind) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const old = kindOf(object.kind);
  if (!canSwitchKind(object.kind, kind.id)) return err(domainError("invalidInput", `Can't switch ${old?.label ?? object.kind} to ${kind.label}`));
  const name = object.name === old?.label ? kind.label : object.name;
  const defaults = defaultSize(kind.id);
  if (!defaults) return err(domainError("invalidInput", "Unknown kind"));
  // A spiral's box is square (stairs.21), and a flight's length means nothing to it: it takes the kind's own size.
  const squared = stairRuleOf(kind.id)?.shape === "spiral" ? { w: defaults.w, d: defaults.d } : {};
  // Any switch drops the options, even to a kind that takes them (seating.12, library.10).
  const switched = { ...doc, objects: { ...doc.objects, [object.id]: { ...withoutTarget(withoutOptions(object)), kind: kind.id, name, h: defaults.h, z: defaults.z, ...squared } } };
  // A linked stair's height stays the rise its link gives (stairdraw.03).
  const relinked = linkStair(switched, placementsOf(doc, object.id)[0] ?? "", undefined);
  if (!relinked.ok) return relinked;
  if (kindConfigs(kind.id).length !== 1) return finish(doc, relinked.value, deps);
  // Between single-configuration kinds the sides and zones become the new kind's defaults in every state.
  const placements = { ...doc.placements };
  for (const id of placementsOf(doc, object.id)) {
    const p = placements[id];
    if (p) placements[id] = { ...p, sides: entrySidesOf(relinked.value, id) ?? { ...kind.sides }, zones: nullZones() };
  }
  return finish(doc, { ...relinked.value, placements }, deps);
}

/**
 * Turns a placement's use-zone sides on or off, in its layout only. Allowed in any configuration: a state with no zone
 * keeps the toggles (spec "Use zones by side"). It ends in finish, since a stair's copies must keep equal sides (I19).
 */
export function setZoneSides(doc: Document, cmd: CommandOf<"setZoneSides">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  if (!p) return err(domainError("notFound", "Placement not found"));
  const sides = parseSides(cmd.sides); // MCP and the editor build commands from JSON
  if (!sides) return err(domainError("invalidInput", "Invalid sides"));
  const deps = placementDeps(p);
  const same = p.sides.front === sides.front && p.sides.back === sides.back && p.sides.left === sides.left && p.sides.right === sides.right;
  if (same) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, placements: { ...doc.placements, [p.id]: { ...p, sides } } };
  return finish(doc, next, deps); // a stair's copies follow (stairs.18, stairdraw.46)
}

/**
 * Sets one side's use zone of one placement, in its layout only (furnish.14, .20): a depth and two insets from the
 * side's corners (front and back from the left corner, left and right from the back corner), stored as given, or null
 * for the kind's default. The limits are measured on the side (an `L` front's on each strip) in the current configuration; other
 * configurations clamp when read. Allowed in any configuration, like setZoneSides. It depends on the placement, its
 * object and its state (spec: layouts), so it conflicts with a concurrent resize. Zones take part only in I19 (a stair's copies keep equal zones).
 */
export function setZoneExtent(doc: Document, cmd: CommandOf<"setZoneExtent">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  if (!p) return err(domainError("notFound", "Placement not found"));
  const side: unknown = cmd.side; // MCP and the editor build commands from JSON
  if (!isSide(side)) return err(domainError("invalidInput", "Invalid zone"));
  const extent = cmd.extent === null ? null : parseExtentArg(cmd.extent);
  if (cmd.extent !== null && !extent) return err(domainError("invalidInput", "Invalid zone"));
  if (extent) {
    // 1e-9, not EPS: a zone 0.0995 m long is still refused, and 1.2 − 0.55 − 0.55 still passes.
    if (extent.depth > MAX_OBJECT_SIZE) return err(domainError("invalidInput", "Invalid zone"));
    if (extent.depth < MIN_ZONE_SIZE - 1e-9) return err(domainError("invalidInput", "A use zone is at least 0.10 m deep"));
    if (extent.start < 0 || extent.end < 0) return err(domainError("invalidInput", "A use zone can't run past its side"));
    const length = zoneLength(doc, p, side, extent.start, extent.end); // an `L` front: its shorter strip (catalog.13)
    if (length === null) return err(domainError("notFound", "Object not found"));
    if (length < MIN_ZONE_SIZE - 1e-9) return err(domainError("invalidInput", "A use zone is at least 0.10 m long"));
  }
  const deps = placementDeps(p);
  // A depth within 1e-9 under the minimum is stored as the minimum, which the load parser accepts (furnish.53); + 0
  // turns an inset of −0 into 0, which JSON would do on the wire anyway, so every client stores the same number.
  const zones = withZoneExtent(p.zones, side, extent && { depth: Math.max(extent.depth, MIN_ZONE_SIZE), start: extent.start + 0, end: extent.end + 0 });
  if (SIDE_ZONE_KEYS[side].every((k) => zones[k] === p.zones[k])) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  // The load parser's bounds too, so no row is written that it would refuse.
  if (!parseZoneExtents(zones)) return err(domainError("invalidInput", "Invalid zone"));
  const next: Document = { ...doc, placements: { ...doc.placements, [p.id]: { ...p, zones } } };
  return finish(doc, next, deps); // a stair's copies follow (stairs.18, stairdraw.46)
}

export function renameObject(doc: Document, cmd: CommandOf<"renameObject">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const deps = [key("objects", object.id)];
  if (object.name === cmd.name) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  // A name takes part only in I8; shape-checked above, like labels (spec: walls-rooms).
  const next: Document = { ...doc, objects: { ...doc.objects, [object.id]: { ...object, name: cmd.name } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Removes placements; an object left with none in any state goes too, in the same patch (layout-states.17). Shared
 * by removePlacement, deleteState and deleteEntities.
 */
export function withoutPlacements(doc: Document, ids: ReadonlySet<string>, deps: EntityKey[]): Document {
  if (ids.size === 0) return doc;
  const placements = { ...doc.placements };
  const touched = new Set<string>();
  for (const id of ids) {
    const p = placements[id];
    if (!p) continue;
    delete placements[id];
    touched.add(p.object);
    deps.push(key("placements", id), key("objects", p.object));
  }
  const objects = { ...doc.objects };
  const stillPlaced = new Set(Object.values(placements).map((p) => p.object));
  for (const objectId of touched) if (!stillPlaced.has(objectId)) delete objects[objectId];
  // Every other placement of a touched object: a concurrent placement elsewhere must conflict with the removal.
  for (const objectId of touched) for (const id of placementsOf(doc, objectId)) deps.push(key("placements", id));
  return { ...doc, placements, objects };
}

export function removePlacement(doc: Document, cmd: CommandOf<"removePlacement">): CommandResult {
  const p = isValidId(cmd.placementId) ? doc.placements[cmd.placementId] : undefined;
  if (!p) return err(domainError("notFound", "Placement not found"));
  const deps: EntityKey[] = [];
  const bare = withoutPlacements(doc, new Set([p.id]), deps);
  const next = syncLinkedCopies(doc, bare); // a stair removed in one layout goes from every layout (stairs.18)
  return ok({ doc: next, patch: diffPatch(doc, next, [...deps, ...syncDeps(bare, next)]) });
}

/** The sides `newSides` gives the placement's piece at its configuration's height in `doc` (after any link), or null. */
function entrySidesOf(doc: Document, placementId: string): Sides | null {
  const p = doc.placements[placementId];
  const o = p ? doc.objects[p.object] : undefined;
  const h = p && o ? o.h[p.config] : undefined;
  return o && h !== undefined ? newSides(o.kind, h) : null;
}
