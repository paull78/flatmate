import type { DeckPreset, Guard, HandrailKind, PlanSide, MotifId, OpeningKind, SheetKind, SheetSize, SheetSplit, StairEdgeShape, WallTop } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Region } from "./drawing";

// The tools' contract: what each tool takes and answers. tools.ts composes the groups that implement it; the groups
// and the kit import these types from here, never from tools.ts, so the tool files form no cycle.

export type Reply = { text: string; isError: boolean };
/** look's answer: the picture and its caption, or a refusal as text. */
export type LookReply = { png: Uint8Array; text: string; isError: false } | Reply;
/** A wall to add; without a thickness it gets the domain default (0.20 m). */
/** A wall to add; `on` is its base, "floor" (the default) or a deck ID. */
export type NewWall = { a: Point; b: Point; thickness?: number | undefined; on?: string | undefined };
/** A door to add; what it leaves out gets the domain default (a 0.80 m swing door opening left, hinged at a). */
type NewDoor = {
  wall: string;
  offset: number;
  width?: number | undefined;
  kind?: OpeningKind | undefined;
  side?: "left" | "right" | undefined;
  hinge?: "a" | "b" | undefined;
  glazed?: boolean | undefined;
  height?: number | undefined;
};
/** A window's sheer curtain and shutter box (hangings.04): "none" and false take them off. */
export type Dressing = { sheer?: "none" | "glass" | "floor" | undefined; shutterBox?: boolean | undefined };
/** set_opening's fields: any of them, the rest kept (sills.08). */
export type OpeningChange = Dressing & {
  opening: string;
  offset?: number | undefined;
  kind?: OpeningKind | undefined;
  width?: number | undefined;
  side?: "left" | "right" | undefined;
  hinge?: "a" | "b" | undefined;
  glazed?: boolean | undefined;
  sill?: number | undefined;
  height?: number | undefined;
};
/** One side for set_zones: on or off, the kind's default, or a depth and insets (numbers left out keep theirs). */
export type ZoneArg = boolean | "default" | { depth?: number | undefined; start?: number | undefined; end?: number | undefined };
/** A deck's fields for add_deck and set_deck: a centre (x, y), a size, a rotation, a top and the solid flag. */
export type DeckArgs = {
  name?: string | undefined; centre?: Point | undefined; width?: number | undefined; depth?: number | undefined;
  rotation?: number | undefined; top?: number | undefined; solid?: boolean | undefined; guard?: Guard | undefined;
  guards?: { [S in PlanSide]?: GuardArg | undefined } | undefined;
};
/** A guard as Claude gives it: a kind, a height, or both; what's left out is kept (edges.15). */
export type GuardArg = { kind?: Guard | undefined; height?: number | undefined };

/** A sheet's fields for add_sheet and set_sheet: a drawing is a layout and a loft's deck, or the floor without one. */
export type SheetArgs = {
  title?: string | undefined; inPdf?: boolean | undefined; scale?: number | "general" | undefined; split?: SheetSplit | undefined; framing?: Point | undefined;
  finishes?: boolean | undefined; marks?: boolean | undefined; drawings?: { layout: string; deck?: string | undefined }[] | undefined; text?: string | undefined; size?: SheetSize | undefined; section?: string | undefined;
};

