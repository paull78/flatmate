import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { worldToScreen } from "../src/camera";
import { visibleDoc } from "../src/document/open-document";
import type { Effect } from "../src/ports/effects";
import type { Event, UiAction } from "../src/ports/events";
import type { Host } from "../src/ports/host";
import type { EditorState } from "../src/state";
import { NO_MODS, type Mods } from "../src/types";
import { update } from "../src/update";
import { buildScene } from "../src/view/scene";
import type { Scene } from "../src/view/scene-types";
import { buildViewModel, type ViewModel } from "../src/view/view-model";
import { localState } from "./builders";

/** Deterministic host: ids "id1", "id2", … (after an optional prefix); a manual clock. Text is measured by the core's tables (render.15). */
export class FakeHost implements Host {
  time = 0;
  private next = 0;
  private readonly prefix: string;

  /** `prefix` keeps the IDs of several editors in one test apart ("alice-id1", "bob-id1"). */
  constructor(prefix = "") {
    this.prefix = prefix;
  }

  now(): number {
    return this.time;
  }

  today: () => string = () => "2026-10-13";

  newId(): string {
    this.next += 1;
    return `${this.prefix}id${this.next}`;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

/**
 * Drives the editor like a shell: gestures in world coordinates are converted to screen
 * coordinates with the current camera, because the editor owns the camera (spec: editor).
 */
export class FakeShell {
  readonly host: FakeHost;
  state: EditorState;
  effects: Effect[] = [];

  constructor(state?: EditorState, host: FakeHost = new FakeHost()) {
    this.host = host;
    this.state = state ?? localState(host);
  }

  /** Unsaved LocalDocument, viewport 1200 × 800, dpr 1. */
  static local(): FakeShell {
    return new FakeShell();
  }

  /** Like local(), but the unsaved document starts as `doc` (a fixture, not a gesture). */
  static withDocument(doc: Document): FakeShell {
    const host = new FakeHost();
    return new FakeShell(localState(host, doc), host);
  }

  send(e: Event): Effect[] {
    const r = update(this.state, e, this.host);
    this.state = r.state;
    this.effects.push(...r.effects);
    return r.effects;
  }

  moveTo(world: Point, mods?: Partial<Mods>): void {
    this.send({ type: "pointerMove", screen: this.screen(world), mods: this.mods(mods), button: 0 });
  }

  down(world: Point, mods?: Partial<Mods>, button: 0 | 1 | 2 = 0): void {
    this.send({ type: "pointerDown", screen: this.screen(world), mods: this.mods(mods), button });
  }

  up(world: Point, mods?: Partial<Mods>, button: 0 | 1 | 2 = 0): void {
    this.send({ type: "pointerUp", screen: this.screen(world), mods: this.mods(mods), button });
  }

  click(world: Point, mods?: Partial<Mods>): void {
    this.moveTo(world, mods);
    this.down(world, mods);
    this.up(world, mods);
  }

  drag(from: Point, to: Point, mods?: Partial<Mods>): void {
    this.moveTo(from, mods);
    this.down(from, mods);
    this.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mods);
    this.moveTo(to, mods);
    this.up(to, mods);
  }

  /** A wheel at the cursor, or at the viewport centre before any pointer event. */
  wheel(deltaX: number, deltaY: number, mods?: Partial<Mods>): Effect[] {
    const v = this.state.camera.viewport;
    const screen = this.state.pointer?.screen ?? { x: v.width / 2, y: v.height / 2 };
    return this.send({ type: "wheel", screen, deltaX, deltaY, mods: this.mods(mods) });
  }

  key(key: string, mods?: Partial<Mods>): void {
    this.send({ type: "key", key, mods: this.mods(mods) });
  }

  type(text: string, mods?: Partial<Mods>): void {
    for (const ch of text) this.key(ch, mods);
  }

  ui(action: UiAction): void {
    this.send({ type: "ui", action });
  }

  fireTimer(timerId: string): void {
    this.send({ type: "timerFired", timerId });
  }

  /** Sends a domain command event: the tools' commit path (execute → commit → history → notices), as the MCP shell does. */
  command(cmd: Command): Effect[] {
    return this.send({ type: "command", command: cmd });
  }

  doc(): Document {
    if (!this.state.document) throw new Error("No document open");
    return visibleDoc(this.state.document);
  }

  /**
   * Built from the current state, so equal to the view of the last render effect only while `host.now()` has not
   * advanced since: toast visibility depends on the clock.
   */
  view(): ViewModel {
    return buildViewModel(this.state, this.host);
  }

  scene(): Scene {
    return buildScene(this.state);
  }

  /** The scene at a zoom where doors and windows draw simple, for a test about something else (openingsDetailed). */
  simpleScene(): Scene {
    return buildScene({ ...this.state, camera: { ...this.state.camera, zoom: 60 } });
  }

  effectsOf<T extends Effect["type"]>(type: T): Extract<Effect, { type: T }>[] {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type);
  }

  clearEffects(): void {
    this.effects = [];
  }

  private screen(world: Point): Point {
    return worldToScreen(this.state.camera, world);
  }

  private mods(m?: Partial<Mods>): Mods {
    return { ...NO_MODS, ...m };
  }
}
