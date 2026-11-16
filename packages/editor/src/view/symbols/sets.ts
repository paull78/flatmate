import { CHAIR_SIZE, OBJECT_KINDS, kindConfigs, kindOf, type Aggregate, type ObjectOptions } from "@fm/domain";
import { aggregateLayout, chairRing } from "../aggregate";
import { clipOutside } from "../clip";
import type { Primitive } from "../scene-types";
import { placeSymbol, ringSegments, type Parts, type SymbolOf, type SymbolTable } from "./lines";
import { chairSymbol, desk, roundChairSymbol, roundTable, tableTop } from "./sit-and-eat";

// The aggregates' symbols (seating.15, AC-04): the lines of their table plus loose chairs fully tucked, from the one
// layout (`aggregateLayout`). Each chair is the chair's own outline and symbol at its pose, clipped outside the table's
// ring as a loose tucked chair's lines are (seating.28). No outer outline: furniture.ts draws only these lines.

/** The table's own detail at its size, in its footprint space: the dining set's top has no seam across it; the desk has its computer. */
const TABLE_DETAIL: Readonly<Record<Aggregate["chairs"], (w: number, d: number, options: ObjectOptions) => Primitive[]>> = {
  sides: tableTop,
  around: roundTable,
  front: desk,
};

/**
 * A set's lines: the table's ring and the chairs' outlines as the outline, the table's and chairs' details lighter. With
 * the set's round chairs (library.07) each chair is the round chair, its outline the rounded ring its fill is.
 */
const setSymbol: SymbolOf = (w, d, kind, options): Parts => {
  const l = aggregateLayout(kind, w, d);
  const set = kindOf(kind)?.aggregate;
  if (!l || !set) return { line: [], detail: [] };
  const clipped = (ps: Primitive[]): Primitive[] => clipOutside(ps, [l.table]);
  const tableDetail = placeSymbol(TABLE_DETAIL[set.chairs](l.tableSize.w, l.tableSize.d, options), l.tableAt, 0);
  const round = options.roundChairs === true;
  const chair = (round ? roundChairSymbol : chairSymbol)(CHAIR_SIZE.w, CHAIR_SIZE.d);
  return {
    line: [...ringSegments(l.table), ...l.chairs.flatMap((c) => clipped(ringSegments(chairRing(c, round))))],
    detail: [...tableDetail, ...l.chairs.flatMap((c) => clipped(placeSymbol(chair, c.at, c.rotation)))],
  };
};

/** Every aggregate kind's configurations draw `setSymbol`, keyed `${kind}.${config}` like the other groups' tables. */
export const SETS: SymbolTable = new Map(OBJECT_KINDS.flatMap((k) => (k.aggregate ? kindConfigs(k.id).map((c): [string, SymbolOf] => [`${k.id}.${c.id}`, setSymbol]) : [])));
