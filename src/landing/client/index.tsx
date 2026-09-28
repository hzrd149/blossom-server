/**
 * Client-side entry point — runs in the browser.
 *
 * Built ahead of time into public/client.js with `deno task build`.
 * Hydrates the #upload-root div rendered by upload-island.tsx (SSR).
 *
 * Signing goes through identity.ts: a key generated in the browser by default,
 * or a NIP-07 extension / NIP-46 remote signer once the user signs in.
 *
 * Import order matters — ./wnj.ts configures window.nostr.js and must be
 * evaluated before it.
 */
import "./wnj.ts";
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
