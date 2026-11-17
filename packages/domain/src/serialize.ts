import { err, isRecord, ok, parseStoredDocument } from "@fm/protocol";
import type { Result, StoredDocument, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { sortedIds } from "./graph";
import { OPENING_KINDS, defaultSides, defaultSize, isOpeningKind, railShape, stairRuleOf } from "./kinds";
import { CEILING_ID, DEFAULT_CEILING, DEFAULT_WALL_THICKNESS, FIRST_STATE, FLOOR_BASE, guardFor, guardValue, isGuard, isHandrailKind, sameGuards, sameRails, type Document, type HandrailKind } from "./model";
import { DECK_THICKNESS } from "./presets";
import { defaultOpeningHeights } from "./queries/vertical";
import { stairsWithoutRails, withLoadRails } from "./load-rails";
import { parseTables, toStored } from "./shape-tables";
import { nullZones } from "./use-zone";
import { validateDocument } from "./validate";

/** Every table is a field: a table added to the protocol fails to compile in `serialize` until it is written. */
type DocumentJson = { format: "flatmate"; version: number } & Record<TableName, unknown>;
/** Every save writes this. No new version numbers before production: files today are development data (sheet.31). */
export const CURRENT_VERSION = 4;

/**
 * Upgrades a file from `from` to `from + 1` by rewriting its JSON (spec: domain). `migrate` must not
 * throw; return the input unchanged when expected fields are missing. Every shipped migration is also
 * idempotent (it only adds what is missing), so `upgradeStored` can run all of them on server data,
 * which carries no version (layout-states.32).
 */
type Migration = { from: number; migrate(json: Record<string, unknown>): Record<string, unknown> };

/** 1 → 2: walls gain `thickness`; walls from before per-wall thickness were 0.20 m (layout-states.27). */
function addWallThickness(json: Record<string, unknown>): Record<string, unknown> {
  const walls = json.walls;
  if (!isRecord(walls)) return json;
  // fromEntries keeps a "__proto__" key as an own key, so validation refuses it; an assignment would set the
  // prototype and drop the wall silently (smart.29, cleanup.12).
  const next = Object.fromEntries(
    Object.entries(walls).map(([id, wall]) => [id, isRecord(wall) && !Object.hasOwn(wall, "thickness") ? { ...wall, thickness: DEFAULT_WALL_THICKNESS } : wall]),
  );
  return { ...json, walls: next };
}

/**
 * 2 → 3: layout states (spec: layouts). Adds the states, objects, placements and openings tables when missing, and the
 * first state "Layout" when there is no state: an empty states table is never valid (I9), and the server's new
 * projects start with one (layout-states.39).
 */
function addLayoutTables(json: Record<string, unknown>): Record<string, unknown> {
  const states = json.states;
  const hasState = isRecord(states) && Object.keys(states).length > 0;
  return {
    ...json,
    states: hasState ? states : { [FIRST_STATE.id]: { ...FIRST_STATE } },
    objects: json.objects ?? {},
    placements: json.placements ?? {},
    openings: json.openings ?? {},
  };
}

/** 3 → 4: the title block's project fields (sheet.02). Adds the empty table when missing. */
function addProjectFields(json: Record<string, unknown>): Record<string, unknown> {
  return Object.hasOwn(json, "projectFields") ? json : { ...json, projectFields: {} };
}

export const MIGRATIONS: readonly Migration[] = [
  { from: 1, migrate: addWallThickness },
  { from: 2, migrate: addLayoutTables },
  { from: 3, migrate: addProjectFields },
];

/**
 * Placements saved before use zones by side get their kind's default `sides` (smart.14), and those saved before
 * stored zones get all-null `zones` (furnish.21). Fill-only and idempotent, with no version bump (sheet.31), so it is
 * not a `Migration`: it runs after them on every load. `zones` goes only on a placement that has or gets `sides`, and
 * never replaces a stored one; a placement whose object is missing or of an unknown kind is left as it is, and
 * parsing refuses it as before. Never throws. Exported for its tests; loads call `fillOnLoad`.
 */
export function fillZoneSides(json: Record<string, unknown>): Record<string, unknown> {
  const { placements, objects } = json;
  if (!isRecord(placements) || !isRecord(objects)) return json;
  const withSides = (p: Record<string, unknown>): Record<string, unknown> => {
    if (Object.hasOwn(p, "sides")) return p;
    const object = typeof p.object === "string" && Object.hasOwn(objects, p.object) ? objects[p.object] : undefined;
    const sides = isRecord(object) && typeof object.kind === "string" ? defaultSides(object.kind) : null;
    return sides ? { ...p, sides } : p;
  };
  const filled = (p: unknown): unknown => {
    if (!isRecord(p)) return p;
    const sided = withSides(p);
    return Object.hasOwn(sided, "sides") && !Object.hasOwn(sided, "zones") ? { ...sided, zones: nullZones() } : sided;
  };
  // fromEntries keeps a "__proto__" key as an own key, where an assignment would set the prototype; parsing refuses it.
  return { ...json, placements: Object.fromEntries(Object.entries(placements).map(([id, p]) => [id, filled(p)])) };
}

/**
 * Objects saved before heights get their kind's height and elevation for each configuration key they lack, and walls
 * without a top go to the ceiling (heights.09, .10, .37), without a base stand on the floor, without `column` are walls. Fill-only and idempotent like `fillZoneSides`: a stored value
 * is never replaced, an object of an unknown kind or a non-object map is left for parsing to refuse. Never throws.
 */
function fillHeights(json: Record<string, unknown>): Record<string, unknown> {
  const { objects, walls } = json;
  const fillMap = (stored: unknown, defaults: Record<string, unknown>): unknown => {
    if (stored === undefined) return { ...defaults };
    if (!isRecord(stored)) return stored;
    const missing = Object.entries(defaults).filter(([c]) => !Object.hasOwn(stored, c));
    return missing.length === 0 ? stored : { ...stored, ...Object.fromEntries(missing) };
  };
  const filledObject = (o: unknown): unknown => {
    if (!isRecord(o) || typeof o.kind !== "string") return o;
    const size = defaultSize(o.kind);
    return size ? { ...o, h: fillMap(o.h, size.h), z: fillMap(o.z, size.z) } : o;
  };
  // A wall saved before columns and bases stands on the floor and is not a column (pillars).
  const wallDefaults = { top: "ceiling", base: FLOOR_BASE, column: false };
  const filledWall = (w: unknown): unknown => (isRecord(w) ? fillMap(w, wallDefaults) : w);
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  const map = (table: unknown, f: (v: unknown) => unknown): unknown =>
    isRecord(table) ? Object.fromEntries(Object.entries(table).map(([id, v]) => [id, f(v)])) : table;
  return { ...json, objects: map(objects, filledObject), walls: map(walls, filledWall) };
}

/**
 * Placements saved before decks stand on the floor: a missing `deck` reads as null (decks.04). The missing `decks`
 * table reads as empty in parsing. Fill-only and idempotent like `fillZoneSides`; never throws.
 */
function fillDecks(json: Record<string, unknown>): Record<string, unknown> {
  const { placements } = json;
  if (!isRecord(placements)) return json;
  const filled = (p: unknown): unknown => (isRecord(p) && !Object.hasOwn(p, "deck") ? { ...p, deck: null } : p);
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  return { ...json, placements: Object.fromEntries(Object.entries(placements).map(([id, p]) => [id, filled(p)])) };
}

/**
 * Stairs saved before a stair could start at a deck's edge start at their surface: a missing `startsAt` reads as null
 * (stairs.49). Only on stair kinds, which the row parser requires to have it. Fill-only and idempotent; never throws.
 */
function fillStairStarts(json: Record<string, unknown>): Record<string, unknown> {
  const { objects } = json;
  if (!isRecord(objects)) return json;
  const filled = (o: unknown): unknown =>
    isRecord(o) && typeof o.kind === "string" && stairRuleOf(o.kind) !== null && !Object.hasOwn(o, "startsAt") ? { ...o, startsAt: null } : o;
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  return { ...json, objects: Object.fromEntries(Object.entries(objects).map(([id, o]) => [id, filled(o)])) };
}

/**
 * Decks saved before a guard per side (edges.01) have one `guard`, or none at all before guards: its kind, or the one
 * the top gives (guards.11), goes to all four sides at the default height and the old field is dropped. A row that
 * already has its sides is left alone, so a row with both is refused by the parser. Fill-only and idempotent; never throws.
 */
function fillDeckGuards(json: Record<string, unknown>): Record<string, unknown> {
  const { decks } = json;
  if (!isRecord(decks)) return json;
  // An older hole takes its deck's one guard, read before the deck's row is filled below (edges.01).
  const oldKind = (deckId: unknown): unknown => {
    const d = typeof deckId === "string" && Object.hasOwn(decks, deckId) ? decks[deckId] : undefined;
    if (!isRecord(d)) return undefined;
    if (isRecord(d.guardFront)) return d.guardFront.kind;
    return Object.hasOwn(d, "guard") ? d.guard : typeof d.top === "number" ? guardFor(d.top) : undefined;
  };
  const hole = (h: unknown): unknown => {
    if (!isRecord(h) || Object.hasOwn(h, "guard")) return h;
    const kind = oldKind(h.deck);
    return isGuard(kind) ? { ...h, guard: guardValue(kind) } : h;
  };
  const { deckHoles } = json;
  const holes = isRecord(deckHoles) ? { deckHoles: Object.fromEntries(Object.entries(deckHoles).map(([id, h]) => [id, hole(h)])) } : {};
  const filled = (d: unknown): unknown => {
    if (!isRecord(d) || Object.hasOwn(d, "guardFront")) return d;
    const kind: unknown = Object.hasOwn(d, "guard") ? d.guard : typeof d.top === "number" ? guardFor(d.top) : undefined;
    if (!isGuard(kind)) return d;
    const rest: Record<string, unknown> = { ...d };
    delete rest.guard;
    return { ...rest, ...sameGuards(kind) };
  };
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  return { ...json, ...holes, decks: Object.fromEntries(Object.entries(decks).map(([id, d]) => [id, filled(d)])) };
}

/**
 * A flight saved with the older single `handrail` gets it on both sides (edges.06). A stair saved with no rails at all
 * gets Railing as a placeholder the parser accepts: `withLoadRails` (load-rails.ts) then chooses by the rule a new stair
 * follows, which needs the parsed document. Only on kinds with rails; fill-only and idempotent; never throws.
 */
function fillStairHandrails(json: Record<string, unknown>): Record<string, unknown> {
  const { objects } = json;
  if (!isRecord(objects)) return json;
  const filled = (o: unknown): unknown => {
    if (!isRecord(o) || typeof o.kind !== "string") return o;
    const shape = railShape(o.kind);
    if (shape === null || Object.hasOwn(o, "handrails")) return o;
    const kind = Object.hasOwn(o, "handrail") ? o.handrail : PLACEHOLDER_RAIL;
    if (shape === "spiral") return Object.hasOwn(o, "handrail") ? o : { ...o, handrail: kind };
    const rest: Record<string, unknown> = { ...o };
    delete rest.handrail;
    return isHandrailKind(kind) ? { ...rest, handrails: sameRails(kind) } : o;
  };
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  return { ...json, objects: Object.fromEntries(Object.entries(objects).map(([id, o]) => [id, filled(o)])) };
}

const PLACEHOLDER_RAIL: HandrailKind = "railing";

/** Sheet rows saved before Section sheets name no section (section.10) and draw their marks (section.60). Fill-only and idempotent; never throws. */
function fillSheetSections(json: Record<string, unknown>): Record<string, unknown> {
  const { sheets } = json;
  if (!isRecord(sheets)) return json;
  const filled = (s: unknown): unknown => (isRecord(s) ? { section: null, marks: true, ...s } : s);
  return { ...json, sheets: Object.fromEntries(Object.entries(sheets).map(([id, s]) => [id, filled(s)])) };
}

/**
 * Openings saved before heights get the range they drew with (sills step 01, AC-03): `defaultOpeningHeights` on their
 * wall's height, read from the raw rows as `wallRange` reads them (a number above the base, the ceiling, or a deck's
 * underside). Runs after fillHeights, which gives every wall its top and base. Fill-only and idempotent; an opening on
 * an unknown wall or of an unknown kind is left for parsing and validation to refuse. Never throws.
 */
function fillOpeningHeights(json: Record<string, unknown>): Record<string, unknown> {
  const { openings, walls, decks, ceilings } = json;
  if (!isRecord(openings)) return json;
  const row = (table: unknown, id: unknown): Record<string, unknown> | null => {
    const v = typeof id === "string" && isRecord(table) && Object.hasOwn(table, id) ? table[id] : undefined;
    return isRecord(v) ? v : null;
  };
  const ceilingRow = row(ceilings, CEILING_ID);
  const ceiling = typeof ceilingRow?.height === "number" ? ceilingRow.height : DEFAULT_CEILING;
  const deckTop = (id: unknown): number | null => {
    const d = row(decks, id);
    return d && typeof d.top === "number" ? d.top : null;
  };
  const deckUnder = (id: unknown): number | null => {
    const d = row(decks, id);
    return d && typeof d.top === "number" ? (d.solid === true ? 0 : d.top - DECK_THICKNESS) : null;
  };
  const wallHeight = (id: unknown): number | null => {
    const w = row(walls, id);
    if (!w) return null;
    const bottom = w.base === FLOOR_BASE ? 0 : deckTop(w.base);
    const top = typeof w.top === "number" ? (bottom ?? 0) + w.top : w.top === "ceiling" ? ceiling : deckUnder(w.top);
    return bottom === null || top === null ? null : top - bottom;
  };
  const filled = (o: unknown): unknown => {
    if (!isRecord(o) || (Object.hasOwn(o, "sill") && Object.hasOwn(o, "head")) || !isOpeningKind(o.kind)) return o;
    const height = wallHeight(o.wall);
    return height === null ? o : { ...defaultOpeningHeights(OPENING_KINDS[o.kind].fromFloor, height), ...o };
  };
  // fromEntries keeps a "__proto__" key as an own key, as in fillZoneSides.
  return { ...json, openings: Object.fromEntries(Object.entries(openings).map(([id, o]) => [id, filled(o)])) };
}

/** The fill steps every load runs after the migrations, in both load paths (heights.09, decks.04, stairs.49, guards.28, sills step 01). */
export function fillOnLoad(json: Record<string, unknown>): Record<string, unknown> {
  return fillOpeningHeights(fillSheetSections(fillStairHandrails(fillDeckGuards(fillStairStarts(fillDecks(fillHeights(fillZoneSides(json))))))));
}

/**
 * Brings a stored document of unknown age (server project files carry no version) to the current shape by
 * running every migration, then the fill steps; each one only adds what is missing. Not a validation: the result is
 * checked as usual.
 */
export function upgradeStored(stored: StoredDocument): StoredDocument {
  let json: Record<string, unknown> = stored;
  for (const m of MIGRATIONS) json = m.migrate(json);
  const bare = stairsWithoutRails(json);
  const filled = parseStoredDocument(fillOnLoad(json));
  if (!filled) return stored;
  if (bare.length === 0) return filled;
  const doc = parseTables(filled); // the rails' rule reads the document (load-rails.ts); one that won't parse keeps the placeholder
  return doc.ok ? toStored(withLoadRails(doc.value, bare)) : filled;
}

function sortedTable<T>(table: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of sortedIds(table)) {
    const v = table[id];
    if (v !== undefined) out[id] = v;
  }
  return out;
}

