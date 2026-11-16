// Manual check for gate 6: pnpm --filter @fm/server exec tsx scripts/smoke.ts [ws://localhost:8787]
import WebSocket from "ws";

const url = process.argv[2] ?? "ws://localhost:8787";
const socket = new WebSocket(url);
socket.on("open", () => {
  socket.send(JSON.stringify({ type: "hello", clientId: "smoke", name: "Smoke" }));
  socket.send(JSON.stringify({ type: "createProject", requestId: "r1", name: `Smoke ${new Date().toISOString()}` }));
  socket.send(JSON.stringify({ type: "listProjects", requestId: "r2" }));
});
socket.on("message", (data) => console.log(data.toString()));
socket.on("close", (code) => {
  console.log(`closed ${code}`);
  process.exit(0);
});
socket.on("error", (error) => console.error(error.message));
setTimeout(() => socket.close(), 2000);
