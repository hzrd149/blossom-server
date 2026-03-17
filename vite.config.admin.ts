import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build config for the React Admin SPA (admin/src/).
// Output goes to admin/dist/ so main.ts can find it at ./admin/dist.
export default defineConfig({
  root: "admin",
  base: "/admin",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
