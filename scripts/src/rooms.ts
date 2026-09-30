import { emptyDocument, execute, rectangleRoom, zones } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";

export type RoomLine = { room: string; area: string };

/** Spec §2.3 "Scripts / AI agent": a 4 × 5 m room, a divider and two labels, through the domain API only. */
export function buildRoom(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
  const more: Command[] = [
    { type: "addWall", opId: "divider", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 5 } } },
    { type: "labelZone", id: "kitchen", at: { x: 1, y: 2.5 }, name: "Kitchen" },
    { type: "labelZone", id: "living", at: { x: 3, y: 2.5 }, name: "Living" },
  ];
  for (const cmd of more) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

export function describeRooms(doc: Document): RoomLine[] {
  return zones(doc)
    .map((z) => ({
      room: z.labelIds.map((id) => doc.zoneLabels[id]?.name ?? id).join(" / ") || "(unlabelled)",
      area: z.area === null ? "Area unavailable" : `${z.area.toFixed(2)} m²`,
    }))
    .sort((a, b) => a.room.localeCompare(b.room));
}
