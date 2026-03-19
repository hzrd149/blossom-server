/** @jsxImportSource hono/jsx/dom */
/** @jsxRuntime automatic */
/**
 * Client-side entry point — runs in the browser.
 *
 * Bundled with `deno task build-landing` (Vite) into landing/dist/assets/client.js.
 * Hydrates the #upload-root div rendered by upload-island.tsx (SSR).
 *
 * Nostr signing uses NIP-07 window.nostr (browser extension).
 * SHA-256 is computed via WebCrypto (available in all modern browsers).
 */
import { render } from "hono/jsx/dom";
import { App } from "./client/App.tsx";

const root = document.getElementById("upload-root");
if (root) {
  render(
    <App
      requireAuth={root.dataset.requireAuth === "true"}
      mediaEnabled={root.dataset.mediaEnabled === "true"}
      mediaRequireAuth={root.dataset.mediaRequireAuth === "true"}
      mirrorEnabled={root.dataset.mirrorEnabled === "true"}
      mirrorRequireAuth={root.dataset.mirrorRequireAuth === "true"}
    />,
    root,
  );
}
