import { MOTIFS, areaM2, areaName, areaRoom, firstLabelId, freeFloor, furnishedRooms, isMotifId, roomFinish, sortedIds, zones, type Document, type Zone, shown } from "@fm/domain";
import { AREA_UNAVAILABLE_SHORT, formatArea, roomSizeText } from "../view/tags";

// The rooms table (spec Behaviour "Area table", export.10): one row per labelled room in name order, with its second
// line (the clear size of a rectangle and the floor's motif), clear area and free floor in a layout (furnished rooms);
// the total of the clear areas. Read by Properties' Rooms section and by each PDF sheet. `labelId` (the room's first
// label) keys a row: names can repeat. Named areas (areas.12) follow their room, by name, as `part` rows keyed by the
// area's ID, with their m² and no free floor; they add nothing to the total. An unnamed room holding areas gets a row,
// "Unnamed room", keyed by its face; an area outside every room has none.

const UNNAMED = "Unnamed room";

type RoomRow = { labelId: string; name: string; detail: string | null; area: string; free: string | null; part?: true };
export type RoomsTable = { rows: RoomRow[]; total: string | null };

export function roomsTable(doc: Document, layout: string | null): RoomsTable {
  const furnished = furnishedRooms(doc);
  const free = layout === null ? null : freeFloor(doc, layout);
  let total = 0;
  const parts = areaRows(doc);
  const rows: { row: RoomRow; key: string; face: string }[] = [];
  for (const z of zones(doc)) {
    const firstLabel = firstLabelId(z);
    const labelled = firstLabel !== null ? doc.zoneLabels[firstLabel]?.name : undefined;
    const name = labelled ?? (parts.has(z.face.key) ? UNNAMED : undefined);
    if (name === undefined) continue;
    const key = firstLabel !== null && labelled !== undefined ? firstLabel : `|room|${z.face.key}`; // "|" is outside the ID alphabet
    if (z.area !== null) total += z.area;
    const f = furnished.has(z.face.key) ? free?.get(z.face.key) : undefined;
    rows.push({
      key: `${name.toLowerCase()}|${key}`,
      face: z.face.key,
      row: { labelId: key, name, detail: detailOf(doc, z), area: z.area !== null ? formatArea(z.area) : AREA_UNAVAILABLE_SHORT, free: f === undefined || f === null ? null : `${shown(f, 1)} m²` },
    });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows: rows.flatMap((r) => [r.row, ...(parts.get(r.face) ?? [])]), total: rows.length > 0 ? formatArea(total) : null };
}

/** Each room's named areas as rows, by name then ID, keyed by the room's face; areas outside every room are left out. */
function areaRows(doc: Document): Map<string, RoomRow[]> {
  const out = new Map<string, RoomRow[]>();
  const ids = sortedIds(doc.areas).sort((a, b) => {
    const [x, y] = [areaName(doc.areas[a] ?? { name: "" }).toLowerCase(), areaName(doc.areas[b] ?? { name: "" }).toLowerCase()];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const id of ids) {
    const a = doc.areas[id];
    const face = areaRoom(doc, id)?.face.key;
    if (!a || face === undefined) continue;
    const m2 = areaM2(doc, id);
    out.set(face, [...(out.get(face) ?? []), { labelId: id, name: areaName(a), detail: null, area: m2 === null ? AREA_UNAVAILABLE_SHORT : formatArea(m2), free: null, part: true }]);
  }
  return out;
}

/** "2.30 × 1.40 m · Mosaic", "Mosaic" (no size text: not a rectangle, or with holes), the size alone, or null (finishes.11). */
function detailOf(doc: Document, z: Zone): string | null {
  const size = roomSizeText(z);
  const motif = roomFinish(doc, z)?.motif;
  const name = isMotifId(motif) ? MOTIFS[motif].name : null;
  if (name === null) return size;
  return size === null ? name : `${size} · ${name}`;
}