export function serialize(doc: Document): DocumentJson {
  return {
    format: "flatmate",
    version: CURRENT_VERSION,
    joints: sortedTable(doc.joints),
    walls: sortedTable(doc.walls),
    zoneLabels: sortedTable(doc.zoneLabels),
    decks: sortedTable(doc.decks),
    deckHoles: sortedTable(doc.deckHoles),
    states: sortedTable(doc.states),
    objects: sortedTable(doc.objects),
    placements: sortedTable(doc.placements),
    openings: sortedTable(doc.openings),
    dimensions: sortedTable(doc.dimensions),
    projectFields: sortedTable(doc.projectFields),
    underlays: sortedTable(doc.underlays),
    logos: sortedTable(doc.logos),
    ceilings: sortedTable(doc.ceilings),
    sheets: sortedTable(doc.sheets),
    sections: sortedTable(doc.sections),
    areas: sortedTable(doc.areas),
  };
}

/** Applies migrations in order until the JSON reaches `target`. */
export function migrateJson(
  json: Record<string, unknown>,
  version: number,
  target: number,
  migrations: readonly Migration[],
): Result<Record<string, unknown>, DomainError> {
  let current = json;
  for (let v = version; v < target; v++) {
    const m = migrations.find((x) => x.from === v);
    if (!m) return err(domainError("format", `No migration from file version ${v}`));
    current = m.migrate(current);
  }
  return ok(current);
}

export function deserialize(json: unknown): Result<Document, DomainError> {
  if (!isRecord(json) || json.format !== "flatmate") return err(domainError("format", "Not a Flatmate drawing"));
  const version = json.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return err(domainError("format", "Unknown file version"));
  }
  if (version > CURRENT_VERSION) {
    return err(domainError("format", `This drawing needs a newer Flatmate (file version ${version}, supported ${CURRENT_VERSION})`));
  }
  const migrated = migrateJson(json, version, CURRENT_VERSION, MIGRATIONS);
  if (!migrated.ok) return migrated;
  const parsed = parseTables(fillOnLoad(migrated.value));
  if (!parsed.ok) return parsed;
  const doc = ok(withLoadRails(parsed.value, stairsWithoutRails(migrated.value)));
  const valid = validateDocument(doc.value);
  if (!valid.ok) {
    return err(domainError("format", `Drawing is invalid: ${valid.error[0]?.message ?? "unknown problem"}`, valid.error));
  }
  return ok(doc.value);
}
