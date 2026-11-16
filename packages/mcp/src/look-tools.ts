import { orderedStates } from "@fm/domain";
import { DEFAULT_ANGLES, LOOK_LONG_SIDE, lookPicture, lookScene3d, lookSection, type LookPicture } from "@fm/editor";
import { toSvg } from "@fm/export";
import { look3dPng } from "./look3d-png";
import { svgToPng } from "./rasterise";
import { NO_DRAWING } from "./session";
import { fail, noLayout, type ToolKit } from "./tool-kit";
import type { DrawingTools, LookReply } from "./tool-types";

// The underlay (import.08, .12, .13): look translates the editor's lookPicture to SVG and rasterises it; in 3D it draws
// the editor's faces with raster3d (real3d.11), and a section as the editor's lookSection (AC-11). Its reply is the PNG and the caption. scale_underlay is the domain's scaleUnderlay command. Neither reply may carry the picture's
// data (AC-10): scale_underlay reads no patch (its patch holds the whole row), and a failed render never echoes the
// SVG, which embeds the data.

type LookTools = Pick<DrawingTools, "look" | "scaleUnderlay">;


/** A region without area would give look an infinite zoom; the schema refuses it too. */
const FLAT_REGION = "The region needs min below max on both axes";
const NOT_DRAWN = "Could not draw the picture";

/** A picture from the editor as PNG and caption. One SVG unit is one look pixel, so fitting the long side keeps its size. */
function rendered(picture: LookPicture | { refused: string }): LookReply {
  if ("refused" in picture) return fail(picture.refused);
  try {
    return { png: svgToPng(toSvg(picture.primitives, picture.frame), LOOK_LONG_SIDE), text: picture.caption, isError: false };
  } catch (e) {
    console.error("[fm-mcp] look could not render", e); // stderr: stdout is the MCP protocol
    return fail(NOT_DRAWN);
  }
}

export function lookTools({ session, edit }: ToolKit): LookTools {
  return {
    async look({ region, view = "plan", yaw, tilt, layout: state, section, roof }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (view !== "plan" && region) return fail("A region applies to the plan view only");
      if (view === "plan" && (yaw !== undefined || tilt !== undefined)) return fail("A yaw and a tilt apply to the 3D view only");
      if (view !== "3d" && roof !== undefined) return fail("roof applies to the 3D view only");
      if (view === "section" && (yaw !== undefined || tilt !== undefined)) return fail("A yaw and a tilt apply to the 3D view only");
      if (view !== "section" && section !== undefined) return fail('A section applies to view "section" only');
      if (region && !(region.min.x < region.max.x && region.min.y < region.max.y)) return fail(FLAT_REGION);
      const box = region ? { minX: region.min.x, minY: region.min.y, maxX: region.max.x, maxY: region.max.y } : null;
      if (state !== undefined && !Object.hasOwn(doc.states, state)) return fail(noLayout(state)); // the editor's text says "layout state"
      const first = orderedStates(doc)[0]?.id ?? "";
      if (view === "section") return section === undefined ? fail("Pass section: a letter from get_drawing's sections") : rendered(lookSection(doc, section, state ?? first));
      if (view === "3d") {
        const scene = lookScene3d(doc, state ?? first, { yaw: yaw ?? DEFAULT_ANGLES.yaw, tilt: tilt ?? DEFAULT_ANGLES.tilt }, undefined, roof ?? false); // the range is the editor's (real3d.23)
        if ("refused" in scene) return fail(scene.refused);
        return { png: look3dPng(scene), text: scene.caption, isError: false };
      }
      return rendered(lookPicture(doc, box, state));
    },
    async scaleUnderlay({ a, b, distance }) {
      return edit({ type: "scaleUnderlay", a, b, distance }, () => a);
    },
  };
}
