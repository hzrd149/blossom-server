/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";

/**
 * SSR island mount point for the client-side upload form.
 * Renders a placeholder div that hono/jsx/dom hydrates at runtime.
 * requireAuth is passed as a data attribute so the client bundle
 * can read it without a separate API call.
 */
export const UploadIsland: FC<{
  requireAuth: boolean;
  uploadEnabled: boolean;
  mediaEnabled: boolean;
  mediaRequireAuth: boolean;
}> = (
  { requireAuth, uploadEnabled, mediaEnabled, mediaRequireAuth },
) => (
  <section>
    <h2 class="text-lg font-semibold text-gray-400 mb-4">Upload</h2>
    {uploadEnabled
      ? (
        <div>
          <div
            id="upload-root"
            data-require-auth={String(requireAuth)}
            data-media-enabled={String(mediaEnabled)}
            data-media-require-auth={String(mediaRequireAuth)}
            class="bg-gray-900 rounded-xl border border-gray-800 p-8 min-h-40 flex items-center justify-center"
          >
            {/* Static fallback shown before JS loads */}
            <p class="text-gray-500 text-sm">Loading upload form...</p>
          </div>
          <script src="/assets/client.js" defer />
        </div>
      )
      : (
        <div class="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <p class="text-gray-500 text-sm">
            Uploads are disabled on this server.
          </p>
        </div>
      )}
  </section>
);
