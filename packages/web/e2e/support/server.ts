// The collaboration server the e2e run starts (playwright.config.ts): 8788, or E2E_SERVER_PORT when another run holds
// that port (cleanup step 19).
export const SERVER_PORT = process.env.E2E_SERVER_PORT ?? "8788";
export const SERVER = `ws://localhost:${SERVER_PORT}`;
