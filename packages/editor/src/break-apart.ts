import { CHAIR_SIZE, add, defaultSize, hasOption, heightsOf, kindConfigs, kindOf, rotateAbout, sortedIds, type Document, type Heights, type LayoutObject, type NewPiece } from "@fm/domain";
import { err, ok, type Point, type Result } from "@fm/protocol";
import { runCommand } from "./commit";
import { visibleDoc } from "./document/open-document";
import type { Host } from "./ports/host";
import { activeStateId, pruneSelection, type EditorState, type Step } from "./state";
import { refuse } from "./toast";
import { aggregateLayout, type AggregateLayout } from "./view/aggregate";

// Break apart (seated.02, .10): a set's table and chairs as independent pieces, in every layout where it stands, each where
// the set draws it. The poses are `aggregateLayout`'s, the one owner of a set's parts; the domain only checks the result.
//
//   one piece ── placePieces { remove: the set, pieces: [table, chair, chair, ...] } ──▶ a table + N loose chairs
//
// A dining set draws its table's long side along its width, while an extending table extends along its depth (seated.09), so
// that table turns a quarter about its centre: same place, and it opens along its length.
//
//   the set's table        the loose one, turned 90°
//   ┌──────────────┐       ┌──────────────┐ ▶ extends this way
//   └──────────────┘       └──────────────┘

type Pose = { at: Point; rotation: number };
type Sizes = NonNullable<NewPiece["size"]>;

/** The table's pose in the world, for a table `depth` deep, turned a quarter or not: its centre stays where the set draws it. */
function tablePose(l: AggregateLayout, p: Pose, turned: boolean, depth: number): Pose {
  const local = { x: l.tableAt.x, y: l.tableAt.y - l.tableSize.d / 2 };
  const centre = rotateAbout(add(local, p.at), p.at, p.rotation);
  const rotation = p.rotation + (turned ? 90 : 0);
  const fromCentre = rotateAbout({ x: 0, y: depth / 2 }, { x: 0, y: 0 }, rotation);
  return { at: add(centre, fromCentre), rotation };
}

/** A part's sizes in each configuration of its kind: w × d, its kind's own extension, the set's elevation, and never above the set. */
function pieceSizes(kind: string, w: number, d: number, set: Heights): Sizes {
  const configs = kindConfigs(kind);
  const own = defaultSize(kind);
  const first = configs[0]?.d ?? 0;
  const each = <T>(value: (c: (typeof configs)[number]) => T): Record<string, T> => Object.fromEntries(configs.map((c) => [c.id, value(c)]));
  return {
    w: each(() => w),
    d: each((c) => d + (c.d - first)),
    h: each((c) => Math.min((own && heightsOf(own, c.id)?.h) ?? set.h, set.h)),
    z: each(() => set.z),
  };
}

const NOT_A_SET = "Only a table or desk with chairs breaks apart";

/**
 * The pieces a set breaks into, with the `remove` that takes the set away, or the reason it can't. Every placement of the
 * set gives each piece a place, on the same surface. The set's chairs are the same in every layout, since a set has one
 * configuration. Its chairs never overlap (seated.23), so a refusal can only be the domain's, on the result.
 */
export function brokenApart(doc: Document, objectId: string): Result<{ remove: string; pieces: NewPiece[] }, string> {
  const object: LayoutObject | undefined = doc.objects[objectId];
  const set = object ? kindOf(object.kind)?.aggregate : null;
  if (!object || !set) return err(NOT_A_SET);
  const placed = Object.values(doc.placements).filter((p) => p.object === objectId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const config = placed[0]?.config;
  if (config === undefined) return err(NOT_A_SET);
  const [w, d, heights] = [object.w[config], object.d[config], heightsOf(object, config)];
  if (w === undefined || d === undefined || heights === null) return err(NOT_A_SET);
  const l = aggregateLayout(object.kind, w, d);
  if (!l) return err(NOT_A_SET);

  const turned = set.chairs === "sides";
  const table = turned ? { w: l.tableSize.d, d: l.tableSize.w } : l.tableSize;
  const size = pieceSizes(l.tableKind, table.w, table.d, heights);
  const tablePiece: NewPiece = {
    kind: l.tableKind,
    size,
    ...(hasOption(object, "computer") && (kindOf(l.tableKind)?.options.includes("computer") ?? false) ? { options: { computer: true } } : {}),
    placements: placed.map((p) => ({ state: p.state, config: l.tableConfig, deck: p.deck, ...tablePose(l, p, turned, table.d) })),
  };
  const round = hasOption(object, "roundChairs");
  const chairSize = pieceSizes("chair", CHAIR_SIZE.w, CHAIR_SIZE.d, heights);
  const chairs = l.chairs.map((c): NewPiece => ({
    kind: "chair",
    size: chairSize,
    ...(round ? { options: { roundChairs: true } } : {}),
    placements: placed.map((p) => ({ state: p.state, deck: p.deck, at: rotateAbout(add(c.at, p.at), p.at, p.rotation), rotation: p.rotation + c.rotation })),
  }));
  return ok({ remove: objectId, pieces: [tablePiece, ...chairs] });
}

/** Properties' Break apart: the one selected set splits, in one undo step, and its pieces in this layout end up selected. */
export function breakApartSelection(state: EditorState, host: Host): Step {
  const ref = state.selection[0];
  const d = state.document;
  if (!d || state.selection.length !== 1 || ref?.table !== "placements" || state.tool.name !== "select" || state.tool.state.kind !== "idle") return { state, effects: [] };
  const doc = visibleDoc(d);
  const object = doc.placements[ref.id]?.object;
  if (object === undefined) return { state, effects: [] };
  const broken = brokenApart(doc, object);
  if (!broken.ok) return refuse(state, broken.error, host);
  const opId = host.newId();
  const out = runCommand(state, { type: "placePieces", opId, ...broken.value }, host);
  const visible = out.state.document ? visibleDoc(out.state.document) : null;
  const layout = activeStateId(out.state);
  const placed = visible ? sortedIds(visible.placements).filter((id) => id.startsWith(`${opId}/`) && visible.placements[id]?.state === layout) : [];
  if (placed.length === 0) return { state: out.state, effects: out.effects };
  return { state: pruneSelection({ ...out.state, selection: placed.map((id) => ({ table: "placements", id })) }), effects: out.effects };
}
