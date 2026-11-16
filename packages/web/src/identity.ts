/** Display name from the `?name=` URL parameter (spec: collaboration); "Guest" when absent or blank. */
export function displayNameFrom(search: string): string {
  const name = new URLSearchParams(search).get("name")?.trim() ?? "";
  return name === "" ? "Guest" : name;
}

/** Tab-scoped client ID: survives reloads of this tab, differs between tabs. */
export function tabClientId(storage: Storage, newId: () => string): string {
  const key = "fm.clientId";
  const existing = storage.getItem(key);
  if (existing !== null) return existing;
  const id = newId();
  storage.setItem(key, id);
  return id;
}

/** What's wrong with a server address, or null: `new WebSocket` would throw on it during mount and blank the page. */
export function serverUrlProblem(url: string | null): string | null {
  if (url === null || /^wss?:\/\/[^/\s]/.test(url)) return null;
  return `The server address "${url}" must start with ws:// or wss://, for example ws://localhost:8787.`;
}

/**
 * The server to use: `?server=` wins over the build-time `VITE_SERVER_URL`; `?server=off` forces local mode.
 * null means local mode: one unsaved drawing and no project list (spec: collaboration).
 */
export function serverUrlFrom(search: string, buildTime: unknown): string | null {
  const param = new URLSearchParams(search).get("server")?.trim() ?? "";
  if (param !== "") return param === "off" ? null : param;
  return typeof buildTime === "string" && buildTime.trim() !== "" ? buildTime.trim() : null;
}
