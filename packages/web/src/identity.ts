import { MAX_NAME_CHARS } from "@fm/protocol";

/**
 * Display name from the `?name=` URL parameter (spec: collaboration); "Guest" when absent or blank. Cut to the
 * protocol's limit, which the server's hello check enforces: a longer name would be refused and the client would retry
 * for ever. The cut never leaves half a surrogate pair or a trailing space.
 */
export function displayNameFrom(search: string): string {
  const name = new URLSearchParams(search).get("name")?.trim() ?? "";
  if (name === "") return "Guest";
  if (name.length <= MAX_NAME_CHARS) return name;
  const last = name.charCodeAt(MAX_NAME_CHARS - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? MAX_NAME_CHARS - 1 : MAX_NAME_CHARS; // a high surrogate whose pair fell off
  return name.slice(0, cut).trimEnd();
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
