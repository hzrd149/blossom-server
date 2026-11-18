import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  REPORT_FILTER_TYPES,
  ReportsQuerySchema,
} from "../../contracts/reports.ts";
import { adminApi } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorAlert,
  HashLink,
  Loading,
  PageHeader,
  Paginator,
} from "../components/ui.tsx";
import { UserBadge } from "../components/user.tsx";
import { formatBytes, formatDate, formatNumber } from "../lib/format.ts";
import { Link, setSearch, useLocation } from "../router.tsx";
import { useToast } from "../components/toasts.tsx";

export function ReportsPage() {
  const { search } = useLocation();
  const parsed = ReportsQuerySchema.safeParse(Object.fromEntries(search));
  const params = parsed.success ? parsed.data : ReportsQuerySchema.parse({});
  const [input, setInput] = useState(params.q);
  const notify = useToast();
  useEffect(() => setInput(params.q), [params.q]);
  const { data, error, isPending } = useQuery(adminQueries.reports(params));
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (
      { id, action }: { id: number; action: "dismiss" | "delete-blob" },
    ) => adminApi.reportAction(id, action),
    onSuccess: (_, variables) =>
      notify(
        variables.action === "dismiss"
          ? "Report dismissed."
          : "Blob deleted for all owners and its reports removed.",
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  useEffect(() => {
    if (data && params.page > 1 && !data.items.length) {
      setSearch({ page: Math.max(1, Math.ceil(data.total / data.pageSize)) });
    }
  }, [data, params.page]);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Review and moderate reported content"
      />
      <form
        className="flex flex-wrap gap-2 mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch({ q: input.trim(), page: 1 });
        }}
      >
        <input
          aria-label="Search reports"
          className="input flex-1 min-w-48"
          placeholder="Blob hash, reporter hex, event ID, or report text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn" type="submit">Search</button>
        <select
          aria-label="Report type"
          className="select w-auto"
          value={params.type}
          onChange={(e) => setSearch({ type: e.target.value, page: 1 })}
        >
          <option value="all">All types</option>
          <option value="unspecified">Unspecified</option>
          {REPORT_FILTER_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="Sort reports"
          className="select w-auto"
          value={params.sort}
          onChange={(e) => setSearch({ sort: e.target.value, page: 1 })}
        >
          <option value="created">Report date</option>
          <option value="type">Type</option>
          <option value="reporter">Reporter</option>
          <option value="blob">Blob</option>
        </select>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setSearch({ dir: params.dir === "desc" ? "asc" : "desc", page: 1 })}
        >
          {params.dir === "desc" ? "Descending" : "Ascending"}
        </button>
        <Link to="/reports" className="btn btn-ghost">Reset</Link>
      </form>
      <ErrorAlert error={error ?? action.error} />
      {isPending ? <Loading /> : data && (
        <>
          <p className="text-sm text-base-content/70 mb-3">
            {formatNumber(data.total)} reports · {formatNumber(data.blobCount)}
            {" "}
            blobs · {formatNumber(data.reporterCount)}{" "}
            reporters matching filters
          </p>
          <div className="space-y-3">
            {data.items.map((report) => (
              <article
                key={report.id}
                className="border border-base-300 rounded-box p-3 min-w-0"
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="badge badge-sm">
                    {report.type ?? "unspecified"}
                  </span>
                  <HashLink hash={report.blob} />
                  <span className="text-base-content/60">
                    {report.blobSize === null
                      ? "Blob no longer stored"
                      : `${report.blobType ?? "unknown type"} · ${
                        formatBytes(report.blobSize)
                      } · ${report.ownerCount} owner(s)`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm mt-2">
                  <Link
                    to={`/users/${report.reporter}`}
                    className="link link-hover min-w-0"
                  >
                    <UserBadge pubkey={report.reporter} />
                  </Link>
                  <span title="Reporter-supplied date">
                    {formatDate(report.created)}
                  </span>
                  <span className="text-base-content/60">
                    Report #{report.id}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words my-3">
                  {report.content || "No report text provided."}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/blobs/${report.blob}`} className="btn">
                    Inspect blob
                  </Link>
                  <CopyButton value={report.eventId} label="Copy event ID" />
                  <ConfirmButton
                    className="btn"
                    title="Dismiss report?"
                    description="Removes only this report. The blob remains available."
                    confirmLabel="Dismiss"
                    onConfirm={() =>
                      action.mutateAsync({ id: report.id, action: "dismiss" })}
                  >
                    Dismiss
                  </ConfirmButton>
                  <ConfirmButton
                    className="btn btn-error btn-outline"
                    title="Delete reported blob?"
                    description={`Permanently deletes this blob for all ${report.ownerCount} owner(s) and removes every report on it.`}
                    confirmLabel="Delete blob"
                    onConfirm={() =>
                      action.mutateAsync({
                        id: report.id,
                        action: "delete-blob",
                      })}
                  >
                    Delete blob
                  </ConfirmButton>
                </div>
              </article>
            ))}
          </div>
          {!data.items.length && (
            <EmptyState>No reports match these filters.</EmptyState>
          )}
          <Paginator
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => setSearch({ page })}
          />
          <p className="text-xs text-base-content/60">
            Retained reports only; dismissed reports are removed. Dates are
            supplied by reporters.
          </p>
        </>
      )}
    </>
  );
}
