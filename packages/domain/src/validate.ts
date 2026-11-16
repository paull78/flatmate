import { TABLE_NAMES, assertNever, err, ok } from "@fm/protocol";
import type { EntityKey, Result } from "@fm/protocol";
import { MESSAGES, thicknessViolation, type Violation } from "./errors";
import { distance } from "./geometry";
import { FLOOR_BASE, MAX_DIMENSION_OFFSET, MIN_EDGE, WALL_FINISH_KEYS, isWallThickness, type DimensionEnd, type Document } from "./model";
import { configOf, configsOf } from "./kinds";
import { armsFit } from "./arms";
import { finishProblem } from "./finishes";
import { sidesProblem } from "./wall-sides";
import { defaultProblem } from "./wall-defaults";
import { fitViolations } from "./queries/fit";
import { projectFieldOf, projectFieldProblem } from "./project-fields";
import {
  isFiniteNumber, isValidId, isValidName, parseDeck, parseDeckHole, parseDimension, parseLayoutObject, parseLayoutState, parseLogo, parseOpening, parsePlacement, parseProjectField, parseSheet, parseUnderlay, parseCeiling,
} from "./shape";
import { stairViolations } from "./stair-links";
import { ceilingViolations } from "./ceiling";
import { deckHoleViolations } from "./deck-holes";
import { deckViolations } from "./decks";
import { columnViolations } from "./column-checks";
import { wallRangeViolations } from "./wall-ranges";
import { pairViolations, type Segment } from "./wall-pairs";
import { logoViolations } from "./logo";
import { underlayViolations } from "./underlay";
import { parseSection } from "./shape-sections";
import { parseArea } from "./shape-areas";
import { sectionViolations } from "./validate-sections";
import { areaViolations } from "./validate-areas";
import { sheetViolations } from "./validate-sheets";
import { openingViolations } from "./validate-openings";

const jointKey = (id: string): EntityKey => ({ table: "joints", id });
const wallKey = (id: string): EntityKey => ({ table: "walls", id });

