import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import {
  BAN_CATEGORIES,
  type BannedBlobsQuery,
  type ModerationPage as Page,
} from "../../contracts/moderation.ts";
import { adminApi } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorAlert,
  HashLink,
  Loading,
  PageToolbar,
  Paginator,
} from "../components/ui.tsx";
import { useToast } from "../components/toasts.tsx";
import { safeNpub, UserBadge } from "../components/user.tsx";
import {
  BanBlobButton,
  BanUserButton,
  CategorySelect,
} from "../components/moderation.tsx";
import { formatDate, formatRelative } from "../lib/format.ts";
import { Link, setSearch, useLocation } from "../router.tsx";

const TABS = [
  ["users", "Banned users"],
  ["blobs", "Banned blobs"],
] as const;
type Tab = typeof TABS[number][0];

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.all });
}

/** Page, search text, and optional category from the URL. */
function useListParams() {
  const { search } = useLocation();
  const page = Math.max(1, Number(search.get("page")) || 1);
  const q = search.get("q") ?? "";
  const category = search.get("category") ?? "all";
  return { page, q, category };
}

function SearchForm(
  { q, label, placeholder, children }: {
    q: string;
    label: string;
    placeholder: string;
    children?: ReactNode;
  },
) {
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  return (
    <form
      className="mb-3 flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setSearch({ q: input.trim(), page: 1 });
      }}
    >
      <input
        aria-label={label}
        className="input min-w-48 flex-1"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button className="btn" type="submit">Search</button>
      {children}
    </form>
  );
}

function ListFrame<T>(
  { data, error, isPending, empty, children }: {
    data: Page<T> | undefined;
    error: unknown;
    isPending: boolean;
    empty: ReactNode;
    children: (items: T[]) => ReactNode;
  },
) {
  // Step back when the current page empties (e.g. after unbanning its last entry).
  useEffect(() => {
    if (data && data.page > 1 && data.items.length === 0) {
      setSearch({ page: Math.max(1, Math.ceil(data.total / data.pageSize)) });
    }
  }, [data]);
  if (isPending) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  return (
    <>
      <ErrorAlert error={error} />
      {data.items.length === 0
        ? <EmptyState>{empty}</EmptyState>
        : (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm">{children(data.items)}</table>
          </div>
        )}
      <Paginator
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        onPage={(page) => setSearch({ page })}
      />
    </>
  );
}

// --- Banned users ---

