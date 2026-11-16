import { assertNever, err, ok } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document, SheetDrawing } from "../model";
import { isValidId } from "../shape";
import { addWall } from "./add-wall";
import { placeColumn, setColumn } from "./columns";
import { addDeck, setDeck } from "./decks";
import { setDeckFinish } from "./deck-finish";
import { resetWallSide, setOutsideFinish, setRoomWallFinishes, setWallFinish, setWallSide } from "./wall-finish";
import { addDeckHole, setDeckHole } from "./deck-holes";
import { deleteEntities } from "./delete-entities";
import { addDimension, setDimensionOffset } from "./dimensions";
import { duplicatePlacements } from "./duplicate";
import { placePieces } from "./place-pieces";
import { movePlacements } from "./group-objects";
import { labelZone, renameZone, setFinish } from "./labels";
import { moveJoints } from "./move-joints";
import { moveWalls } from "./move-walls";
import { splitWall } from "./split-wall";
import { straightenWalls } from "./straighten-walls";
import { connectJoint } from "./connect-joint";
import { setWallLength } from "./set-wall-length";
import { setWallThickness } from "./set-wall-thickness";
import { setCeiling, setRoofCovering, setWallTop } from "./heights";
import { removeLogo, setLogo } from "./logo";
import { placeUnderlay, removeUnderlay, scaleUnderlay } from "./underlay";
import { movePlacement, placeObject, removePlacement, renameObject, setConfiguration, setObjectKind, setObjectSize, setZoneExtent, setZoneSides } from "./objects";
import { setOption } from "./options";
import { setLinked } from "./link";
import { addOpening, moveOpening, removeOpening, setOpening } from "./openings";
import { setProjectField } from "./project-fields";
import { resizePlacement } from "./resize-placement";
import { addSection, setSection } from "./sections";
import { addArea, setArea } from "./areas";
import { addSheet, deleteSheet, moveSheet, setSheet, setSheetsInPdf } from "./sheets";
import { placeStair } from "./place-stair";
import { setStair, setStairReaches } from "./stairs";
import { addState, copyState, deleteState, renameState } from "./states";
import type { Command, CommandResult } from "./types";

/**
 * Runs a command against a document without modifying it. For a valid input document (every invariant holds) and a
 * command of the `Command` type, the result is a valid document or an error; malformed JSON commands
 * are not shape-checked here. A command that changes nothing returns an empty patch and the input
 * document itself; callers skip it.
 */
export function execute(doc: Document, cmd: Command): CommandResult {
  // One message ("Invalid ID") for malformed IDs from any command; each command also checks its own
  // lookups. Documents are plain objects: an ID such as "constructor" would find an inherited member.
  if (!commandIds(cmd).every(isValidId)) return err(domainError("invalidInput", "Invalid ID"));
  const result = run(doc, cmd);
  if (!result.ok) return result;
  const { patch } = result.value;
  return patch.puts.length === 0 && patch.deletes.length === 0 ? ok({ doc, patch }) : result;
}

