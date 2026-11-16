// A real house's walls, as get_drawing listed them (thickness 0.10 where the listing gave one, else 0.20),
// as add_walls takes them, so a test can draw the house into a project. A copy of packages/domain/test/fixtures/kinked-house.ts
// (and the editor's): keep them alike. The straight cycle's concrete case (spec AC-11, AC-13, AC-16, AC-24).

type P = [number, number];
const J: Record<string, P> = {
  "0d42": [8.875, -1.5], "197d": [3, -6], "2fb1": [13, 0.798], "372a": [7.256, 2.84], "5923a": [10.9, -0.5], "5923b": [10.9, -1.5],
  "6698": [13, -6], "6ad8a": [8.875, -6], "6ad8b": [8.875, -2.5], "6d79": [13, -1.5], "719ea": [8.875, 1.8], "719eb": [11.577, 1.8],
  "7205a": [7.236, -6], "7205b": [7.236, -4.6], "849aa": [7.236, -1.5], "849ab": [7.236, 0.798], a36b: [9.875, -2.5], a8cd: [13, 1.79],
  afdba: [3, 2.84], afdbb: [13, 2.85], b465: [9.72, -3.08], bde4: [10.2, -1.5], bfc6: [8.875, 0.798], c9b9: [8.875, 2.85],
  d03f: [10.298, -1.5], db4f: [11.577, 2.85], dd45: [11.577, 0.798], fa50: [8.875, -3.08],
};
const W: [string, string, number?][] = [
  ["6698", "6ad8a"], ["bfc6", "dd45", 0.1], ["2fb1", "6d79"], ["372a", "c9b9"], ["5923a", "5923b", 0.1], ["5923b", "6d79", 0.1], ["6ad8a", "fa50", 0.1], ["6ad8a", "7205a"],
  ["6d79", "6698"], ["719ea", "719eb", 0.1], ["719eb", "dd45", 0.1], ["7205a", "7205b", 0.1], ["7205a", "197d"], ["719ea", "c9b9", 0.1], ["849aa", "849ab", 0.1], ["6ad8b", "a36b", 0.1],
  ["a8cd", "2fb1"], ["afdba", "372a"], ["a36b", "b465", 0.1], ["0d42", "bde4", 0.1], ["0d42", "bfc6", 0.1], ["c9b9", "db4f"], ["afdbb", "a8cd"], ["a36b", "d03f", 0.1],
  ["d03f", "5923b", 0.1], ["197d", "afdba"], ["719eb", "db4f", 0.1], ["db4f", "afdbb"], ["dd45", "2fb1", 0.1], ["b465", "fa50", 0.1], ["fa50", "6ad8b", 0.1],
];

/** The kinked house's walls for add_walls, in the listing's order. */
export const KINKED_WALLS = W.map(([a, b, thickness]) => {
  const [fa, fb] = [J[a], J[b]];
  if (!fa || !fb) throw new Error(`missing joint ${a} or ${b}`);
  return { a: { x: fa[0], y: fa[1] }, b: { x: fb[0], y: fb[1] }, ...(thickness === undefined ? {} : { thickness }) };
});

/** A kinked-house joint's point by the listing's short id. */
export function kinkedPoint(id: string): { x: number; y: number } {
  const p = J[id];
  if (!p) throw new Error(`no joint ${id}`);
  return { x: p[0], y: p[1] };
}
