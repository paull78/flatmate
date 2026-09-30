import WebSocket, { type RawData } from "ws";
import { parseServerMessage } from "@fm/protocol";
import type { Connect } from "./session";

// The WebSocket adapter (spec §5.2, §7.2): moves text frames, parses what arrives, reconnects with backoff. Like the
// web adapter, it knows nothing about projects: the editor reopens the project when told the connection is open.

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export function wsConnect(url: string): Connect {
  return (handlers) => {
    let socket: WebSocket | null = null;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function open(): void {
      const ws = new WebSocket(url);
      socket = ws;
      ws.on("open", () => {
        failures = 0;
        handlers.open();
      });
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        const parsed = parseServerMessage(toText(data));
        if (!parsed.ok) {
          console.error(`[fm-mcp] ignored a server message: ${parsed.error}`);
          return;
        }
        handlers.message(parsed.value);
      });
      ws.on("error", () => undefined); // "close" follows
      ws.on("close", () => {
        socket = null;
        if (stopped) return;
        handlers.close();
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 8000;
        failures += 1;
        retry = setTimeout(() => {
          retry = null;
          open();
        }, delay);
      });
    }

    open();
    return {
      send(msg) {
        if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      },
      close() {
        stopped = true;
        if (retry !== null) clearTimeout(retry);
        socket?.close();
        socket = null;
      },
    };
  };
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