function BannedUsersTab() {
  const { page, q } = useListParams();
  const query = useQuery(adminQueries.bannedPubkeys({ page, q }));
  const notify = useToast();
  const invalidate = useInvalidate();
  const unban = useMutation({
    mutationFn: adminApi.unbanPubkey,
    onSuccess: () => notify("User unbanned. Removed content is not restored."),
    onSettled: invalidate,
  });
  return (
    <>
      <PageToolbar actions={<BanUserButton className="btn btn-error" />}>
        Banned users cannot upload, mirror, or file reports. They can still
        delete their own blobs.
      </PageToolbar>
      <SearchForm
        q={q}
        label="Search banned users"
        placeholder="Search npub, pubkey (hex), reason, or note"
      />
      <ErrorAlert error={unban.error} />
      <ListFrame {...query} empty="No banned users.">
        {(items) => (
          <>
            <thead>
              <tr>
                <th>User</th>
                <th>Reason</th>
                <th>Note</th>
                <th>Banned</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ban) => (
                <tr key={ban.pubkey}>
                  <td>
                    <Link
                      to={`/users/${ban.pubkey}`}
                      className="link link-hover"
                    >
                      <UserBadge pubkey={ban.pubkey} />
                    </Link>
                  </td>
                  <td>
                    {ban.reason
                      ? <span className="badge badge-soft">{ban.reason}</span>
                      : "—"}
                  </td>
                  <td className="max-w-md break-words">{ban.note ?? "—"}</td>
                  <td title={formatDate(ban.created)}>
                    {formatRelative(ban.created)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <CopyButton
                        className="btn btn-ghost btn-sm"
                        value={safeNpub(ban.pubkey) ?? ban.pubkey}
                        label="Copy npub"
                      />
                      <ConfirmButton
                        className="btn btn-ghost btn-sm"
                        title="Unban user?"
                        description="The user can upload, mirror, and report again. Content removed by the ban is not restored."
                        confirmLabel="Unban"
                        onConfirm={() => unban.mutateAsync(ban.pubkey)}
                      >
                        Unban
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </ListFrame>
    </>
  );
}

// --- Banned blobs ---

function BannedBlobsTab() {
  const { page, q, category } = useListParams();
  const params: Partial<BannedBlobsQuery> = {
    page,
    q,
    category: (BAN_CATEGORIES as readonly string[]).includes(category)
      ? category as BannedBlobsQuery["category"]
      : "all",
  };
  const query = useQuery(adminQueries.bannedBlobs(params));
  const notify = useToast();
  const invalidate = useInvalidate();
  const unban = useMutation({
    mutationFn: adminApi.unbanBlob,
    onSuccess: () =>
      notify(
        "Blob unbanned. It can be uploaded again; deleted files are not restored.",
      ),
    onSettled: invalidate,
  });
  return (
    <>
      <PageToolbar actions={<BanBlobButton className="btn btn-error" />}>
        Banned hashes are deleted and refused on upload and mirror.
      </PageToolbar>
      <SearchForm
        q={q}
        label="Search banned blobs"
        placeholder="Search hash or note"
      >
        <CategorySelect
          className="select w-auto"
          value={params.category === "all" ? "" : params.category!}
          allowNone="All categories"
          label="Filter by category"
          onChange={(value) => setSearch({ category: value, page: 1 })}
        />
      </SearchForm>
      <ErrorAlert error={unban.error} />
      <ListFrame {...query} empty="No banned blobs.">
        {(items) => (
          <>
            <thead>
              <tr>
                <th>Blob</th>
                <th>Category</th>
                <th>Note</th>
                <th>Banned</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ban) => (
                <tr key={ban.sha256}>
                  <td>
                    <HashLink hash={ban.sha256} />
                  </td>
                  <td>
                    <span className="badge badge-soft badge-error">
                      {ban.category}
                    </span>
                  </td>
                  <td className="max-w-md break-words">{ban.note ?? "—"}</td>
                  <td title={formatDate(ban.created)}>
                    {formatRelative(ban.created)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <CopyButton
                        className="btn btn-ghost btn-sm"
                        value={ban.sha256}
                        label="Copy hash"
                      />
                      <ConfirmButton
                        className="btn btn-ghost btn-sm"
                        title="Unban blob?"
                        description="The hash can be uploaded again. Deleted files are not restored."
                        confirmLabel="Unban"
                        onConfirm={() => unban.mutateAsync(ban.sha256)}
                      >
                        Unban
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </ListFrame>
    </>
  );
}

// --- Page ---

export function ModerationPage() {
  const { search } = useLocation();
  const requested = search.get("tab");
  const tab: Tab = TABS.some(([key]) => key === requested)
    ? requested as Tab
    : "users";
  const select = (key: Tab) =>
    setSearch({ tab: key, page: null, q: null, category: null });
  return (
    <>
      <div
        role="tablist"
        aria-label="Moderation"
        className="tabs tabs-border mb-4 flex-nowrap overflow-x-auto"
      >
        {TABS.map(([key, label], index) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`moderation-tab-${key}`}
            aria-controls={`moderation-panel-${key}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className={`tab whitespace-nowrap ${
              tab === key ? "tab-active" : ""
            }`}
            onClick={() => select(key)}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight"
                ? (index + 1) % TABS.length
                : event.key === "ArrowLeft"
                ? (index + TABS.length - 1) % TABS.length
                : event.key === "Home"
                ? 0
                : event.key === "End"
                ? TABS.length - 1
                : null;
              if (next === null) return;
              event.preventDefault();
              select(TABS[next][0]);
              document.getElementById(`moderation-tab-${TABS[next][0]}`)
                ?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`moderation-panel-${tab}`}
        aria-labelledby={`moderation-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "users" && <BannedUsersTab />}
        {tab === "blobs" && <BannedBlobsTab />}
      </div>
    </>
  );
}
