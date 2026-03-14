import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  esbuild: {
    // Use hono/jsx/dom as the JSX runtime (matches client.tsx's @jsxImportSource pragma)
    jsx: "automatic",
    jsxImportSource: "hono/jsx/dom",
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Stable output filename — landing client is small and doesn't need content hashing
        entryFileNames: "assets/client.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
