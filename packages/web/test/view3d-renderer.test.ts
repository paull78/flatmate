import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer3d, NO_WEBGL2 } from "../src/view3d-renderer";

// The 3D panel without WebGL2 (real3d.10, AC-13): one line in place of the picture, frames ignored.

type FakeNode = { className: string; dataset: Record<string, string>; textContent: string };

function fakeHost() {
  const children: FakeNode[][] = [];
  return { children, host: { replaceChildren: (...nodes: FakeNode[]) => children.push(nodes) } };
}

afterEach(() => vi.unstubAllGlobals());

describe("createRenderer3d", () => {
  it("shows the note when WebGL2 can't start, and ignores frames", () => {
    vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? { getContext: () => null } : { className: "", dataset: {}, textContent: "" }) });
    const { children, host } = fakeHost();
    const r = createRenderer3d(host as unknown as HTMLElement);
    const note = children.at(-1)?.[0];
    expect(note?.textContent).toBe(NO_WEBGL2);
    expect(note?.dataset.testid).toBe("view3d-unavailable");
    r.render(null);
    expect(children).toHaveLength(1);
  });
});
