import { domainValidator } from "./adapters/domain-validator";
import { createJsonFileRepository } from "./adapters/json-file-repository";
import { startWsTransport } from "./adapters/ws-transport";
import { createServerApp } from "./app/server-app";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? "./data";

const app = createServerApp({
  repository: createJsonFileRepository(dataDir),
  validator: domainValidator,
  onFatal(error) {
    // Crash-only (spec §7.2): no ack, no rejection. The restart loop reloads the project files.
    console.error("[fm-server] fatal error; exiting so the restart loop reloads from disk", error);
    process.exit(1);
  },
});

const transport = await startWsTransport(app, { port });
console.log(`[fm-server] listening on ws://localhost:${transport.port} (data: ${dataDir})`);
