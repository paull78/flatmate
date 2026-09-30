import { describe, expect, it } from "vitest";
import type { Camera, Effect, Scene, ViewModel } from "@fm/editor";
import { createEffectRunner, type ServerEffect } from "../src/adapters/effect-runner";
import type { Renderer } from "../src/adapters/renderer";
import type { Timers } from "../src/adapters/timers";
import { cameraFixture, sceneFixture, viewFixture } from "./fixtures";

function harness(withServer: boolean) {
  const log: string[] = [];
  const rendered: { scene: Scene; camera: Camera }[] = [];
  const views: ViewModel[] = [];
  const serverEffects: ServerEffect[] = [];
  const renderer: Renderer = {
    render: (scene, camera) => {
      rendered.push({ scene, camera });
      log.push("render");
    },
    dispose: () => {},
  };
  const timers: Timers = {
    start: (id, ms) => {
      log.push(`start ${id} ${ms}`);
    },
    cancel: (id) => {
      log.push(`cancel ${id}`);
    },
    dispose: () => {},
  };
  const runner = createEffectRunner({
    timers,
    server: withServer
      ? (effect) => {
          serverEffects.push(effect);
          log.push(`server ${effect.type}`);
        }
      : null,
    onView: (view) => {
      views.push(view);
      log.push("view");
    },
  });
  runner.setRenderer(renderer);
  return { run: runner.run, runner, log, rendered, views, serverEffects };
}

const scene = sceneFixture();
const view = viewFixture({ activeTool: "wall" });
const serverEffects: Effect[] = [
  { type: "workspace", op: { type: "list", requestId: "r1" } },
  { type: "submit", projectId: "p1", generation: "g1", changeset: { id: "c1", patch: { puts: [], deletes: [] }, expect: [] } },
  { type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [] },
];

describe("effect runner", () => {
  it("renders the scene with the effect's camera and publishes the view", () => {
    const h = harness(false);
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    expect(h.rendered).toEqual([{ scene, camera: cameraFixture }]);
    expect(h.views).toEqual([view]);
    expect(h.log).toEqual(["render", "view"]);
  });

  it("routes timer effects to the timers adapter", () => {
    const h = harness(false);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "cancelTimer", timerId: "toast" },
    ]);
    expect(h.log).toEqual(["start toast 3000", "cancel toast"]);
  });

  it("hands workspace, submit and presence effects to the server sink in order", () => {
    const h = harness(true);
    h.run(serverEffects);
    expect(h.serverEffects).toEqual(serverEffects);
    expect(h.log).toEqual(["server workspace", "server submit", "server presence"]);
  });

  it("ignores server effects when there is no server (local mode)", () => {
    const h = harness(false);
    h.run(serverEffects);
    expect(h.log).toEqual([]);
  });

  it("ignores saveSnapshot until local files exist (X1)", () => {
    const h = harness(true);
    h.run([{ type: "saveSnapshot", projectId: "p1", writeId: "w1", content: "{}" }]);
    expect(h.log).toEqual([]);
  });

  it("keeps effect order across kinds", () => {
    const h = harness(true);
    h.run([
      { type: "startTimer", timerId: "toast", ms: 3000 },
      { type: "workspace", op: { type: "list", requestId: "r1" } },
      { type: "render", scene, view, camera: cameraFixture },
    ]);
    expect(h.log).toEqual(["start toast 3000", "server workspace", "render", "view"]);
  });

  it("keeps the last render and hands it to a new renderer at once", () => {
    const h = harness(false);
    const other = sceneFixture();
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    h.run([{ type: "render", scene: other, view, camera: { ...cameraFixture, zoom: 50 } }]);
    const next: { scene: Scene; camera: Camera }[] = [];
    h.runner.setRenderer({ render: (s, c) => next.push({ scene: s, camera: c }), dispose: () => {} });
    expect(next).toEqual([{ scene: other, camera: { ...cameraFixture, zoom: 50 } }]);
    expect(next[0]?.scene).toBe(other);
  });

  it("sends later frames only to the new renderer", () => {
    const h = harness(false);
    const next: Scene[] = [];
    h.runner.setRenderer({ render: (s) => next.push(s), dispose: () => {} });
    h.run([{ type: "render", scene, view, camera: cameraFixture }]);
    expect(next).toEqual([scene]);
    expect(h.rendered).toEqual([]);
  });

  it("draws nothing before a renderer is set, then the last scene when one is", () => {
    const runner = createEffectRunner({ timers: { start: () => {}, cancel: () => {}, dispose: () => {} }, server: null, onView: () => {} });
    runner.run([{ type: "render", scene, view, camera: cameraFixture }]);
    const drawn: Scene[] = [];
    runner.setRenderer({ render: (s) => drawn.push(s), dispose: () => {} });
    expect(drawn).toEqual([scene]);
  });

  it("gives a new renderer nothing before the first render", () => {
    const h = harness(false);
    const drawn: Scene[] = [];
    h.runner.setRenderer({ render: (s) => drawn.push(s), dispose: () => {} });
    expect(drawn).toEqual([]);
  });
});
