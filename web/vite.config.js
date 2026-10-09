import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { repoData } from "./build/repo-data.js";
import { stripVersionQuery } from "./build/strip-version-query.js";

// React-skalet. Byggjet går til web/dist og rører ikkje vanilla-appen i / eller /dev/.
// packages/core og assets/ ligg utanfor web/, men innanfor npm-workspacen i rota, som
// Vite sjølv opnar for (server.fs.allow er ikkje sett med vilje).
export default defineConfig({
  base: "./",
  plugins: [stripVersionQuery(), repoData(), react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
