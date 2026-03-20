import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import type { Config } from "../config/schema.ts";
import { mimeToExt } from "../utils/mime.ts";
import {
  AdminLayout,
  Badge,
  DangerButton,
  EmptyState,
  formatBytes,
  formatDate,
  PageHeader,
  Pagination,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  truncateHash,
} from "./layout.tsx";

const PAGE_SIZE = 50;

function getBlobUrl(
  sha256: string,
  type: string | null,
  config: Config,
  host: string,
): string {
  const ext = mimeToExt(type);
  const base = config.publicDomain
    ? `https://${config.publicDomain.replace(/\/$/, "")}`
    : `http://${host}`;
  return `${base}/${sha256}${ext ? "." + ext : ""}`;
}

function mimeColor(mime: string | null): string {
  if (!mime) return "gray";
  if (mime.startsWith("image/")) return "purple";
  if (mime.startsWith("video/")) return "blue";
  if (mime.startsWith("audio/")) return "green";
  if (mime.startsWith("text/")) return "yellow";
  return "gray";
}

interface BlobsPageProps {
  db: IDbHandle;
  config: Config;
  host: string;
  page: number;
  q: string;
}

export const BlobsPage: FC<BlobsPageProps> = async (
  { db, config, host, page, q },
) => {
  const offset = (page - 1) * PAGE_SIZE;
  const filter = q ? { q } : undefined;

  const [blobs, total] = await Promise.all([
    db.listAllBlobs({
      filter,
      limit: PAGE_SIZE,
      offset,
      sort: ["uploaded", "DESC"],
    }),
    db.countBlobs(filter),
  ]);

  const baseUrl = q
    ? `/admin/blobs?q=${encodeURIComponent(q)}`
    : "/admin/blobs";

  return (
    <AdminLayout title="Blobs" section="blobs">
      <PageHeader
        title="Blobs"
        subtitle={`${total.toLocaleString()} total blob${
          total !== 1 ? "s" : ""
        }`}
      />

      {/* Search form */}
      <form method="get" action="/admin/blobs" class="mb-4 flex gap-2">
        <input
          type="text"
          name="q"
          value={q}
          placeholder="Search by hash or MIME type…"
          class="flex-1 max-w-md bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
        />
        <button
          type="submit"
          class="px-4 py-2 rounded bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium transition-colors"
        >
          Search
        </button>
        {q && (
          <a
            href="/admin/blobs"
            class="px-4 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            Clear
          </a>
        )}
      </form>

      {blobs.length === 0
        ? (
          <EmptyState
            message={q ? `No blobs matching "${q}"` : "No blobs stored yet."}
          />
        )
        : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th>Hash</Th>
                  <Th>Type</Th>
                  <Th>Size</Th>
                  <Th>Owners</Th>
                  <Th>Uploaded</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {blobs.map((blob) => {
                  const blobUrl = getBlobUrl(
                    blob.sha256,
                    blob.type,
                    config,
                    host,
                  );
                  const deleteUrl = `/admin/api/blobs/${blob.sha256}`;
                  return (
                    <tr
                      key={blob.sha256}
                      class="hover:bg-gray-900 transition-colors"
                    >
                      <Td mono>
                        <a
                          href={`/admin/blobs/${blob.sha256}`}
                          class="text-purple-400 hover:text-purple-300 hover:underline"
                          title={blob.sha256}
                        >
                          {truncateHash(blob.sha256)}
                        </a>
                      </Td>
                      <Td>
                        {blob.type
                          ? (
                            <Badge color={mimeColor(blob.type)}>
                              {blob.type}
                            </Badge>
                          )
                          : <span class="text-gray-600">—</span>}
                      </Td>
                      <Td>{formatBytes(blob.size)}</Td>
                      <Td>
                        <Badge>{blob.owners.length}</Badge>
                      </Td>
                      <Td>{formatDate(blob.uploaded)}</Td>
                      <Td>
                        <div class="flex gap-2 items-center">
                          <a
                            href={blobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                          >
                            View ↗
                          </a>
                          <DangerButton
                            onclick={`adminAction('${deleteUrl}','DELETE','Delete blob ${
                              truncateHash(
                                blob.sha256,
                              )
                            }? This cannot be undone.')`}
                          >
                            Delete
                          </DangerButton>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Tbody>
            </Table>
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              baseUrl={baseUrl}
            />
          </>
        )}
    </AdminLayout>
  );
};
