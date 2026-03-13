/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { BlobStats } from "../db/blobs.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(2)} ${units[i]}`;
}

const StatCard: FC<{ label: string; value: string | number }> = (
  { label, value },
) => (
  <div class="bg-gray-900 rounded-xl p-6 flex flex-col gap-1 border border-gray-800">
    <span class="text-3xl font-bold text-white">{value}</span>
    <span class="text-sm text-gray-400 uppercase tracking-wide">{label}</span>
  </div>
);

export const StatsBar: FC<{ stats: BlobStats }> = ({ stats }) => (
  <section>
    <h2 class="text-lg font-semibold text-gray-400 mb-4">Server Stats</h2>
    <div class="grid grid-cols-3 gap-4">
      <StatCard label="Total Blobs" value={stats.blobCount.toLocaleString()} />
      <StatCard label="Storage Used" value={formatBytes(stats.totalSize)} />
      <StatCard label="Uploads (24h)" value={stats.dailyUploads.toLocaleString()} />
    </div>
  </section>
);
