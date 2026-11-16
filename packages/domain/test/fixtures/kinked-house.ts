import type { Document } from "../../src/model";
import { docOf } from "../helpers";

// A real house's walls, as get_drawing listed them (ids shortened; thickness 0.10 where the listing gave one,
// else 0.20). The straight cycle's concrete case (spec AC-02, AC-11, AC-13, AC-16): the top side's 1 cm kink at x 7.256,
// a leftover straight joint at (13, 1.79), and the blue wall's free end 9.8 cm short of the corner at (10.298, -1.5).
// Copied in packages/editor/test/fixtures/kinked-house.ts and packages/mcp/test/fixtures/kinked-house.ts; keep them alike.

export const KINKED_JOINTS: [string, number, number][] = [
  ["0d42", 8.875, -1.5], ["197d", 3, -6], ["2fb1", 13, 0.798], ["372a", 7.256, 2.84], ["5923a", 10.9, -0.5], ["5923b", 10.9, -1.5],
  ["6698", 13, -6], ["6ad8a", 8.875, -6], ["6ad8b", 8.875, -2.5], ["6d79", 13, -1.5], ["719ea", 8.875, 1.8], ["719eb", 11.577, 1.8],
  ["7205a", 7.236, -6], ["7205b", 7.236, -4.6], ["849aa", 7.236, -1.5], ["849ab", 7.236, 0.798], ["a36b", 9.875, -2.5], ["a8cd", 13, 1.79],
  ["afdba", 3, 2.84], ["afdbb", 13, 2.85], ["b465", 9.72, -3.08], ["bde4", 10.2, -1.5], ["bfc6", 8.875, 0.798], ["c9b9", 8.875, 2.85],
  ["d03f", 10.298, -1.5], ["db4f", 11.577, 2.85], ["dd45", 11.577, 0.798], ["fa50", 8.875, -3.08],
];

export const KINKED_WALLS: [string, string, string, number?][] = [
  ["w197d", "6698", "6ad8a"], ["w2fb1a", "bfc6", "dd45", 0.1], ["w2fb1b", "2fb1", "6d79"], ["w372a", "372a", "c9b9"],
  ["w5923a", "5923a", "5923b", 0.1], ["w5923b", "5923b", "6d79", 0.1], ["w6ad8a", "6ad8a", "fa50", 0.1], ["w6ad8b", "6ad8a", "7205a"],
  ["w6d79", "6d79", "6698"], ["w719ea", "719ea", "719eb", 0.1], ["w719eb", "719eb", "dd45", 0.1], ["w7205a", "7205a", "7205b", 0.1],
  ["w7205b", "7205a", "197d"], ["w7be9", "719ea", "c9b9", 0.1], ["w849a", "849aa", "849ab", 0.1], ["wa36b", "6ad8b", "a36b", 0.1],
  ["wa8cd", "a8cd", "2fb1"], ["wafdb", "afdba", "372a"], ["wb465", "a36b", "b465", 0.1], ["wbde4", "0d42", "bde4", 0.1],
  ["wbfc6", "0d42", "bfc6", 0.1], ["wc9b9", "c9b9", "db4f"], ["wcd50", "afdbb", "a8cd"], ["wd03fa", "a36b", "d03f", 0.1],
  ["wd03fb", "d03f", "5923b", 0.1], ["wd548", "197d", "afdba"], ["wdb4fa", "719eb", "db4f", 0.1], ["wdb4fb", "db4f", "afdbb"],
  ["wdd45", "dd45", "2fb1", 0.1], ["wfa50a", "b465", "fa50", 0.1], ["wfa50b", "fa50", "6ad8b", 0.1],
];

/** The kinked house's walls and joints, no openings, labels or pieces. */
export function kinkedHouseDoc(): Document {
  return docOf({ joints: KINKED_JOINTS, walls: KINKED_WALLS });
}
