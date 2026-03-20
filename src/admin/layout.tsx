import type { Child, FC } from "@hono/hono/jsx";

// Shared inline JS helpers: confirm → fetch → reload for action buttons.
// Defined once in the layout head, used across all admin pages.
const ACTION_SCRIPT = `
async function adminAction(url, method, msg) {
  if (!confirm(msg)) return;
  try {
    const res = await fetch(url, { method });
    if (res.ok) {
      location.reload();
    } else {
      const body = await res.json().catch(() => ({}));
      alert('Error ' + res.status + (body.error ? ': ' + body.error : ''));
    }
  } catch (e) {
    alert('Request failed: ' + e.message);
  }
}
`;

interface LayoutProps {
  title: string;
  section: "blobs" | "users" | "rules" | "reports";
  children?: Child;
}

const NAV_ITEMS = [
  { id: "blobs", label: "Blobs", href: "/admin/blobs" },
  { id: "users", label: "Users", href: "/admin/users" },
  { id: "rules", label: "Rules", href: "/admin/rules" },
  { id: "reports", label: "Reports", href: "/admin/reports" },
] as const;

export const AdminLayout: FC<LayoutProps> = ({ title, section, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — Blossom Admin</title>
      <script src="https://cdn.tailwindcss.com/3.4.17" />
      {/* deno-fmt-ignore */}
      <script dangerouslySetInnerHTML={{ __html: ACTION_SCRIPT }} />
    </head>
    <body class="bg-gray-950 text-gray-100 min-h-screen antialiased">
      <div class="flex min-h-screen">
        {/* Sidebar */}
        <nav class="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div class="px-4 py-5 border-b border-gray-800">
            <span class="text-sm font-bold tracking-widest text-gray-400 uppercase">
              Blossom Admin
            </span>
          </div>
          <ul class="flex-1 py-3">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  class={item.id === section
                    ? "flex items-center px-4 py-2.5 text-sm font-medium bg-gray-800 text-white border-l-2 border-purple-500"
                    : "flex items-center px-4 py-2.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors border-l-2 border-transparent"}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div class="px-4 py-4 border-t border-gray-800">
            <span class="text-xs text-gray-600">Basic Auth protected</span>
          </div>
        </nav>

        {/* Main content */}
        <main class="flex-1 overflow-auto">
          <div class="max-w-7xl mx-auto px-6 py-8">{children}</div>
        </main>
      </div>
    </body>
  </html>
);

// ── Shared UI primitives ─────────────────────────────────────────────────────

export const PageHeader: FC<{ title: string; subtitle?: string }> = (
  { title, subtitle },
) => (
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-white">{title}</h1>
    {subtitle && <p class="mt-1 text-sm text-gray-400">{subtitle}</p>}
  </div>
);

export const Table: FC<{ children?: Child }> = ({ children }) => (
  <div class="overflow-x-auto rounded-lg border border-gray-800">
    <table class="min-w-full divide-y divide-gray-800 text-sm">
      {children}
    </table>
  </div>
);

export const Thead: FC<{ children?: Child }> = ({ children }) => (
  <thead class="bg-gray-900 text-xs text-gray-400 uppercase tracking-wider">
    {children}
  </thead>
);

export const Tbody: FC<{ children?: Child }> = ({ children }) => (
  <tbody class="divide-y divide-gray-800 bg-gray-950">{children}</tbody>
);

export const Th: FC<{ children?: Child }> = ({ children }) => (
  <th class="px-4 py-3 text-left font-medium">{children}</th>
);

export const Td: FC<{ children?: Child; mono?: boolean }> = (
  { children, mono },
) => (
  <td class={`px-4 py-3 text-gray-300 ${mono ? "font-mono text-xs" : ""}`}>
    {children}
  </td>
);

export const Badge: FC<{ children?: Child; color?: string }> = (
  { children, color = "gray" },
) => {
  const colors: Record<string, string> = {
    gray: "bg-gray-800 text-gray-300",
    red: "bg-red-950 text-red-400",
    yellow: "bg-yellow-950 text-yellow-400",
    green: "bg-green-950 text-green-400",
    purple: "bg-purple-950 text-purple-400",
    blue: "bg-blue-950 text-blue-400",
  };
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        colors[color] ?? colors.gray
      }`}
    >
      {children}
    </span>
  );
};

export const DangerButton: FC<{
  onclick: string;
  children?: Child;
}> = ({ onclick, children }) => (
  <button
    type="button"
    onclick={onclick}
    class="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-red-950 text-red-400 hover:bg-red-900 hover:text-red-300 transition-colors cursor-pointer border border-red-900"
  >
    {children}
  </button>
);

export const SecondaryButton: FC<{
  onclick: string;
  children?: Child;
}> = ({ onclick, children }) => (
  <button
    type="button"
    onclick={onclick}
    class="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors cursor-pointer border border-gray-700"
  >
    {children}
  </button>
);

export const EmptyState: FC<{ message: string }> = ({ message }) => (
  <div class="py-16 text-center text-gray-500 text-sm">{message}</div>
);

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  baseUrl: string; // e.g. "/admin/blobs?q=foo"
}

export const Pagination: FC<PaginationProps> = (
  { page, total, pageSize, baseUrl },
) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const sep = baseUrl.includes("?") ? "&" : "?";
  const prevHref = page > 1 ? `${baseUrl}${sep}page=${page - 1}` : null;
  const nextHref = page < totalPages
    ? `${baseUrl}${sep}page=${page + 1}`
    : null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div class="mt-4 flex items-center justify-between text-sm text-gray-400">
      <span>
        {start}–{end} of {total}
      </span>
      <div class="flex gap-2">
        {prevHref
          ? (
            <a
              href={prevHref}
              class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
              ← Prev
            </a>
          )
          : (
            <span class="px-3 py-1 rounded bg-gray-900 text-gray-600 cursor-not-allowed">
              ← Prev
            </span>
          )}
        <span class="px-3 py-1">
          {page} / {totalPages}
        </span>
        {nextHref
          ? (
            <a
              href={nextHref}
              class="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
              Next →
            </a>
          )
          : (
            <span class="px-3 py-1 rounded bg-gray-900 text-gray-600 cursor-not-allowed">
              Next →
            </span>
          )}
      </div>
    </div>
  );
};

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function truncateHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

export function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace("T", " ").slice(0, 19) +
    " UTC";
}
