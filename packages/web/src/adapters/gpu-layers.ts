import type { LayerName, Primitive, Scene } from "@fm/editor";
import { createEncoder, type EncodedLayer } from "@fm/render";

// The one layer cache over the render format (render.13, .14, .25; webgpu.11), shared by the GPU renderers: a layer's
// buffer is uploaded once, when the encoder sends one, and kept while the encoder answers "unchanged". The cache owns
// the rev contract and the texts; a renderer passes only how to upload a layer's buffer and how to free that upload.

export type TextPrimitive = Extract<Primitive, { kind: "text" }>;
/** A cached layer: the rev it was uploaded at, its texts for the Canvas2D overlay, and the renderer's upload. */
export type CachedLayer<G> = { rev: number; texts: TextPrimitive[]; gpu: G };
/** What a renderer does with a layer: upload the encoder's whole buffer, free an upload it replaces. */
export type LayerOps<G> = { upload: (data: ArrayBuffer) => G; free: (gpu: G) => void };

/**
 * Brings the cache in line with one `encode` result: a layer with a buffer is uploaded (its old upload freed), a
 * layer without one keeps its upload, which must carry the same rev. `encoded` pairs with `scene.layers` by index
 * (encode keeps the scene's order and length). Returns the frame's uploads in layer order and its texts in scene order.
 */
export function syncLayers<G>(cache: Map<LayerName, CachedLayer<G>>, encoded: readonly EncodedLayer[], scene: Scene, ops: LayerOps<G>): { layers: G[]; texts: TextPrimitive[] } {
  const layers: G[] = [];
  const texts: TextPrimitive[] = [];
  encoded.forEach(({ name, rev, buffer }, i) => {
    let layer = cache.get(name);
    if (buffer !== null) {
      // Upload first: if it throws, the cache still holds the old upload, unfreed (an upload freed but kept would be
      // freed again later, and every frame would refuse its stale rev).
      const gpu = ops.upload(buffer);
      if (layer) ops.free(layer.gpu);
      const primitives = scene.layers[i]?.primitives ?? [];
      layer = { rev, texts: primitives.filter((p): p is TextPrimitive => p.kind === "text"), gpu };
      cache.set(name, layer);
    }
    if (layer?.rev !== rev) throw new Error(`layer ${name}: the encoder says rev ${rev} is unchanged, the upload has ${layer?.rev ?? "none"}`);
    layers.push(layer.gpu);
    texts.push(...layer.texts);
  });
  return { layers, texts };
}

/** A GPU renderer's whole layer cache: its encoder, its uploads, the one way to sync a scene and to free them all. */
export type LayerCache<G> = { sync(scene: Scene): { layers: G[]; texts: TextPrimitive[] }; dispose(): void };

/**
 * One encoder and its cache together (webgpu gate M1). A sync that throws (an upload out of memory, a lost context)
 * frees every upload and starts a new encoder before rethrowing, so the next frame sends and uploads every layer again
 * instead of refusing the layers the old encoder had already counted as sent.
 */
export function createLayerCache<G>(ops: LayerOps<G>): LayerCache<G> {
  const cache = new Map<LayerName, CachedLayer<G>>();
  let encoder = createEncoder();
  const freeAll = (): void => {
    for (const layer of cache.values()) ops.free(layer.gpu);
    cache.clear();
  };
  return {
    sync(scene) {
      try {
        return syncLayers(cache, encoder.encode(scene).layers, scene, ops);
      } catch (error) {
        freeAll();
        encoder = createEncoder();
        throw error;
      }
    },
    dispose: freeAll,
  };
}
