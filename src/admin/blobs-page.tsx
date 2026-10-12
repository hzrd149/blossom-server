import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { mimeToExt } from "../utils/mime.ts";
import {
  blobKind,
  blobKindLabel,
  type BlobListFilter,
  pageFileHint,
} from "../utils/blob-kind.ts";
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

const FILTERS: { id: BlobListFilter; label: string }[] = [
  { id: "images", label: "Pictures" },
  { id: "pages", label: "Pages" },
  { id: "apps", label: "Apps" },
  { id: "video", label: "Video" },
  { id: "unlabeled", label: "Unlabeled" },
  { id: "all", label: "All" },
];

function parseKind(raw: string): BlobListFilter {
  if (
    raw === "pages" || raw === "apps" || raw === "video" ||
    raw === "unlabeled" || raw === "all"
  ) return raw;
  return "images";
}

async function readHead(
  storage: IBlobStorage,
  sha256: string,
  ext: string,
): Promise<string> {
  const stream = await storage.read(sha256, ext);
  if (!stream) return "";
  const reader = stream.getReader();
  try {
    const { value } = await reader.read();
    if (!value) return "";
    return new TextDecoder("utf-8", { fatal: false }).decode(value.slice(0, 800));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

interface BlobsPageProps {
  db: IDbHandle;
  storage: IBlobStorage;
  page: number;
  q: string;
  kind: string;
}

export const BlobsPage: FC<BlobsPageProps> = async (
  { db, storage, page, q, kind: kindRaw },
) => {
  const kind = parseKind(kindRaw);
  const offset = (page - 1) * PAGE_SIZE;
  const filter = {
    ...(q ? { q } : {}),
    ...(kind === "all" ? {} : { kind }),
  };

  const [blobs, total] = await Promise.all([
    db.listAllBlobs({
      filter,
      limit: PAGE_SIZE,
      offset,
      sort: ["uploaded", "DESC"],
    }),
    db.countBlobs(filter),
  ]);

  const hints = new Map<string, string>();
  if (kind === "pages" || kind === "all") {
    await Promise.all(blobs.map(async (blob) => {
      if (blobKind(blob.type) !== "page" && blobKind(blob.type) !== "text") {
        return;
      }
      const head = await readHead(storage, blob.sha256, mimeToExt(blob.type));
      const hint = pageFileHint(blob.type, head);
      if (hint) hints.set(blob.sha256, hint);
    }));
  }

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  query.set("kind", kind);
  const baseUrl = `/admin/blobs?${query.toString()}`;

  return (
    <AdminLayout title="Blobs" section="blobs">
      <PageHeader
        title="Blobs"
        subtitle={`${total.toLocaleString()} in this view`}
      />

      <p class="text-sm text-gray-400 mb-4 max-w-3xl">
        Pictures show on this page, so you can look without downloading.
        Blossom does not keep the original file name or which repository it
        came from. Page files show their title when they have one. Apps are
        the Android packages. Unlabeled files have no type and no picture.
      </p>

      <div class="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <a
            href={`/admin/blobs?kind=${item.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            class={item.id === kind
              ? "px-3 py-1.5 rounded-full bg-purple-700 text-white text-sm"
              : "px-3 py-1.5 rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm"}
          >
            {item.label}
          </a>
        ))}
      </div>

      <form method="get" action="/admin/blobs" class="mb-4 flex gap-2">
        <input type="hidden" name="kind" value={kind} />
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
            href={`/admin/blobs?kind=${kind}`}
            class="px-4 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            Clear
          </a>
        )}
      </form>

      {blobs.length === 0
        ? (
          <EmptyState
            message={q
              ? `Nothing matching "${q}" in this view.`
              : "Nothing in this view."}
          />
        )
        : (
          <>
            <Table>
              <Thead>
                <tr>
                  <Th>Preview</Th>
                  <Th>What it is</Th>
                  <Th>Size</Th>
                  <Th>Uploaded</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {blobs.map((blob) => {
                  const kindOf = blobKind(blob.type);
                  const hint = hints.get(blob.sha256);
                  const deleteUrl = `/admin/api/blobs/${blob.sha256}`;
                  const owner = blob.owners[0];
                  return (
                    <tr
                      key={blob.sha256}
                      class="hover:bg-gray-900 transition-colors"
                    >
                      <Td>
                        {kindOf === "image"
                          ? (
                            <a href={`/admin/blobs/${blob.sha256}`}>
                              <img
                                src={`/admin/preview/${blob.sha256}`}
                                alt=""
                                loading="lazy"
                                class="h-16 w-24 object-contain bg-gray-950 rounded border border-gray-800"
                              />
                            </a>
                          )
                          : (
                            <a
                              href={`/admin/blobs/${blob.sha256}`}
                              class="inline-flex h-16 w-24 items-center justify-center rounded border border-gray-800 bg-gray-950 text-xs text-gray-400"
                            >
                              {blobKindLabel(kindOf)}
                            </a>
                          )}
                      </Td>
                      <Td>
                        <div class="space-y-1">
                          <Badge
                            color={kindOf === "image"
                              ? "purple"
                              : kindOf === "unknown"
                              ? "gray"
                              : "blue"}
                          >
                            {blobKindLabel(kindOf)}
                          </Badge>
                          {hint
                            ? (
                              <p class="text-sm text-gray-200 max-w-xs truncate">
                                {hint}
                              </p>
                            )
                            : null}
                          {blob.type
                            ? (
                              <p class="text-xs text-gray-500">{blob.type}</p>
                            )
                            : (
                              <p class="text-xs text-gray-500">
                                No name was stored with this file
                              </p>
                            )}
                          {owner
                            ? (
                              <a
                                href={`/admin/users/${owner}`}
                                class="block text-xs text-purple-400 hover:text-purple-300 font-mono"
                              >
                                {truncateHash(owner)}
                              </a>
                            )
                            : null}
                        </div>
                      </Td>
                      <Td>{formatBytes(blob.size)}</Td>
                      <Td>{formatDate(blob.uploaded)}</Td>
                      <Td>
                        <div class="flex gap-2 items-center">
                          <a
                            href={`/admin/blobs/${blob.sha256}`}
                            class="text-xs text-gray-300 hover:text-white"
                          >
                            Open
                          </a>
                          <DangerButton
                            onclick={`adminAction('${deleteUrl}','DELETE','Delete this file? This cannot be undone.')`}
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
