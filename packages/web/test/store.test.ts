import { describe, expect, it } from "vitest";
import { initialState, type EditorState, type Host } from "@fm/editor";
import { createEditorStore } from "../src/store";

function testHost(): Host {
  let n = 0;
  return {
    textMetrics: (text, font) => ({ width: text.length * font.size * 0.6, ascent: font.size * 0.8, descent: font.size * 0.2 }),
    now: () => 0,
    newId: () => `id${++n}`,
  };
}

function localState(host: Host): EditorState {
  return initialState({ mode: "local", me: { clientId: "c1", name: "Alice" }, viewport: { width: 800, height: 600 }, dpr: 1 }, host);
}

function storeWithViewPublishing() {
  const host = testHost();
  const store = createEditorStore({ initial: localState(host), host });
  store.setRunner((effects) => {
    for (const e of effects) if (e.type === "render") store.publishView(e.view);
  });
  return store;
}

describe("editor store", () => {
  it("exposes a view before the first render", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    expect(store.getView().activeTool).toBe("select");
    expect(store.getView()).toBe(store.getView());
  });

  it("runs update and hands every effect to the runner", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    const types: string[] = [];
    store.setRunner((effects) => {
      for (const e of effects) types.push(e.type);
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(store.getState().tool.name).toBe("wall");
    expect(types.at(-1)).toBe("render");
  });

  it("publishes views to subscribers until they unsubscribe", () => {
    const store = storeWithViewPublishing();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(store.getView().activeTool).toBe("wall");
    expect(notified).toBe(1);
    unsubscribe();
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "zone" } });
    expect(store.getView().activeTool).toBe("zone");
    expect(notified).toBe(1);
  });

  it("queues events dispatched by effects instead of recursing", () => {
    const host = testHost();
    const store = createEditorStore({ initial: localState(host), host });
    const seen: string[] = [];
    let depth = 0;
    let maxDepth = 0;
    let first = true;
    store.setRunner(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      seen.push(`batch ${store.getState().tool.name}`);
      if (first) {
        first = false;
        store.dispatch({ type: "ui", action: { type: "pickTool", tool: "zone" } });
        seen.push("dispatched");
      }
      depth -= 1;
    });
    store.dispatch({ type: "ui", action: { type: "pickTool", tool: "wall" } });
    expect(seen).toEqual(["batch wall", "dispatched", "batch zone"]);
    expect(maxDepth).toBe(1);
  });
});
