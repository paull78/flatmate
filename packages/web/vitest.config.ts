import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { sharedTest } from "../../vitest.shared.ts";

export default defineConfig({
  plugins: [react()],
  test: {
    ...sharedTest,
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
