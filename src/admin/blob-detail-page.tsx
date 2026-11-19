import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { mimeToExt } from "../utils/mime.ts";
import { blobKind, blobKindLabel, pageFileHint } from "../utils/blob-kind.ts";
import {
  AdminLayout,
  Badge,
  DangerButton,
  formatBytes,
  formatDate,
  PageHeader,
  truncateHash,
} from "./layout.tsx";

interface BlobDetailPageProps {
  db: IDbHandle;
  storage: IBlobStorage;
  sha256: string;
}

export const BlobDetailPage: FC<BlobDetailPageProps> = async (
  { db, storage, sha256 },
) => {
  const blob = await db.getBlob(sha256);

  if (!blob) {
    return (
      <AdminLayout title="Blob not found" section="blobs">
        <PageHeader title="Blob not found" />
        <p class="text-gray-400 text-sm">
          No blob with hash{" "}
          <code class="font-mono text-purple-400">{sha256}</code> exists.
        </p>
        <a
          href="/admin/blobs"
          class="mt-4 inline-block text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Blobs
        </a>
      </AdminLayout>
    );
  }

  const blobsWithOwners = await db.listAllBlobs({
    filter: { q: sha256 },
    limit: 1,
  });
  const owners = blobsWithOwners[0]?.sha256 === sha256
    ? blobsWithOwners[0].owners
    : [];

  const deleteUrl = `/admin/api/blobs/${blob.sha256}`;
  const previewUrl = `/admin/preview/${blob.sha256}`;
  const kindOf = blobKind(blob.type);
  const isImage = kindOf === "image";
  const isVideo = kindOf === "video";
  const isAudio = kindOf === "audio";
  let hint: string | null = null;
  if (kindOf === "page" || kindOf === "text") {
    const stream = await storage.read(blob.sha256, mimeToExt(blob.type));
    if (stream) {
      const reader = stream.getReader();
      try {
        const { value } = await reader.read();
        if (value) {
          const head = new TextDecoder("utf-8", { fatal: false }).decode(
            value.slice(0, 800),
          );
          hint = pageFileHint(blob.type, head);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
  }

  return (
    <AdminLayout title={`Blob ${truncateHash(sha256)}`} section="blobs">
      <div class="mb-4">
        <a
          href="/admin/blobs"
          class="text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Blobs
        </a>
      </div>

      <PageHeader title={`Blob ${truncateHash(sha256)}`} />

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Metadata card */}
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
          <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Details
          </h2>

          <dl class="space-y-3">
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">SHA-256</dt>
              <dd class="font-mono text-xs text-gray-200 break-all">
                {blob.sha256}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">MIME Type</dt>
              <dd>
                {blob.type
                  ? <Badge color="purple">{blob.type}</Badge>
                  : <span class="text-gray-600 text-sm">—</span>}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">Size</dt>
              <dd class="text-sm text-gray-200">{formatBytes(blob.size)}</dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">Uploaded</dt>
              <dd class="text-sm text-gray-200">{formatDate(blob.uploaded)}</dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">
                Owners ({owners.length})
              </dt>
              <dd class="space-y-1 mt-1">
                {owners.length === 0
                  ? <span class="text-gray-600 text-sm">No owners</span>
                  : (
                    owners.map((pk) => (
                      <div key={pk}>
                        <a
                          href={`/admin/users?q=${pk}`}
                          class="font-mono text-xs text-purple-400 hover:text-purple-300 hover:underline break-all"
                        >
                          {pk}
                        </a>
                      </div>
                    ))
                  )}
              </dd>
            </div>
          </dl>

          <div class="pt-2 flex gap-2">
            <DangerButton
              onclick={`adminAction('${deleteUrl}','DELETE','Delete this file? This cannot be undone.')`}
            >
              Delete
            </DangerButton>
          </div>
        </div>

        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            {blobKindLabel(kindOf)}
          </h2>
          {hint
            ? <p class="text-sm text-gray-200 mb-4">{hint}</p>
            : null}
          {isImage && (
            <img
              src={previewUrl}
              alt=""
              class="max-w-full max-h-96 object-contain rounded border border-gray-800"
            />
          )}
          {isVideo && (
            <video
              src={previewUrl}
              controls
              class="max-w-full max-h-96 rounded border border-gray-800"
            />
          )}
          {isAudio && <audio src={previewUrl} controls class="w-full mt-2" />}
          {!isImage && !isVideo && !isAudio && (
            <p class="text-gray-400 text-sm">
              {kindOf === "unknown"
                ? "No picture. This file was stored without a type, and it is not a page or an app. The old View link downloaded it."
                : kindOf === "app"
                ? "Android app package. There is no picture to show."
                : "No picture for this file. The title above is the only name stored inside it."}
            </p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
};
