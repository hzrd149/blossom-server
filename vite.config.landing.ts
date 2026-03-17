import { defineConfig } from "vite";

// Build config for the landing page client (landing/src/client.tsx).
// Output goes to landing/dist/ so the landing worker can read it at startup.
export default defineConfig({
  root: "landing",
  base: "/",
  esbuild: {
    // hono/jsx/dom is the JSX runtime used in client.tsx
    jsx: "automatic",
    jsxImportSource: "hono/jsx/dom",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable filename — no content hash needed for a small, single-chunk bundle
        entryFileNames: "assets/client.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
