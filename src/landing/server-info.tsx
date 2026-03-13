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
  const { upload } = config;
  const allowedTypes = upload.allowedTypes.length > 0
    ? upload.allowedTypes
    : ["All types accepted"];

  return (
    <section>
      <h2 class="text-lg font-semibold text-gray-400 mb-4">Server Info</h2>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-4">
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
      </div>
    </section>
  );
};
