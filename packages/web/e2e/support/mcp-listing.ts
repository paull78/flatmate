// Reading get_drawing's pieces (mcp.12): a piece placed the same in every layout lists one `placement`, otherwise
// `placements` per layout, null where it is absent. The e2e package has no MCP types, so these read plain values.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A listed piece's place in one layout, or null where it has none. */
export function placeIn(o: unknown, layout: string): unknown {
  if (!isRecord(o)) return null;
  if ("placement" in o) return o.placement;
  return isRecord(o.placements) ? (o.placements[layout] ?? null) : null;
}

/** A listed piece's places by layout, for the layouts given (get_drawing's `layouts`). */
export function placesOf(o: unknown, layouts: readonly string[]): Record<string, unknown> {
  if (isRecord(o) && "placement" in o) return Object.fromEntries(layouts.map((l) => [l, o.placement]));
  return isRecord(o) && isRecord(o.placements) ? { ...o.placements } : {};
}

/** A listed piece's first place in any layout, or undefined. */
export function anyPlace(o: unknown): Record<string, unknown> | undefined {
  if (!isRecord(o)) return undefined;
  if (isRecord(o.placement)) return o.placement;
  return isRecord(o.placements) ? Object.values(o.placements).find(isRecord) : undefined;
}

/** get_drawing's layout ids, in order. */
export function layoutIds(listing: unknown): string[] {
  const layouts = isRecord(listing) && Array.isArray(listing.layouts) ? listing.layouts : [];
  return layouts.flatMap((s: unknown) => (isRecord(s) && typeof s.id === "string" ? [s.id] : []));
}
