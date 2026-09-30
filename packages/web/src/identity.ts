/** Display name from the `?name=` URL parameter (spec §7.2.1); "Guest" when absent or blank. */
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

/**
 * The server to use: `?server=` wins over the build-time `VITE_SERVER_URL`; `?server=off` forces local mode.
 * null means local mode: one unsaved drawing and no project list (spec §7.0).
 */
export function serverUrlFrom(search: string, buildTime: unknown): string | null {
  const param = new URLSearchParams(search).get("server")?.trim() ?? "";
  if (param !== "") return param === "off" ? null : param;
  return typeof buildTime === "string" && buildTime.trim() !== "" ? buildTime.trim() : null;
}
