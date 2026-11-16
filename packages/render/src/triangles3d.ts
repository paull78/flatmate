import earcut from "earcut";
import { colorChannels, newell, type Face3d, type Point3 } from "@fm/editor";
import { LAYOUT3D } from "./layout";

// The 3D view's vertex data (heights.34; in the render format since webgpu.09): the faces cut into triangles for the
// depth buffer, so their order doesn't matter. Each triangle is wound as its face is, from outside (real3d.12): earcut
// drops a ring's orientation, so it is put back from the face's own normal, and back-face culling can work. Each face's
// outline becomes line pairs for the edges, in the edge colour, after its own lines (a floor's joints) in theirs, unless
// the face says `outline: false` (a floor pattern's shape, shown.12): a shader can't switch a uniform between two draws
// of one WebGPU pass (webgpu.08), so the colour travels in the vertices.

/** Floats per vertex: world x, y, z (metres) then r, g, b (LAYOUT3D.face3d). */
export const VERTEX_FLOATS = LAYOUT3D.face3d.strideFloats;

const snap = (v: number): number => Math.round(v * 1e6) / 1e6; // earcut needs hole edges that touch the ring to match exactly

/** The two in-plane axes of a flat face with normal `n`: the axis it leans on least is dropped. */
function flatten(n: Point3): (p: Point3) => [number, number] {
  const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  if (az >= ax && az >= ay) return (p) => [snap(p.x), snap(p.y)];
  if (ay >= ax) return (p) => [snap(p.x), snap(p.z)];
  return (p) => [snap(p.y), snap(p.z)];
}

/**
 * The faces as triangles wound as each face is, and as segments each face's lines in their colours then its outline in
 * `edgeColor`, `VERTEX_FLOATS` per vertex.
 */
export function triangles3d(faces: readonly Face3d[], edgeColor: string): { fill: Float32Array; edges: Float32Array } {
  const [er, eg, eb] = colorChannels(edgeColor);
  const fill: number[] = [];
  const edges: number[] = [];
  for (const face of faces) {
    if (face.points.length < 3) continue;
    const [r, g, b] = colorChannels(face.color);
    const rings = [face.points, ...face.holes.filter((h) => h.length >= 3)];
    const verts = rings.flat();
    const n = newell(face.points);
    const flat = flatten(n);
    const holeIndices: number[] = [];
    let start = face.points.length;
    for (const h of rings.slice(1)) {
      holeIndices.push(start);
      start += h.length;
    }
    const index = earcut(verts.flatMap(flat), holeIndices);
    for (let t = 0; t + 2 < index.length; t += 3) {
      const tri = [verts[index[t] ?? 0], verts[index[t + 1] ?? 0], verts[index[t + 2] ?? 0]];
      const [a, bq, c] = tri;
      if (!a || !bq || !c) continue;
      const tn = newell([a, bq, c]);
      for (const p of tn.x * n.x + tn.y * n.y + tn.z * n.z < 0 ? [a, c, bq] : [a, bq, c]) fill.push(p.x, p.y, p.z, r, g, b);
    }
    for (const l of face.lines ?? []) { // a floor's joints, before the outlines so an outline wins where they meet (finishes.12)
      const [lr, lg, lb] = colorChannels(l.color);
      edges.push(l.a.x, l.a.y, l.a.z, lr, lg, lb, l.b.x, l.b.y, l.b.z, lr, lg, lb);
    }
    if (face.outline === false) continue; // a floor pattern's shape: no outline, as on the plan (shown.12)
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length] ?? p;
        edges.push(p.x, p.y, p.z, er, eg, eb, q.x, q.y, q.z, er, eg, eb);
      });
    }
  }
  return { fill: new Float32Array(fill), edges: new Float32Array(edges) };
}