function run(doc: Document, cmd: Command): CommandResult {
  switch (cmd.type) {
    case "addWall": return addWall(doc, cmd);
    case "moveJoints": return moveJoints(doc, cmd);
    case "moveWalls": return moveWalls(doc, cmd);
    case "splitWall": return splitWall(doc, cmd);
    case "straightenWalls": return straightenWalls(doc, cmd);
    case "connectJoint": return connectJoint(doc, cmd);
    case "setWallLength": return setWallLength(doc, cmd);
    case "setWallThickness": return setWallThickness(doc, cmd);
    case "setWallTop": return setWallTop(doc, cmd);
    case "setCeiling": return setCeiling(doc, cmd);
    case "addDeck": return addDeck(doc, cmd);
    case "setDeck": return setDeck(doc, cmd);
    case "addDeckHole": return addDeckHole(doc, cmd);
    case "setDeckHole": return setDeckHole(doc, cmd);
    case "placeColumn": return placeColumn(doc, cmd);
    case "setColumn": return setColumn(doc, cmd);
    case "setStairReaches": return setStairReaches(doc, cmd);
    case "setStair": return setStair(doc, cmd);
    case "placeStair": return placeStair(doc, cmd);
    case "labelZone": return labelZone(doc, cmd);
    case "renameZone": return renameZone(doc, cmd);
    case "setFinish": return setFinish(doc, cmd);
    case "setDeckFinish": return setDeckFinish(doc, cmd);
    case "setWallFinish": return setWallFinish(doc, cmd);
    case "setRoomWallFinishes": return setRoomWallFinishes(doc, cmd);
    case "setWallSide": return setWallSide(doc, cmd);
    case "resetWallSide": return resetWallSide(doc, cmd);
    case "setOutsideFinish": return setOutsideFinish(doc, cmd);
    case "setRoofCovering": return setRoofCovering(doc, cmd);
    case "deleteEntities": return deleteEntities(doc, cmd);
    case "placeObject": return placeObject(doc, cmd);
    case "movePlacement": return movePlacement(doc, cmd);
    case "movePlacements": return movePlacements(doc, cmd);
    case "duplicatePlacements": return duplicatePlacements(doc, cmd);
    case "placePieces": return placePieces(doc, cmd);
    case "setConfiguration": return setConfiguration(doc, cmd);
    case "setObjectSize": return setObjectSize(doc, cmd);
    case "setObjectKind": return setObjectKind(doc, cmd);
    case "setOption": return setOption(doc, cmd);
    case "resizePlacement": return resizePlacement(doc, cmd);
    case "renameObject": return renameObject(doc, cmd);
    case "setZoneSides": return setZoneSides(doc, cmd);
    case "setZoneExtent": return setZoneExtent(doc, cmd);
    case "removePlacement": return removePlacement(doc, cmd);
    case "setLinked": return setLinked(doc, cmd);
    case "addState": return addState(doc, cmd);
    case "copyState": return copyState(doc, cmd);
    case "renameState": return renameState(doc, cmd);
    case "deleteState": return deleteState(doc, cmd);
    case "addOpening": return addOpening(doc, cmd);
    case "moveOpening": return moveOpening(doc, cmd);
    case "setOpening": return setOpening(doc, cmd);
    case "removeOpening": return removeOpening(doc, cmd);
    case "setProjectField": return setProjectField(doc, cmd);
    case "addDimension": return addDimension(doc, cmd);
    case "setDimensionOffset": return setDimensionOffset(doc, cmd);
    case "placeUnderlay": return placeUnderlay(doc, cmd);
    case "scaleUnderlay": return scaleUnderlay(doc, cmd);
    case "removeUnderlay": return removeUnderlay(doc);
    case "setLogo": return setLogo(doc, cmd);
    case "removeLogo": return removeLogo(doc);
    case "addSheet": return addSheet(doc, cmd);
    case "setSheet": return setSheet(doc, cmd);
    case "deleteSheet": return deleteSheet(doc, cmd);
    case "moveSheet": return moveSheet(doc, cmd);
    case "setSheetsInPdf": return setSheetsInPdf(doc, cmd);
    case "addSection": return addSection(doc, cmd);
    case "setSection": return setSection(doc, cmd);
    case "addArea": return addArea(doc, cmd);
    case "setArea": return setArea(doc, cmd);
    default: return assertNever(cmd);
  }
}

/** The layouts and decks a sheet's drawings name. */
function drawingIds(drawings: readonly SheetDrawing[]): string[] {
  return drawings.flatMap((d) => (d.deck === null ? [d.layout] : [d.layout, d.deck]));
}

