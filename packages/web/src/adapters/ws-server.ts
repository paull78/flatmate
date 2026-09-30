import { clientMessageFor, serverMessageEvent, type Event as EditorEvent } from "@fm/editor";
import { parseServerMessage, type ClientMessage } from "@fm/protocol";
import type { ServerEffectSink } from "./effect-runner";

// The WebSocket adapter (spec §5.2, §7.2): moves bytes, owns reconnect backoff (§8) and presence throttling (§7.6).
// Behaviour stays in the editor: it reopens the project when told the connection is open.

export type SocketHandlers = { open(): void; message(data: string): void; close(): void };
export type SocketLike = { send(data: string): void; close(): void; isOpen(): boolean };
export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketLike;
export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const; // 1, 2, 4 … max 30 s
export const PRESENCE_INTERVAL_MS = 50; // 20 Hz

type PresenceMessage = Extract<ClientMessage, { type: "presence" }>;

export type WsServer = { send(msg: ClientMessage): void; sendPresence(msg: PresenceMessage): void; close(): void };

export type WsServerOptions = {
  url: string;
  clientId: string;
  name: string;
  dispatch(e: EditorEvent): void;
  socket?: SocketFactory; // tests inject a fake
  clock?: Clock;
};

export function createWsServer(opts: WsServerOptions): WsServer {
  const openSocket = opts.socket ?? browserSocket;
  const clock = opts.clock ?? browserClock;
  let socket: SocketLike | null = null;
  let failures = 0;
  let retry: number | null = null;
  let stopped = false;
  let lastPresence = Number.NEGATIVE_INFINITY;
  let pendingPresence: PresenceMessage | null = null;
  let presenceTimer: number | null = null;

  /** Dropped while closed: the editor resyncs after reconnecting and never relies on delivery. */
  function send(msg: ClientMessage): void {
    if (socket !== null && socket.isOpen()) socket.send(JSON.stringify(msg));
  }

  function connect(): void {
    socket = openSocket(opts.url, {
      open() {
        failures = 0;
        send({ type: "hello", clientId: opts.clientId, name: opts.name });
        opts.dispatch({ type: "serverEvent", event: { type: "connection", state: "open" } });
      },
      message(data) {
        const parsed = parseServerMessage(data);
        if (!parsed.ok) {
          console.warn(`[rm] ignored a server message: ${parsed.error}`);
          return;
        }
        opts.dispatch(serverMessageEvent(parsed.value));
      },
      close() {
        socket = null;
        if (stopped) return;
        opts.dispatch({ type: "serverEvent", event: { type: "connection", state: "closed" } });
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000;
        failures += 1;
        retry = clock.setTimeout(() => {
          retry = null;
          connect();
        }, delay);
      },
    });
  }

  function flushPresence(): void {
    presenceTimer = null;
    const msg = pendingPresence;
    pendingPresence = null;
    if (msg === null) return;
    lastPresence = clock.now();
    send(msg);
  }

  function sendPresence(msg: PresenceMessage): void {
    pendingPresence = msg; // only the latest position matters
    if (presenceTimer !== null) return;
    const wait = lastPresence + PRESENCE_INTERVAL_MS - clock.now();
    if (wait <= 0) flushPresence();
    else presenceTimer = clock.setTimeout(flushPresence, wait);
  }

  function close(): void {
    stopped = true;
    if (retry !== null) clock.clearTimeout(retry);
    if (presenceTimer !== null) clock.clearTimeout(presenceTimer);
    socket?.close();
    socket = null;
  }

  connect();
  return { send, sendPresence, close };
}

/** The effect runner's server sink: editor effects become client messages (the mapping lives in @fm/editor). */
export function serverSink(server: WsServer): ServerEffectSink {
  return (effect) => {
    const msg = clientMessageFor(effect);
    if (msg.type === "presence") server.sendPresence(msg);
    else server.send(msg);
  };
}

const browserSocket: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.open();
  ws.onmessage = (e) => {
    if (typeof e.data === "string") handlers.message(e.data);
  };
  ws.onclose = () => handlers.close();
  return { send: (data) => ws.send(data), close: () => ws.close(), isOpen: () => ws.readyState === WebSocket.OPEN };
};

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};
