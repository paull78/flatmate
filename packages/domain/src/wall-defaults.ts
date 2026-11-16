import { finishProblem, motifDefaults, type Finish } from "./finishes";
import { CEILING_ID, type Ceiling, type Document, type SideFinish, type ZoneLabel } from "./model";
import { lowerHeightProblem } from "./wall-sides";

// The walls' defaults (inherit.01, .07): a room's on its label (`walls`, `wallsLower`, `wallsLowerHeight`), the house's
// outside walls' on the ceiling row (`outside`, `outsideLower`, `outsideLowerHeight`), flat like a wall's custom sides.
// Read and written here only; a side shows them unless customised (`sideFinishes`).

/** What Customize starts from on a side that shows nothing: a custom side needs a finish (inherit.02). */
export const PLAIN_WHITE: Finish = { ...motifDefaults("plain"), colour: "#f2f0eb" };

/** A finish and its band from three stored fields, or null when neither is set. */
function read(finish: Finish | undefined, lower: Finish | undefined, height: number | undefined): SideFinish | null {
  const band = lower !== undefined && height !== undefined ? { finish: lower, height } : null;
  return finish === undefined && band === null ? null : { finish: finish ?? null, lower: band };
}

/** A room's walls default, as stored on its label. */
export const roomWallsOf = (label: ZoneLabel): SideFinish | null => read(label.walls, label.wallsLower, label.wallsLowerHeight);

/** The house's outside walls default, as stored on the ceiling row. */
export function outsideOf(doc: Document): SideFinish | null {
  const c = doc.ceilings[CEILING_ID];
  return c ? read(c.outside, c.outsideLower, c.outsideLowerHeight) : null;
}

/** The label with this walls default and nothing left over (null: none). */
export function withRoomWalls(label: ZoneLabel, value: SideFinish | null): ZoneLabel {
  const out: ZoneLabel = { id: label.id, at: label.at, name: label.name, finish: label.finish };
  if (value?.finish) out.walls = value.finish;
  if (value?.lower) {
    out.wallsLower = value.lower.finish;
    out.wallsLowerHeight = value.lower.height;
  }
  return out;
}

/** The ceiling row with this outside default and nothing left over (null: none); its other fields kept. */
export function withOutside(ceiling: Ceiling, value: SideFinish | null): Ceiling {
  const out: Ceiling = { ...ceiling };
  delete out.outside;
  delete out.outsideLower;
  delete out.outsideLowerHeight;
  if (value?.finish) out.outside = value.finish;
  if (value?.lower) {
    out.outsideLower = value.lower.finish;
    out.outsideLowerHeight = value.lower.height;
  }
  return out;
}

/** The ceiling row's outside fields alone, for a command that rebuilds the row (setCeiling). */
export function outsideFields(ceiling: Ceiling | undefined): Pick<Ceiling, "outside" | "outsideLower" | "outsideLowerHeight"> {
  if (!ceiling) return {};
  return {
    ...(ceiling.outside ? { outside: ceiling.outside } : {}),
    ...(ceiling.outsideLower ? { outsideLower: ceiling.outsideLower } : {}),
    ...(ceiling.outsideLowerHeight !== undefined ? { outsideLowerHeight: ceiling.outsideLowerHeight } : {}),
  };
}

/** The three stored fields' first broken rule, naming the field ("wallsLower.motif must be…"), or null (I8). */
export function defaultProblem(fields: { finish: Finish | undefined; lower: Finish | undefined; height: number | undefined }, names: readonly [string, string, string]): string | null {
  const [fName, lName, hName] = names;
  if ((fields.lower === undefined) !== (fields.height === undefined)) return `${lName} and ${hName} go together`;
  const named = (key: string, given: Finish | undefined): string | null => {
    const problem = given === undefined ? null : finishProblem(given, "wall");
    return problem ? problem.replace(/^finish\./, `${key}.`) : null;
  };
  const issue = named(fName, fields.finish) ?? named(lName, fields.lower) ?? (fields.height === undefined ? null : lowerHeightProblem(fields.height));
  return issue && issue.startsWith("height") ? `${hName} ${issue.slice("height ".length)}` : issue;
}
