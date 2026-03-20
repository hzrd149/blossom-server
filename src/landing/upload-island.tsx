import type { FC } from "@hono/hono/jsx";

/**
 * SSR island mount point for the client-side upload form.
 * Renders a placeholder div that @hono/hono/jsx/dom hydrates at runtime.
 * Server config is passed as data-* attributes so the client bundle
 * can read it without a separate API call.
 */
export const UploadIsland: FC<{
  requireAuth: boolean;
  uploadEnabled: boolean;
  mediaEnabled: boolean;
  mediaRequireAuth: boolean;
  mirrorEnabled: boolean;
  mirrorRequireAuth: boolean;
}> = (
  {
    requireAuth,
    uploadEnabled,
    mediaEnabled,
    mediaRequireAuth,
    mirrorEnabled,
    mirrorRequireAuth,
  },
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
            data-mirror-enabled={String(mirrorEnabled)}
            data-mirror-require-auth={String(mirrorRequireAuth)}
            class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden"
          >
            {/* Static fallback shown before JS loads */}
            <div class="p-6 flex items-center justify-center min-h-40">
              <p class="text-gray-500 text-sm">Loading upload form...</p>
            </div>
          </div>
          <script src="/client.js" defer />
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