/** Every entity ID the command names. addWall's opId is not one: addWall checks it with its own message. */
function commandIds(cmd: Command): string[] {
  switch (cmd.type) {
    case "addWall": return [cmd.from, cmd.to].flatMap((r) => ("existing" in r ? [r.existing] : []));
    case "moveJoints": return cmd.moves.map((m) => m.jointId);
    case "moveWalls": return [...cmd.walls, ...(cmd.placements ?? [])];
    case "splitWall": return [cmd.wallId]; // the opId is checked by the command
    case "straightenWalls": return [cmd.wallId];
    case "connectJoint": return [cmd.jointId];
    case "setWallLength": return [cmd.wallId];
    case "setWallThickness": return [cmd.wallId];
    case "setWallTop": return [cmd.wallId];
    case "setCeiling": return [];
    case "addDeck": return []; // the opId is checked by the command
    case "setDeck": return [cmd.deckId];
    case "addDeckHole": return []; // the opId and the deck are checked by the command
    case "setDeckHole": return [cmd.holeId];
    case "placeColumn": return []; // the opId is checked by the command
    case "setColumn": return [cmd.wallId];
    case "labelZone": return [cmd.id];
    case "renameZone": return [cmd.id];
    case "setFinish": return [cmd.id];
    case "setDeckFinish": return [cmd.deckId];
    case "setWallFinish": return [cmd.wallId];
    case "setRoomWallFinishes": return [cmd.labelId];
    case "setWallSide": return [cmd.wallId];
    case "resetWallSide": return [cmd.wallId];
    case "setOutsideFinish": return [];
    case "setRoofCovering": return [];
    case "deleteEntities": return cmd.ids.map((r) => r.id);
    case "placeObject": return [cmd.state, ...("existing" in cmd.object ? [cmd.object.existing] : []), ...(typeof cmd.deck === "string" ? [cmd.deck] : [])];
    case "movePlacement": return [cmd.placementId, ...(typeof cmd.deck === "string" ? [cmd.deck] : [])];
    case "setStair": return [cmd.objectId];
    case "setStairReaches": return [cmd.objectId]; // the deck is checked by the command, with its own message
    case "placeStair": return [cmd.state, cmd.deck, ...(typeof cmd.surface === "string" ? [cmd.surface] : [])]; // the opId is checked by the command
    case "movePlacements": return cmd.moves.map((m) => m.placementId);
    case "duplicatePlacements": return cmd.copies.map((c) => c.placementId); // the opId is checked by the command, as placeObject does
    case "placePieces": return cmd.remove === undefined ? [] : [cmd.remove]; // the pieces' ids are checked by the command, in their order
    case "setConfiguration": return [cmd.placementId];
    case "setObjectSize": return [cmd.objectId];
    case "setObjectKind": return [cmd.objectId];
    case "setOption": return [cmd.objectId];
    case "resizePlacement": return [cmd.placementId];
    case "renameObject": return [cmd.objectId];
    case "setZoneSides": return [cmd.placementId];
    case "setZoneExtent": return [cmd.placementId];
    case "removePlacement": return [cmd.placementId];
    case "setLinked": return [cmd.placementId];
    case "addState": return [];
    case "copyState": return [cmd.from];
    case "renameState": return [cmd.stateId];
    case "deleteState": return [cmd.stateId];
    case "addOpening": return [cmd.wall];
    case "moveOpening": return [cmd.openingId];
    case "setOpening": return [cmd.openingId];
    case "removeOpening": return [cmd.openingId];
    case "setProjectField": return []; // the key is checked against PROJECT_FIELDS, with a message naming it
    case "addDimension": return []; // the opId is checked by the command
    case "setDimensionOffset": return [cmd.id];
    case "placeUnderlay": return [cmd.pictureId];
    case "scaleUnderlay": return [];
    case "removeUnderlay": return [];
    case "setLogo": return [];
    case "removeLogo": return [];
    case "addSheet": return [...(cmd.after === null ? [] : [cmd.after]), ...drawingIds(cmd.drawings)]; // the opId is checked by the command
    case "setSheet": return [cmd.sheetId, ...drawingIds(cmd.drawings ?? [])];
    case "deleteSheet": return [cmd.sheetId];
    case "moveSheet": return [cmd.sheetId];
    case "setSheetsInPdf": return [];
    case "addSection": return [];
    case "setSection": return [cmd.sectionId];
    case "addArea": return [];
    case "setArea": return [cmd.areaId];
    default: return assertNever(cmd);
  }
}
