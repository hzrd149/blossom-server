import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import {
  CONTENT_SORT_COLUMNS,
  type ContentItem,
  type ContentQuery,
} from "../../contracts/content.ts";
import { adminApi } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  EmptyState,
  ErrorAlert,
  HashLink,
  Loading,
  PageToolbar,
  Paginator,
} from "../components/ui.tsx";
import { UserBadge } from "../components/user.tsx";
import {
  formatBytes,
  formatDate,
  formatRelative,
  mediaKind,
} from "../lib/format.ts";
import { Link, setSearch, useLocation } from "../router.tsx";

const PAGE_SIZE = 50;
type Sort = ContentQuery["sort"];

function Preview({ item }: { item: ContentItem }) {
  if (mediaKind(item.type) !== "image") {
    return (
      <span className="badge badge-ghost badge-sm w-10 justify-center">
        {item.type?.split("/")[0] ?? "?"}
      </span>
    );
  }
  return (
    <img
      src={item.path}
      alt=""
      loading="lazy"
      className="h-10 w-10 rounded object-cover bg-base-300"
    />
  );
}

function SortHeader(
  { column, label, sort, dir }: {
    column: Sort;
    label: string;
    sort: Sort;
    dir: "asc" | "desc";
  },
) {
  const active = sort === column;
  return (
    <th>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:underline"
        onClick={() =>
          setSearch({
            sort: column,
            dir: active && dir === "desc" ? "asc" : "desc",
            page: 1,
          })}
      >
        {label}
        {active && <span aria-hidden>{dir === "desc" ? "▼" : "▲"}</span>}
      </button>
    </th>
  );
}

export function ContentPage() {
  const { search } = useLocation();
  const q = search.get("q") ?? "";
  const owner = search.get("owner") ?? undefined;
  const page = Math.max(1, Number(search.get("page")) || 1);
  const sortParam = search.get("sort") as Sort | null;
  const sort: Sort = sortParam && CONTENT_SORT_COLUMNS.includes(sortParam)
    ? sortParam
    : "uploaded";
  const dir = search.get("dir") === "asc" ? "asc" : "desc";

  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [q, owner, page, sort, dir]);

  const queryClient = useQueryClient();
  const { data, error, isPending, isFetching } = useQuery(
    adminQueries.content({ q, owner, page, pageSize: PAGE_SIZE, sort, dir }),
  );
  const remove = useMutation({
    mutationFn: async (hashes: string[]) => {
      for (const hash of hashes) await adminApi.deleteBlob(hash);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch({ q: draft.trim(), page: 1 });
  };
  const items = data?.items ?? [];
  const allSelected = items.length > 0 &&
    items.every((item) => selected.has(item.sha256));
  const toggle = (hash: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  return (
    <>
      <PageToolbar
        actions={
          <ConfirmButton
            disabled={selected.size === 0}
            title={`Delete ${selected.size} blob${
              selected.size === 1 ? "" : "s"
            }?`}
            description="Each blob is removed from storage for every owner. This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => remove.mutateAsync([...selected])}
          >
            Delete selected ({selected.size})
          </ConfirmButton>
        }
      >
        {owner && (
          <>
            Blobs owned by <UserBadge pubkey={owner} />
          </>
        )}
      </PageToolbar>
      <form onSubmit={submit} className="mb-3 flex flex-wrap gap-2">
        <input
          className="input input-bordered flex-1 min-w-48"
          placeholder="Filter by hash or MIME type (e.g. video/)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn">Filter</button>
        {(q || owner) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setSearch({ q: null, owner: null, page: 1 })}
          >
            Clear filters
          </button>
        )}
        {isFetching && !isPending && (
          <span className="loading loading-spinner loading-sm self-center" />
        )}
      </form>
      <ErrorAlert error={error ?? remove.error} />
      {isPending
        ? <Loading />
        : !data
        ? null
        : items.length === 0
        ? <EmptyState>No blobs match.</EmptyState>
        : (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label="Select page"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(items.map((item) => item.sha256)),
                        )}
                    />
                  </th>
                  <th />
                  <SortHeader
                    column="sha256"
                    label="Hash"
                    sort={sort}
                    dir={dir}
                  />
                  <SortHeader
                    column="type"
                    label="Type"
                    sort={sort}
                    dir={dir}
                  />
                  <SortHeader
                    column="size"
                    label="Size"
                    sort={sort}
                    dir={dir}
                  />
                  <SortHeader
                    column="uploaded"
                    label="Uploaded"
                    sort={sort}
                    dir={dir}
                  />
                  <th>Owners</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.sha256} className="hover:bg-base-200/50">
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`Select ${item.sha256}`}
                        checked={selected.has(item.sha256)}
                        onChange={() =>
                          toggle(item.sha256)}
                      />
                    </td>
                    <td>
                      <Preview item={item} />
                    </td>
                    <td>
                      <HashLink hash={item.sha256} />
                    </td>
                    <td className="font-mono text-xs">{item.type ?? "—"}</td>
                    <td className="tabular-nums">{formatBytes(item.size)}</td>
                    <td title={formatDate(item.uploaded)}>
                      {formatRelative(item.uploaded)}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {item.owners.slice(0, 2).map((pubkey) => (
                          <Link
                            key={pubkey}
                            to={`/users/${pubkey}`}
                            className="link link-hover"
                          >
                            <UserBadge pubkey={pubkey} />
                          </Link>
                        ))}
                        {item.owners.length > 2 && (
                          <span className="text-xs text-base-content/60">
                            +{item.owners.length - 2} more
                          </span>
                        )}
                        {item.owners.length === 0 && (
                          <span className="text-xs text-base-content/50">
                            no owners
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {data && (
        <Paginator
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          onPage={(p) => setSearch({ page: p })}
        />
      )}
    </>
  );
}
