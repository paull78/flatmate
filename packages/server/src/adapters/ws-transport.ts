import WebSocket, { WebSocketServer } from "ws";
import type { RawData } from "ws";
import { MAX_MESSAGE_BYTES } from "@fm/protocol";
import type { ServerApp } from "../app/server-app";

export type WsTransport = { port: number; close(): Promise<void> };

/**
 * Text frames in, JSON out; one app session per socket. The app does all parsing and validation.
 * Frames above maxPayload close the socket; below it, the app answers oversized messages with tooLarge (spec §7.2).
 */
export async function startWsTransport(app: ServerApp, opts: { port: number }): Promise<WsTransport> {
  const wss = new WebSocketServer({ port: opts.port, maxPayload: 16 * MAX_MESSAGE_BYTES });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  wss.on("connection", (socket: WebSocket) => {
    const session = app.connect({
      send: (msg) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      },
      close: () => socket.close(1008, "protocol violation"),
    });
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        socket.close(1003, "text frames only");
        return;
      }
      session.receive(toText(data));
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => session.close());
  });

  const address = wss.address();
  const port = typeof address === "object" && address !== null ? address.port : opts.port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
