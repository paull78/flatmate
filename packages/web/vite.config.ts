import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // React in its own chunk (tidy C9): no chunk passes Vite's 500 kB warning, which then guards the app's own code.
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: "react", test: /node_modules[\\/].*(react|react-dom|scheduler)[\\/]/ }] } } } },
});
