import { err, isRecord, ok } from "@fm/protocol";
import type { Result, StoredDocument, TableName } from "@fm/protocol";
import { domainError, type DomainError } from "./errors";
import { copyTables, type Document } from "./model";
import {
  parseCeiling, parseDeck, parseDeckHole, parseDimension, parseJoint, parseLayoutObject, parseLayoutState, parseLogo, parseOpening,
  parsePlacement, parseProjectField, parseSheet, parseUnderlay, parseWall, parseZoneLabel,
} from "./shape";
import { parseSection } from "./shape-sections";
import { parseArea } from "./shape-areas";

// The whole document's shape check, split from shape.ts (which holds the row parsers) when the areas table took it past
// the module size limit (areas.18).

/** Parses one table of unknown values; each entry's key must equal its ID (I8). */
function parseTable<T extends { id: string }>(
  table: TableName,
  raw: unknown,
  parse: (v: unknown) => T | null,
): Result<Record<string, T>, DomainError> {
  if (!isRecord(raw)) return err(domainError("format", `Invalid ${table} table`));
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parse(value);
    if (!parsed || parsed.id !== key) return err(domainError("format", `Invalid ${table} entry ${key}`));
    out[key] = parsed;
  }
  return ok(out);
}

/**
 * Shape-checks the seventeen tables of an unknown object (no geometry validation). Only `dimensions`, `underlays`,
 * `logos`, `ceilings`, `decks`, `deckHoles`, `sheets`, `sections` and `areas` may be missing (read as empty): they came after
 * the last file version, and files take no new version before production (sheet.31, dims.21, heights.28, decks.03,
 * stairwell.20, sheetset.02, areas.05).
 */
export function parseTables(raw: Record<string, unknown>): Result<Document, DomainError> {
  const joints = parseTable("joints", raw.joints, parseJoint);
  if (!joints.ok) return joints;
  const walls = parseTable("walls", raw.walls, parseWall);
  if (!walls.ok) return walls;
  const zoneLabels = parseTable("zoneLabels", raw.zoneLabels, parseZoneLabel);
  if (!zoneLabels.ok) return zoneLabels;
  const decks = parseTable("decks", Object.hasOwn(raw, "decks") ? raw.decks : {}, parseDeck);
  if (!decks.ok) return decks;
  const deckHoles = parseTable("deckHoles", Object.hasOwn(raw, "deckHoles") ? raw.deckHoles : {}, parseDeckHole);
  if (!deckHoles.ok) return deckHoles;
  const states = parseTable("states", raw.states, parseLayoutState);
  if (!states.ok) return states;
  const objects = parseTable("objects", raw.objects, parseLayoutObject);
  if (!objects.ok) return objects;
  const placements = parseTable("placements", raw.placements, parsePlacement);
  if (!placements.ok) return placements;
  const openings = parseTable("openings", raw.openings, parseOpening);
  if (!openings.ok) return openings;
  const dimensions = parseTable("dimensions", Object.hasOwn(raw, "dimensions") ? raw.dimensions : {}, parseDimension);
  if (!dimensions.ok) return dimensions;
  const projectFields = parseTable("projectFields", raw.projectFields, parseProjectField);
  if (!projectFields.ok) return projectFields;
  const underlays = parseTable("underlays", Object.hasOwn(raw, "underlays") ? raw.underlays : {}, parseUnderlay);
  if (!underlays.ok) return underlays;
  const logos = parseTable("logos", Object.hasOwn(raw, "logos") ? raw.logos : {}, parseLogo);
  if (!logos.ok) return logos;
  const ceilings = parseTable("ceilings", Object.hasOwn(raw, "ceilings") ? raw.ceilings : {}, parseCeiling);
  if (!ceilings.ok) return ceilings;
  const sheets = parseTable("sheets", Object.hasOwn(raw, "sheets") ? raw.sheets : {}, parseSheet);
  if (!sheets.ok) return sheets;
  const sections = parseTable("sections", Object.hasOwn(raw, "sections") ? raw.sections : {}, parseSection);
  if (!sections.ok) return sections;
  const areas = parseTable("areas", Object.hasOwn(raw, "areas") ? raw.areas : {}, parseArea);
  if (!areas.ok) return areas;
  return ok({
    joints: joints.value,
    walls: walls.value,
    zoneLabels: zoneLabels.value,
    decks: decks.value,
    deckHoles: deckHoles.value,
    states: states.value,
    objects: objects.value,
    placements: placements.value,
    openings: openings.value,
    dimensions: dimensions.value,
    projectFields: projectFields.value,
    underlays: underlays.value,
    logos: logos.value,
    ceilings: ceilings.value,
    sheets: sheets.value,
    sections: sections.value,
    areas: areas.value,
  });
}

export function fromStored(stored: StoredDocument): Result<Document, DomainError> {
  return parseTables(stored);
}

export function toStored(doc: Document): StoredDocument {
  return copyTables(doc);
}