/** I8: IDs, keys, coordinates and label fields, for every table (a switch over TABLE_NAMES, arch-review R-08). */
function shapeViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const bad = (table: EntityKey["table"], id: string, what: string, plain?: string): void => {
    out.push({ invariant: "I8", message: `${table} ${id}: ${what}`, entities: [{ table, id }], ...(plain === undefined ? {} : { plain }) });
  };
  // The layout tables reuse the entity parsers: a row is well-formed when it parses back to itself.
  const rows = <T extends { id: string }>(table: EntityKey["table"], all: Record<string, T>, parse: (v: unknown) => T | null): void => {
    for (const [key, row] of Object.entries(all)) if (row.id !== key || !parse(row)) bad(table, key, "invalid fields");
  };
  for (const table of TABLE_NAMES) {
    switch (table) {
      case "joints":
        for (const [key, j] of Object.entries(doc.joints)) {
          if (!isValidId(j.id) || j.id !== key) bad("joints", key, "invalid ID");
          else if (!isFiniteNumber(j.x) || !isFiniteNumber(j.y)) bad("joints", key, "coordinates must be finite");
        }
        break;
      case "walls":
        for (const [key, w] of Object.entries(doc.walls)) {
          if (!isValidId(w.id) || w.id !== key || !isValidId(w.a) || !isValidId(w.b)) bad("walls", key, "invalid ID");
          else if (!isFiniteNumber(w.top) && (!isValidId(w.top) || w.top === FLOOR_BASE)) bad("walls", key, "top must be a height, \"ceiling\" or a deck");
          else if (!isValidId(w.base) || typeof w.column !== "boolean") bad("walls", key, "base must be \"floor\" or a deck, column a boolean");
          else if (WALL_FINISH_KEYS.some((k) => w[k] !== undefined)) { // a wall's finishes (surfaces.03, .33): a column takes none
            const problem = w.column ? "a column takes no finish" : sidesProblem(w);
            if (problem) bad("walls", key, problem);
          }
        }
        break;
      case "zoneLabels":
        for (const [key, l] of Object.entries(doc.zoneLabels)) {
          if (!isValidId(l.id) || l.id !== key) bad("zoneLabels", key, "invalid ID");
          else if (!isFiniteNumber(l.at.x) || !isFiniteNumber(l.at.y)) bad("zoneLabels", key, "position must be finite");
          else if (!isValidName(l.name)) bad("zoneLabels", key, "name too long");
          else {
            const problem = (l.finish === null ? null : finishProblem(l.finish, "floor")) // the floor, then the walls default (inherit.01)
              ?? defaultProblem({ finish: l.walls, lower: l.wallsLower, height: l.wallsLowerHeight }, ["walls", "wallsLower", "wallsLowerHeight"]);
            if (problem) bad("zoneLabels", key, problem);
          }
        }
        break;
      case "decks":
        rows("decks", doc.decks, parseDeck);
        for (const [key, deck] of Object.entries(doc.decks)) { // a deck's finish, as a label's (deck-floors.04)
          const problem = deck.finish === null ? null : finishProblem(deck.finish, "floor");
          if (problem) bad("decks", key, problem);
        }
        break;
      case "deckHoles": rows("deckHoles", doc.deckHoles, parseDeckHole); break;
      case "states": rows("states", doc.states, parseLayoutState); break;
      case "objects":
        rows("objects", doc.objects, parseLayoutObject);
        // An `L` piece's arms against its sizes in every configuration (catalog.12), with the sizes' range; the refusal's
        // toast is the rule itself (topologyMessage).
        for (const [key, o] of Object.entries(doc.objects)) {
          const { arms } = o;
          if (arms && !configsOf(o).every((c) => armsFit(arms, o.w[c.id] ?? 0, o.d[c.id] ?? 0))) bad("objects", key, MESSAGES.arms, MESSAGES.arms);
        }
        break;
      case "placements": rows("placements", doc.placements, parsePlacement); break;
      case "openings": rows("openings", doc.openings, parseOpening); break;
      case "dimensions": rows("dimensions", doc.dimensions, parseDimension); break;
      case "projectFields": rows("projectFields", doc.projectFields, parseProjectField); break;
      case "underlays": rows("underlays", doc.underlays, parseUnderlay); break;
      case "logos": rows("logos", doc.logos, parseLogo); break;
      case "ceilings":
        rows("ceilings", doc.ceilings, parseCeiling);
        for (const [key, c] of Object.entries(doc.ceilings)) { // the roof's covering (surfaces step 11)
          const problem = c.covering === undefined ? null : finishProblem(c.covering, "roof");
          if (problem) bad("ceilings", key, problem.replace(/^finish\./, "covering."));
          const outside = defaultProblem({ finish: c.outside, lower: c.outsideLower, height: c.outsideLowerHeight }, ["outside", "outsideLower", "outsideLowerHeight"]); // inherit.07
          if (outside) bad("ceilings", key, outside);
        }
        break;
      case "sheets": rows("sheets", doc.sheets, parseSheet); break;
      case "sections": rows("sections", doc.sections, parseSection); break;
      case "areas": rows("areas", doc.areas, parseArea); break;
      default: assertNever(table);
    }
  }
  return out;
}

/**
 * I9 (spec: layouts): at least one state; every placement names an existing object and state, and an existing deck or
 * none (decks.15), at most one placement per (object, state), with a configuration of the object's kind; every object
 * has a placement.
 */
function layoutViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const v = (message: string, entities: EntityKey[]): void => void out.push({ invariant: "I9", message, entities });
  if (Object.keys(doc.states).length === 0) v("A drawing needs at least one layout state", []);
  const placed = new Set<string>();
  const byPair = new Map<string, string>();
  for (const id of Object.keys(doc.placements).sort()) {
    const p = doc.placements[id];
    if (!p) continue;
    const key: EntityKey = { table: "placements", id };
    const object = doc.objects[p.object];
    if (!object) v(`Placement ${id} names a missing object`, [key]);
    if (!doc.states[p.state]) v(`Placement ${id} names a missing state`, [key]);
    if (p.deck !== null && !doc.decks[p.deck]) v(`Placement ${id} stands on a missing deck`, [key]);
    if (object && !configOf(object, p.config)) {
      v(`Placement ${id} has a configuration its object's kind does not have`, [key]);
    }
    const pair = `${p.object}|${p.state}`; // "|" is outside the ID alphabet
    const first = byPair.get(pair);
    if (first !== undefined) v(`Placements ${first} and ${id} place one object twice in one state`, [{ table: "placements", id: first }, key]);
    else byPair.set(pair, id);
    placed.add(p.object);
  }
  for (const id of Object.keys(doc.objects).sort()) {
    if (!placed.has(id)) v(`Object ${id} is placed in no state`, [{ table: "objects", id }]);
  }
  return out;
}

/** I14 (sheet.05): every project field row is a known field with a non-empty value that fits it. */
function projectFieldViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.projectFields).sort()) {
    const row = doc.projectFields[id];
    if (!row) continue;
    const field = projectFieldOf(id);
    const problem = !field ? `Unknown project field ${id}` : row.value === "" ? `${field.label} is empty` : projectFieldProblem(field, row.value);
    if (problem !== null) out.push({ invariant: "I14", message: problem, entities: [{ table: "projectFields", id }] });
  }
  return out;
}

