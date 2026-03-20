/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import { nip19 } from "nostr-tools";
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

interface UserDetailPageProps {
  db: IDbHandle;
  pubkey: string;
  page: number;
}

export const UserDetailPage: FC<UserDetailPageProps> = async (
  { db, pubkey, page },
) => {
  // Validate pubkey is a 64-char hex string
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    return (
      <AdminLayout title="User not found" section="users">
        <div class="mb-4">
          <a
            href="/admin/users"
            class="text-sm text-gray-500 hover:text-gray-300"
          >
            ← Back to Users
          </a>
        </div>
        <PageHeader title="User not found" />
        <p class="text-gray-400 text-sm">
          Invalid pubkey:{" "}
          <code class="font-mono text-purple-400">{pubkey}</code>
        </p>
      </AdminLayout>
    );
  }

  const offset = (page - 1) * PAGE_SIZE;

  const [blobs, total] = await Promise.all([
    db.listBlobsByPubkeyAdmin(pubkey, { limit: PAGE_SIZE, offset }),
    db.countBlobsByPubkey(pubkey),
  ]);

  if (total === 0 && page === 1) {
    return (
      <AdminLayout title="User not found" section="users">
        <div class="mb-4">
          <a
            href="/admin/users"
            class="text-sm text-gray-500 hover:text-gray-300"
          >
            ← Back to Users
          </a>
        </div>
        <PageHeader title="User not found" />
        <p class="text-gray-400 text-sm">
          No blobs found for pubkey{" "}
          <code class="font-mono text-purple-400 break-all">{pubkey}</code>
        </p>
      </AdminLayout>
    );
  }

  // Compute total size across all blobs on this page (approximation — full total would need a separate SUM query)
  const pageSize = blobs.reduce((acc, b) => acc + b.size, 0);

  let npub = "";
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    // Silently ignore encoding errors — pubkey stays as hex
  }

  const deleteAllUrl = `/admin/api/users/${pubkey}`;
  const baseUrl = `/admin/users/${pubkey}`;

  return (
    <AdminLayout title={`User ${truncateHash(pubkey)}`} section="users">
      <div class="mb-4">
        <a
          href="/admin/users"
          class="text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Users
        </a>
      </div>

      <PageHeader
        title={`User ${truncateHash(pubkey)}`}
        subtitle={`${total.toLocaleString()} blob${total !== 1 ? "s" : ""}`}
      />

      {/* Identity card */}
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6 space-y-4">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Identity
        </h2>

        <dl class="space-y-3">
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Hex pubkey</dt>
            <dd class="font-mono text-xs text-gray-200 break-all select-all">
              {pubkey}
            </dd>
          </div>
          {npub && (
            <div>
              <dt class="text-xs text-gray-500 mb-0.5">npub</dt>
              <dd class="font-mono text-xs text-gray-200 break-all select-all">
                {npub}
              </dd>
            </div>
          )}
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Nostr profile</dt>
            <dd>
              <a
                href={`https://njump.me/${npub || pubkey}`}
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-purple-400 hover:text-purple-300 hover:underline"
              >
                View on njump.me ↗
              </a>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Total blobs</dt>
            <dd>
              <Badge color="purple">{total}</Badge>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Size (this page)</dt>
            <dd class="text-sm text-gray-200">{formatBytes(pageSize)}</dd>
          </div>
        </dl>

        <div class="pt-2">
          <DangerButton
            onclick={`adminAction('${deleteAllUrl}','DELETE','Delete ALL ${total} blob(s) for this user? This cannot be undone.')`}
          >
            Delete all blobs
          </DangerButton>
        </div>
      </div>

      {/* Blob list */}
      {blobs.length === 0 ? <EmptyState message="No blobs on this page." /> : (
        <>
          <Table>
            <Thead>
              <tr>
                <Th>Hash</Th>
                <Th>Type</Th>
                <Th>Size</Th>
                <Th>Uploaded</Th>
                <Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {blobs.map((blob) => (
                <tr
                  key={blob.sha256}
                  class="hover:bg-gray-900 transition-colors"
                >
                  <Td mono>
                    <a
                      href={`/admin/blobs/${blob.sha256}`}
                      class="text-purple-400 hover:text-purple-300 hover:underline"
                    >
                      {truncateHash(blob.sha256)}
                    </a>
                  </Td>
                  <Td>
                    {blob.type
                      ? <Badge color="blue">{blob.type}</Badge>
                      : <span class="text-gray-600 text-xs">—</span>}
                  </Td>
                  <Td>{formatBytes(blob.size)}</Td>
                  <Td>{formatDate(blob.uploaded)}</Td>
                  <Td>
                    <DangerButton
                      onclick={`adminAction('/admin/api/blobs/${blob.sha256}','DELETE','Delete this blob permanently? This cannot be undone.')`}
                    >
                      Delete
                    </DangerButton>
                  </Td>
                </tr>
              ))}
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