export type DrawingTools = {
  listProjects(): Promise<Reply>;
  createProject(args: { name: string }): Promise<Reply>;
  openProject(args: { id: string }): Promise<Reply>;
  getDrawing(args?: { region?: Region | undefined }): Promise<Reply>;
  drawRoom(args: { corner: Point; width: number; depth: number; thickness?: number | undefined }): Promise<Reply>;
  addWall(args: NewWall): Promise<Reply>;
  addWalls(args: { walls: NewWall[] }): Promise<Reply>;
  setWallLength(args: { wall: string; length: number }): Promise<Reply>;
  setWallThickness(args: { wall: string; thickness: number }): Promise<Reply>;
  setWallTop(args: { wall: string; top: number | "ceiling" }): Promise<Reply>;
  setCeiling(args: CeilingArgs): Promise<Reply>;
  moveJoint(args: { joint: string; to: Point }): Promise<Reply>;
  moveWalls(args: { walls: string[]; by: Point; objects?: string[] | undefined; layout?: string | undefined }): Promise<Reply>;
  splitWall(args: { wall: string; offset: number }): Promise<Reply>;
  straightenWall(args: { wall: string }): Promise<Reply>;
  labelRoom(args: { point: Point; name: string }): Promise<Reply>;
  rename(args: { id: string; name: string }): Promise<Reply>;
  setFinish(args: {
    label?: string | undefined; deck?: string | undefined; motif?: MotifId | "none" | undefined; colour?: string | undefined; strength?: number | undefined; size?: number | undefined; angle?: number | undefined;
    wall?: string | undefined; side?: "left" | "right" | undefined; wallsOf?: string | undefined; roof?: true | undefined; outside?: true | undefined; reset?: true | undefined; lower?: boolean | undefined; height?: number | undefined;
  }): Promise<Reply>;
  setProjectField(args: { key: string; value: string }): Promise<Reply>;
  delete(args: { ids: string[]; layout?: string | undefined }): Promise<Reply>;
  addDeck(args: DeckArgs & { preset?: DeckPreset | undefined; centre: Point; width: number; depth: number }): Promise<Reply>;
  setDeck(args: DeckArgs & { deck: string }): Promise<Reply>;
  addHole(args: { deck: string; centre: Point; width: number; depth: number; guard?: GuardArg | undefined }): Promise<Reply>;
  setHole(args: { hole: string; centre?: Point | undefined; width?: number | undefined; depth?: number | undefined; guard?: GuardArg | undefined }): Promise<Reply>;
  addArea(args: { name?: string | undefined; centre: Point; width: number; depth: number }): Promise<Reply>;
  setArea(args: { area: string; name?: string | undefined; centre?: Point | undefined; width?: number | undefined; depth?: number | undefined }): Promise<Reply>;
  addColumn(args: { centre: Point; width: number; depth: number; rotation?: number | undefined; on?: string | undefined; top?: WallTop | undefined }): Promise<Reply>;
  setColumn(args: { column: string; centre?: Point | undefined; width?: number | undefined; depth?: number | undefined; rotation?: number | undefined; top?: WallTop | undefined }): Promise<Reply>;
  placeObject(args: {
    layout: string; kind: string; centre: Point; rotation?: number | undefined; name?: string | undefined; preset?: string | undefined; on?: string | undefined;
    reaches?: string | undefined; height?: number | undefined; width?: number | undefined; depth?: number | undefined; everyLayout?: boolean | undefined;
  }): Promise<Reply>;
  moveObject(args: {
    layout: string; object?: string | undefined; objects?: string[] | undefined; turn?: number | undefined; centre?: Point | undefined; rotation?: number | undefined; on?: string | undefined; reaches?: string | undefined; everyLayout?: boolean | undefined;
  }): Promise<Reply>;
  addStair(args: { layout: string; kind: string; deck: string; at: Point; shape?: StairEdgeShape | undefined; handrail?: HandrailKind | undefined }): Promise<Reply>;
  setConfiguration(args: { layout: string; object: string; config: string }): Promise<Reply>;
  setStair(args: { object: string; riser?: number | null | undefined; going?: number | undefined; handrail?: HandrailKind | undefined; handrailLeft?: HandrailKind | undefined; handrailRight?: HandrailKind | undefined; hooks?: boolean | undefined; leftEntry?: boolean | undefined }): Promise<Reply>;
  setSize(args: {
    object: string; preset?: string | undefined; config?: string | undefined; width?: number | undefined; depth?: number | undefined;
    height?: number | undefined; elevation?: number | "ceiling" | undefined; backArm?: number | undefined; leftArm?: number | undefined;
  }): Promise<Reply>;
  setZones(args: { layout: string; object: string; front?: ZoneArg | undefined; back?: ZoneArg | undefined; left?: ZoneArg | undefined; right?: ZoneArg | undefined }): Promise<Reply>;
  setOpensInto(args: { object: string; into: string }): Promise<Reply>;
  setDesk(args: { object: string; computer: boolean }): Promise<Reply>;
  setChairs(args: { object: string; round: boolean }): Promise<Reply>;
  breakApart(args: { object: string }): Promise<Reply>;
  placeSet(args: { set: string; layout: string; centre: Point; rotation?: number }): Promise<Reply>;
  addDoor(args: NewDoor): Promise<Reply>;
  addWindow(args: { wall: string; offset: number; width?: number | undefined; kind?: OpeningKind | undefined; side?: "left" | "right" | undefined; hinge?: "a" | "b" | undefined; sill?: number | undefined; height?: number | undefined } & Dressing): Promise<Reply>;
  setOpening(args: OpeningChange): Promise<Reply>;
  addLayout(args: { name: string }): Promise<Reply>;
  copyLayout(args: { from: string; name: string }): Promise<Reply>;
  addDimension(args: { from: Point; to: Point; offset: number }): Promise<Reply>;
  addSection(args: { a: Point; b: Point; side: "left" | "right"; depth?: number | undefined }): Promise<Reply>;
  look(args: { region?: Region | undefined; view?: "plan" | "3d" | "section" | undefined; yaw?: number | undefined; tilt?: number | undefined; layout?: string | undefined; section?: string | undefined; roof?: boolean | undefined }): Promise<LookReply>;
  scaleUnderlay(args: { a: Point; b: Point; distance: number }): Promise<Reply>;
  addSheet(args: SheetArgs & { kind: SheetKind; title: string; after?: string | undefined }): Promise<Reply>;
  setSheet(args: SheetArgs & { sheet: string }): Promise<Reply>;
  deleteSheet(args: { sheet: string }): Promise<Reply>;
  moveSheet(args: { sheet: string; index: number }): Promise<Reply>;
  readReport(args: { sheet: string }): Promise<Reply>;
};

/** set_ceiling's arguments (roofs.14): a preset, or the shape and stored values, or a high side for the pitch. */
export type CeilingArgs = {
  preset?: "tinyShed" | "tinyGable" | "smallShed" | "smallGable" | undefined;
  shape?: "flat" | "shed" | "gable" | undefined;
  height?: number | undefined;
  pitch?: number | undefined;
  highSide?: number | undefined;
  falls?: "lower" | "upper" | "left" | "right" | undefined;
  overhang?: number | undefined;
};