/** How far an end's corner direction may be from length 0 or 1 (dims.16). */
const TOWARD_TOLERANCE = 1e-6;

/** Why a dimension end breaks I15, or null. */
function endProblem(doc: Document, end: DimensionEnd): string | null {
  if (!("joint" in end)) return Number.isFinite(end.x) && Number.isFinite(end.y) ? null : "has a point that is not finite";
  if (!doc.joints[end.joint]) return `is anchored to a missing joint ${end.joint}`;
  const len = Math.hypot(end.tx, end.ty);
  return len <= TOWARD_TOLERANCE || Math.abs(len - 1) <= TOWARD_TOLERANCE ? null : "has a corner direction that is not a unit vector";
}

/**
 * I15 (dims.14): every anchored end's joint exists, its direction has length 0 or 1, every number is finite and the offset
 * is within ±MAX_DIMENSION_OFFSET. The 1 cm minimum length is not checked here, so a corner move is never refused.
 */
function dimensionViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of Object.keys(doc.dimensions).sort()) {
    const d = doc.dimensions[id];
    if (!d) continue;
    const v = (what: string): void => void out.push({ invariant: "I15", message: `Dimension ${id} ${what}`, entities: [{ table: "dimensions", id }] });
    for (const problem of [endProblem(doc, d.a), endProblem(doc, d.b)]) if (problem) v(problem);
    if (!Number.isFinite(d.offset) || Math.abs(d.offset) > MAX_DIMENSION_OFFSET) v(`is more than ${MAX_DIMENSION_OFFSET} m from what it measures`);
  }
  return out;
}

/** Checks invariants I1–I26 (spec: domain, layouts); the pair tests I4–I7 are in wall-pairs.ts. */
export function validateDocument(doc: Document): Result<void, Violation[]> {
  const shape = shapeViolations(doc);
  if (shape.length > 0) return err(shape);

  const out: Violation[] = [];
  const segments: Segment[] = [];
  const used = new Set<string>();
  const wallIds = Object.keys(doc.walls).sort();
  const jointIds = Object.keys(doc.joints).sort();

  for (const id of wallIds) {
    const wall = doc.walls[id];
    if (!wall) continue;
    if (!wall.column && !isWallThickness(wall.thickness)) out.push(thicknessViolation(id, wall.thickness)); // a column's depth is I20
    const a = doc.joints[wall.a];
    const b = doc.joints[wall.b];
    if (!a || !b || wall.a === wall.b) {
      out.push({ invariant: "I1", message: `Wall ${id} needs two existing, distinct joints`, entities: [wallKey(id)] });
      continue;
    }
    used.add(wall.a);
    used.add(wall.b);
    if (distance(a, b) < MIN_EDGE) {
      out.push({ invariant: "I2", message: `Wall ${id} is shorter than 1 cm`, entities: [wallKey(id)] });
    }
    segments.push({ wall, a, b });
  }

  for (const id of jointIds) {
    if (!used.has(id)) out.push({ invariant: "I3", message: `Joint ${id} is not used by any wall`, entities: [jointKey(id)] });
  }

  out.push(...pairViolations(doc, segments, jointIds.flatMap((id) => doc.joints[id] ?? [])));

  const layout = layoutViolations(doc);
  out.push(...layout);
  // Decks and fit need well-formed walls, fit also placements: skip them while I1 (or I9) fails, so a broken reference
  // is reported once. I18 comes before fit, so a deck's own refusal is the one named (decks.15).
  const wallsOk = !out.some((v) => v.invariant === "I1");
  if (wallsOk) out.push(...columnViolations(doc), ...wallRangeViolations(doc), ...deckViolations(doc));
  out.push(...deckHoleViolations(doc)); // a hole's own rules need no walls (stairwell.20)
  if (wallsOk && layout.length === 0) out.push(...fitViolations(doc));
  out.push(...openingViolations(doc));
  out.push(...dimensionViolations(doc));
  out.push(...projectFieldViolations(doc));
  out.push(...underlayViolations(doc));
  out.push(...logoViolations(doc));
  out.push(...ceilingViolations(doc));
  out.push(...stairViolations(doc));
  out.push(...sheetViolations(doc));
  out.push(...sectionViolations(doc));
  out.push(...areaViolations(doc));
  return out.length === 0 ? ok(undefined) : err(out);
}
