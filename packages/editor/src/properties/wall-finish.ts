import { LOWER_HEIGHT, PLAIN_WHITE, WALL_SIDES, assertNever, firstLabelId, motifsFor, sideFinishes, sidesOf, wallSideRooms, zones, type Document, type ShownSide, type SideFacing, type WallSide } from "@fm/domain";
import type { Field } from "../view/view-model-types";
import { field, parseNumber, type FieldCommand } from "./fields";
import { finishCommand, finishRows, finishSummary } from "./zone-finish";

// A wall's sides in Properties (surfaces step 04, inherit step 05, AC-04, AC-05): a section per side, named by what it
// faces. An inherited side shows what it shows (read-only), where it comes from, and Customize, which copies it into a
// custom side (setWallSide, one undo step). A custom side shows Custom with Reset (resetWallSide), then its Finish, which
// offers no None (inherit.02), and Lower, edited part by part (setWallFinish).

/** The name of the room of face `key`; "" for an unlabelled room. */
function roomName(doc: Document, key: string): string {
  const zone = zones(doc).find((z) => z.face.key === key);
  const label = zone ? firstLabelId(zone) : null;
  return (label === null ? null : doc.zoneLabels[label]?.name) || "";
}

/** Whether two sides face the same thing: the same room, both outside, or both a loft. */
function sameFacing(a: SideFacing, b: SideFacing): boolean {
  return a.kind === b.kind && (a.kind !== "room" || b.kind !== "room" || a.key === b.key);
}

/**
 * Each side's section name: the room it faces ("Bath side", "Room side" unlabelled) or "Outside"; "Left side" and
 * "Right side", seen from joint a, when both sides face the same room or both face none (inherit.05), as a wall
 * standing on a loft always does (spec: levels).
 */
export function sideNames(doc: Document, wallId: string): Record<WallSide, string> {
  const rooms = wallSideRooms(doc, wallId);
  if (!rooms || sameFacing(rooms.left, rooms.right)) return { left: "Left side", right: "Right side" };
  const name = (facing: SideFacing): string => {
    switch (facing.kind) {
      case "room": return `${roomName(doc, facing.key) || "Room"} side`;
      case "outside": return "Outside";
      case "loft": return "Loft side";
      default: return assertNever(facing);
    }
  };
  return { left: name(rooms.left), right: name(rooms.right) };
}

/**
 * Where an inherited side's finish comes from: "Bath's walls", "Outside walls", "No room" for an unlabelled one, or
 * "On a loft" for a wall standing on one, which inherits nothing (spec: levels).
 */
function sourceOf(doc: Document, wallId: string, side: WallSide): string {
  const facing = wallSideRooms(doc, wallId)?.[side] ?? { kind: "outside" };
  switch (facing.kind) {
    case "room": {
      const room = roomName(doc, facing.key);
      return room === "" ? "No room" : `${room}'s walls`;
    }
    case "outside": return "Outside walls";
    case "loft": return "On a loft";
    default: return assertNever(facing);
  }
}

/** An inherited side: its finish and band read-only, then its source with Customize. */
function inheritedRows(doc: Document, wallId: string, side: WallSide, section: string, shown: ShownSide | null): Field[] {
  const fixed = (id: string, label: string, value: string, f: { colour: string; motif: string } | null): Field =>
    ({ ...field(section, id, label, value, null), finish: { colour: f?.colour ?? null, motif: f?.motif ?? null, open: false, fixed: true } });
  const band = shown?.lower ?? null;
  return [
    fixed(`${side}.shows`, "Finish", finishSummary(shown?.finish ?? null), shown?.finish ?? null),
    ...(band ? [fixed(`${side}.showsLower`, "Lower", finishSummary(band.finish, band.height), band.finish)] : []),
    { ...field(section, `${side}.customize`, sourceOf(doc, wallId, side), "Customize", null, false), action: true },
  ];
}

/** A wall's side sections; none for a column. */
export function wallSideFields(doc: Document, wallId: string): Field[] {
  const wall = doc.walls[wallId];
  const shown = sideFinishes(doc, wallId);
  if (!wall || wall.column || !shown) return [];
  const names = sideNames(doc, wallId);
  return WALL_SIDES.flatMap((side) => {
    const s = shown[side];
    if (s?.source !== "custom") return inheritedRows(doc, wallId, side, names[side], s);
    const lower = s.lower;
    return [
      { ...field(names[side], `${side}.reset`, "Custom", "Reset", null, false), action: true },
      ...finishRows(names[side], `${side}.`, { id: "finish", label: "Finish", required: true }, motifsFor("wall"), s.finish),
      ...finishRows(names[side], `${side}.lower.`, { id: "motif", label: "Lower" }, motifsFor("wall"), lower?.finish ?? null, lower ? { id: `${side}.lower.height`, height: lower.height } : undefined),
    ];
  });
}

/** A side field's command ("left.customize", "left.colour", "left.lower.height"…), or null for another field. */
export function wallSideCommand(doc: Document, wallId: string, fieldId: string, value: string): FieldCommand {
  const [side, first, second] = fieldId.split(".");
  const wall = doc.walls[wallId];
  if (!wall || (side !== "left" && side !== "right") || first === undefined) return null;
  if (first === "customize") { // what the side shows becomes its own (inherit.04)
    const shown = sideFinishes(doc, wallId)?.[side] ?? null;
    const band = shown?.lower ?? null;
    return { type: "setWallSide", wallId, side, finish: shown?.finish ?? PLAIN_WHITE, lower: band?.finish ?? null, ...(band ? { height: band.height } : {}) };
  }
  if (first === "reset") return { type: "resetWallSide", wallId, side };
  const custom = sidesOf(wall)?.[side] ?? null;
  if (!custom) return null; // only a custom side is edited in place
  if (first !== "lower") return finishCommand(custom.finish, "finish", first, value, (finish) => ({ type: "setWallFinish", wallId, side, part: "finish", finish }));
  const lower = custom.lower;
  const height = lower?.height ?? LOWER_HEIGHT.default;
  if (second === "height") {
    const h = parseNumber(value);
    if (!Number.isFinite(h)) return "notANumber";
    return lower ? { type: "setWallFinish", wallId, side, part: "lower", finish: lower.finish, height: h } : null;
  }
  if (second === undefined) return null;
  return finishCommand(lower?.finish ?? null, "motif", second, value, (finish) => ({ type: "setWallFinish", wallId, side, part: "lower", finish, ...(finish ? { height } : {}) }));
}
