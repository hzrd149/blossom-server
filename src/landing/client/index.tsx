/**
 * Client-side entry point — runs in the browser.
 *
 * Built ahead of time into public/client.js with `deno task build`.
 * Hydrates the #upload-root div rendered by upload-island.tsx (SSR).
 *
 * Nostr signing uses NIP-07 window.nostr, with window.nostr.js providing a
 * NIP-46 fallback when no browser extension is installed.
 */
import "window.nostr.js";

import { render } from "@hono/hono/jsx/dom";
import { App } from "./App.tsx";

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
