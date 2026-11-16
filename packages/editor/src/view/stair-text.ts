import { assertNever, deckLabel, deckView, shown, type Document, type StairCheck } from "@fm/domain";

// One wording for a stair's checks (stairs.20): Properties shows each with a tick or a warning, get_drawing lists the
// failed ones. "<Label> <value> m[ over the flight] (<bound> wanted)": both bounds "a–b wanted", a minimum "X wanted",
// a maximum "at most X"; metres to the millimetre, widths and headroom to the centimetre, degrees whole.

type Measured = Exclude<StairCheck, { id: "reach" }>;

/** A measured check's name, its digits and its value's unit. */
function wording(id: Measured["id"]): { label: string; digits: number; unit: string } {
  switch (id) {
    case "riser": return { label: "Riser", digits: 3, unit: " m" };
    case "going": return { label: "Going", digits: 3, unit: " m" };
    case "step": return { label: "Step (2 risers + going)", digits: 3, unit: " m" };
    case "width": return { label: "Width", digits: 2, unit: " m" };
    case "slope": return { label: "Slope", digits: 0, unit: "°" };
    case "spacing": return { label: "Rung spacing", digits: 3, unit: " m" };
    case "angle": return { label: "Angle", digits: 0, unit: "°" };
    case "clearWidth": return { label: "Clear width", digits: 2, unit: " m" };
    case "walkingTread": return { label: "Walking tread", digits: 3, unit: " m" };
    case "rise": return { label: "Rise", digits: 2, unit: " m" };
    case "headroom": return { label: "Headroom", digits: 2, unit: " m over the flight" };
    default: return assertNever(id);
  }
}

/** A check's short name, as Properties labels its row. */
export function stairCheckLabel(c: StairCheck): string {
  return c.id === "reach" ? "Reach" : wording(c.id).label;
}

/** "Riser 0.215 m (0.178–0.305 wanted)", "Headroom 1.27 m over the flight (1.88 wanted)", "Doesn't reach the Loft". */
export function stairCheckText(doc: Document, c: StairCheck): string {
  if (c.id === "reach") {
    const deck = deckView(doc, c.deck);
    const name = deck ? deckLabel(deck) : "deck";
    return c.ok ? `Reaches the ${name}` : `Doesn't reach the ${name}`;
  }
  const { label, digits, unit } = wording(c.id);
  const n = (v: number): string => shown(v, digits);
  const bounds = c.min !== null && c.max !== null ? ` (${n(c.min)}–${n(c.max)} wanted)` : c.min !== null ? ` (${n(c.min)} wanted)` : c.max !== null ? ` (at most ${n(c.max)})` : "";
  return `${label} ${n(c.value)}${unit}${bounds}`;
}
