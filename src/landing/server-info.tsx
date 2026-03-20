/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { Config } from "../config/schema.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(2)} ${units[i]}`;
}

export const ServerInfo: FC<{ config: Config }> = ({ config }) => {
  const { upload, storage, media } = config;
  const allowedTypes = storage.rules.length > 0
    ? [...new Set(storage.rules.map((r) => r.type))]
    : ["All types accepted"];

  return (
    <section id="server-info">
      <h2 class="text-lg font-semibold text-gray-400 mb-4">Server Info</h2>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-4">
        {/* Upload section */}
        <div class="flex items-center justify-between">
          <span class="text-gray-400 text-sm">Max upload size</span>
          <span class="font-mono text-white">
            {formatBytes(upload.maxSize)}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-400 text-sm">Authentication</span>
          {upload.requireAuth
            ? (
              <span class="bg-yellow-900 text-yellow-300 text-xs font-semibold px-2 py-1 rounded">
                Required
              </span>
            )
            : (
              <span class="bg-green-900 text-green-300 text-xs font-semibold px-2 py-1 rounded">
                Open
              </span>
            )}
        </div>
        <div class="flex items-start justify-between gap-4">
          <span class="text-gray-400 text-sm shrink-0">Accepted types</span>
          <div class="flex flex-wrap gap-1 justify-end">
            {allowedTypes.map((t) => (
              <span class="bg-gray-800 text-gray-300 text-xs font-mono px-2 py-0.5 rounded">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div class="border-t border-gray-800" />

        {/* Media optimization section */}
        <div class="flex items-center justify-between">
          <span class="text-gray-400 text-sm">Media optimization</span>
          {media.enabled
            ? (
              <span class="bg-blue-900 text-blue-300 text-xs font-semibold px-2 py-1 rounded">
                Enabled
              </span>
            )
            : (
              <span class="bg-gray-800 text-gray-500 text-xs font-semibold px-2 py-1 rounded">
                Disabled
              </span>
            )}
        </div>
        {media.enabled && (
          <>
            <div class="flex items-center justify-between">
              <span class="text-gray-400 text-sm">Media auth</span>
              {media.requireAuth
                ? (
                  <span class="bg-yellow-900 text-yellow-300 text-xs font-semibold px-2 py-1 rounded">
                    Required
                  </span>
                )
                : (
                  <span class="bg-green-900 text-green-300 text-xs font-semibold px-2 py-1 rounded">
                    Open
                  </span>
                )}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-400 text-sm">Max media size</span>
              <span class="font-mono text-white">
                {formatBytes(media.maxSize)}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-400 text-sm">Image output</span>
              <span class="font-mono text-gray-300 text-xs">
                {media.image.outputFormat} ·{" "}
                {media.image.maxWidth}×{media.image.maxHeight}{" "}
                · q{media.image.quality}
                {media.image.progressive ? " · progressive" : ""}
                {` · ${media.image.fps}fps`}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-400 text-sm">Video output</span>
              <span class="font-mono text-gray-300 text-xs">
                {media.video.format} · {media.video.videoCodec} ·{" "}
                {media.video.audioCodec} · {media.video.maxHeight}p ·{" "}
                {media.video.maxFps}fps · q{media.video.quality}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
