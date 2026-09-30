import { describe, expect, it, vi } from "vitest";
import type { Event as EditorEvent } from "@fm/editor";
import type { ClientMessage } from "@fm/protocol";
import { BACKOFF_MS, createWsServer, serverSink, type Clock, type SocketFactory, type SocketHandlers, type WsServer } from "../src/adapters/ws-server";

type FakeSocket = { handlers: SocketHandlers; sent: string[]; open: boolean; closed: boolean };

class SocketHub {
  sockets: FakeSocket[] = [];
  factory: SocketFactory = (_url, handlers) => {
    const s: FakeSocket = { handlers, sent: [], open: false, closed: false };
    this.sockets.push(s);
    return { send: (data) => void s.sent.push(data), close: () => void (s.closed = true), isOpen: () => s.open && !s.closed };
  };
  last(): FakeSocket {
    const s = this.sockets[this.sockets.length - 1];
    if (!s) throw new Error("no socket");
    return s;
  }
  open(): void {
    const s = this.last();
    s.open = true;
    s.handlers.open();
  }
  drop(): void {
    const s = this.last();
    s.open = false;
    s.handlers.close();
  }
  sentTypes(): string[] {
    return this.sockets.flatMap((s) => s.sent.map((raw) => String(JSON.parse(raw).type)));
  }
}

class FakeClock implements Clock {
  t = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 0;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    this.nextId += 1;
    this.timers.push({ id: this.nextId, at: this.t + ms, fn });
    return this.nextId;
  }
  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

function setup() {
  const hub = new SocketHub();
  const clock = new FakeClock();
  const events: EditorEvent[] = [];
  const server = createWsServer({ url: "ws://test", clientId: "tab1", name: "Alice", dispatch: (e) => void events.push(e), socket: hub.factory, clock });
  return { hub, clock, events, server };
}

const presence = (x: number): Extract<ClientMessage, { type: "presence" }> => ({
  type: "presence", projectId: "p1", generation: "g1", cursor: { x, y: 0 }, selection: [],
});

describe("WebSocket adapter", () => {
  it("says hello first, then reports the open connection", () => {
    const { hub, events } = setup();
    hub.open();
    expect(JSON.parse(hub.last().sent[0] ?? "null")).toEqual({ type: "hello", clientId: "tab1", name: "Alice" });
    expect(events).toEqual([{ type: "serverEvent", event: { type: "connection", state: "open" } }]);
  });

  it("maps workspace replies to workspace events and everything else to server events; ignores garbage", () => {
    const { hub, events } = setup();
    hub.open();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hub.last().handlers.message(JSON.stringify({ type: "projects", requestId: "r1", items: [{ id: "p1", name: "Apartment" }] }));
    hub.last().handlers.message(JSON.stringify({ type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 }));
    hub.last().handlers.message("{not json");
    expect(events.slice(1)).toEqual([
      { type: "workspaceEvent", event: { type: "projects", requestId: "r1", items: [{ id: "p1", name: "Apartment" }] } },
      { type: "serverEvent", event: { type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 } },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reconnects with backoff 1, 2, 4 s and starts over after a successful open", () => {
    const { hub, clock, events } = setup();
    hub.open();
    hub.drop();
    expect(events.at(-1)).toEqual({ type: "serverEvent", event: { type: "connection", state: "closed" } });
    clock.advance(BACKOFF_MS[0] - 1);
    expect(hub.sockets).toHaveLength(1);
    clock.advance(1);
    expect(hub.sockets).toHaveLength(2);
    hub.drop(); // the attempt fails
    clock.advance(2000);
    expect(hub.sockets).toHaveLength(3);
    hub.drop();
    clock.advance(3999);
    expect(hub.sockets).toHaveLength(3);
    clock.advance(1);
    expect(hub.sockets).toHaveLength(4);
    hub.open();
    hub.drop();
    clock.advance(1000);
    expect(hub.sockets).toHaveLength(5);
  });

  it("drops messages while the socket is closed instead of queueing them", () => {
    const { hub, server } = setup();
    server.send({ type: "listProjects", requestId: "r1" });
    hub.open();
    expect(hub.sentTypes()).toEqual(["hello"]);
  });

  it("throttles presence to 20 Hz and sends the latest position", () => {
    const { hub, clock, server } = setup();
    hub.open();
    server.sendPresence(presence(1));
    server.sendPresence(presence(2));
    server.sendPresence(presence(3));
    expect(hub.sentTypes()).toEqual(["hello", "presence"]);
    clock.advance(50);
    const sent = hub.last().sent.map((raw) => JSON.parse(raw));
    expect(sent.filter((m) => m.type === "presence").map((m) => m.cursor.x)).toEqual([1, 3]);
  });

  it("close() stops reconnecting", () => {
    const { hub, clock, server } = setup();
    hub.open();
    server.close();
    expect(hub.last().closed).toBe(true);
    hub.drop();
    clock.advance(60_000);
    expect(hub.sockets).toHaveLength(1);
  });

  it("serverSink sends presence through the throttle and everything else at once", () => {
    const calls: string[] = [];
    const fake: WsServer = {
      send: (m) => void calls.push(`send ${m.type}`),
      sendPresence: (m) => void calls.push(`presence ${m.type}`),
      close: () => {},
    };
    const sink = serverSink(fake);
    sink({ type: "workspace", op: { type: "list", requestId: "r1" } });
    sink({ type: "presence", projectId: "p1", generation: "g1", cursor: null, selection: [] });
    expect(calls).toEqual(["send listProjects", "presence presence"]);
  });
});
