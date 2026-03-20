/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import {
  AdminLayout,
  Badge,
  EmptyState,
  PageHeader,
  Pagination,
  Tbody,
  Td,
  Th,
  Thead,
  Table,
  truncateHash,
} from "./layout.tsx";

const PAGE_SIZE = 50;

interface UsersPageProps {
  db: IDbHandle;
  page: number;
  q: string;
}

export const UsersPage: FC<UsersPageProps> = async ({ db, page, q }) => {
  const offset = (page - 1) * PAGE_SIZE;
  const filter = q ? { q } : undefined;

  const [users, total] = await Promise.all([
    db.listAllUsers({ filter, limit: PAGE_SIZE, offset }),
    db.countUsers(filter),
  ]);

  const baseUrl = q ? `/admin/users?q=${encodeURIComponent(q)}` : "/admin/users";

  return (
    <AdminLayout title="Users" section="users">
      <PageHeader title="Users" subtitle={`${total.toLocaleString()} distinct pubkey${total !== 1 ? "s" : ""}`} />

      {/* Search form */}
      <form method="get" action="/admin/users" class="mb-4 flex gap-2">
        <input
          type="text"
          name="q"
          value={q}
          placeholder="Search by pubkey…"
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
            href="/admin/users"
            class="px-4 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            Clear
          </a>
        )}
      </form>

      {users.length === 0 ? (
        <EmptyState message={q ? `No users matching "${q}"` : "No users yet."} />
      ) : (
        <>
          <Table>
            <Thead>
              <tr>
                <Th>Pubkey</Th>
                <Th>Blobs</Th>
                <Th>Total Size</Th>
                <Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {users.map((user) => {
                const blobCount = user.blobs.length;
                return (
                  <tr key={user.pubkey} class="hover:bg-gray-900 transition-colors">
                    <Td mono>
                      <span title={user.pubkey} class="text-gray-200">
                        {truncateHash(user.pubkey)}
                      </span>
                      <span class="ml-2 text-gray-600 text-xs select-all hidden group-hover:inline">{user.pubkey}</span>
                    </Td>
                    <Td>
                      <Badge>{blobCount}</Badge>
                    </Td>
                    <Td>—</Td>
                    <Td>
                      <a
                        href={`/admin/blobs?q=${encodeURIComponent(user.pubkey)}`}
                        class="text-xs text-purple-400 hover:text-purple-300 hover:underline"
                      >
                        View blobs →
                      </a>
                    </Td>
                  </tr>
                );
              })}
            </Tbody>
          </Table>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} baseUrl={baseUrl} />
        </>
      )}
    </AdminLayout>
  );
};
