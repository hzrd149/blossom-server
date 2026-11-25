import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  REPORT_FILTER_TYPES,
  type ReportItem,
  type ReportsQuery,
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
  PageToolbar,
  Paginator,
  SortHeader,
} from "../components/ui.tsx";
import { UserBadge } from "../components/user.tsx";
import {
  formatBytes,
  formatDate,
  formatNumber,
  formatRelative,
  mediaKind,
} from "../lib/format.ts";
import { Link, setSearch, useLocation } from "../router.tsx";
import { useToast } from "../components/toasts.tsx";
import { BanBlobButton, categoryForReport } from "../components/moderation.tsx";
import type { BanCategory } from "../../contracts/moderation.ts";

type Sort = ReportsQuery["sort"];

const plural = (count: number, word: string) =>
  `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;

/** Reported media is blurred until hovered so moderators opt in to seeing it. */
function Preview({ report }: { report: ReportItem }) {
  const kind = report.blobSize === null ? null : mediaKind(report.blobType);
  if (kind !== "image") {
    return (
      <span className="badge badge-ghost badge-sm w-10 justify-center">
        {report.blobSize === null ? "—" : report.blobType?.split("/")[0] ?? "?"}
      </span>
    );
  }
  return (
    <Link to={`/blobs/${report.blob}`} title="Inspect blob">
      <img
        src={report.path}
        alt=""
        loading="lazy"
        className="h-10 w-10 rounded object-cover bg-base-300 blur-sm hover:blur-none transition"
      />
    </Link>
  );
}

/** One action per distinct blob, even when several reports reference it. */
function onePerBlob(reports: ReportItem[]): ReportItem[] {
  const byBlob = new Map<string, ReportItem>();
  for (const report of reports) {
    if (!byBlob.has(report.blob)) byBlob.set(report.blob, report);
  }
  return [...byBlob.values()];
}

export function ReportsPage() {
  const { search } = useLocation();
  const parsed = ReportsQuerySchema.safeParse(Object.fromEntries(search));
  const params = parsed.success ? parsed.data : ReportsQuerySchema.parse({});
  const [input, setInput] = useState(params.q);
  const notify = useToast();
  useEffect(() => setInput(params.q), [params.q]);
  const { data, error, isPending, isFetching } = useQuery(
    adminQueries.reports(params),
  );
  const items = data?.items ?? [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const paramsKey = JSON.stringify(params);
  useEffect(() => setSelected(new Set()), [paramsKey]);
  const selectedReports = items.filter((report) => selected.has(report.id));
  const selectedBlobs = onePerBlob(selectedReports);
  const allSelected = items.length > 0 &&
    items.every((report) => selected.has(report.id));
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: async (
      { ids, action }: { ids: number[]; action: "dismiss" | "delete-blob" },
    ) => {
      for (const id of ids) await adminApi.reportAction(id, action);
    },
    onSuccess: (_, { ids, action }) => {
      setSelected(new Set());
      notify(
        action === "dismiss"
          ? `${plural(ids.length, "report")} dismissed.`
          : `${
            plural(ids.length, "blob")
          } deleted for all owners. Reports retained.`,
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  const dismiss = (ids: number[]) =>
    action.mutateAsync({ ids, action: "dismiss" });
  const deleteBlobs = (reports: ReportItem[]) =>
    action.mutateAsync({
      ids: onePerBlob(reports).map((report) => report.id),
      action: "delete-blob",
    });

  const cleanup = useMutation({
    mutationFn: adminApi.cleanupReports,
    onSuccess: (result) => {
      setSelected(new Set());
      notify(`${plural(result.deleted, "report")} permanently deleted.`);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });

  /** Ban the blobs of the given reports (one call per distinct blob); returns the toast text. */
  const banBlobs = async (
    reports: ReportItem[],
    input: { category: BanCategory; note: string },
  ): Promise<string> => {
    const blobs = onePerBlob(reports);
    const done = new Set<string>();
    let deleted = 0;
    try {
      for (const report of blobs) {
        const result = await adminApi.banReportedBlob(report.id, input);
        done.add(report.blob);
        deleted += result.deleted.length;
      }
    } catch (err) {
      // Keep the failed and unprocessed rows selected so the action can be retried.
      setSelected((current) =>
        new Set(
          items.filter((r) => current.has(r.id) && !done.has(r.blob)).map((r) =>
            r.id
          ),
        )
      );
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${
          plural(done.size, "blob")
        } of ${blobs.length} banned before an error: ${reason}`,
      );
    }
    setSelected(new Set());
    return `${plural(blobs.length, "blob")} banned. ${
      plural(deleted, "stored blob")
    } deleted. Reports retained.`;
  };
  const sharedCategory = (reports: ReportItem[]): BanCategory => {
    const categories = new Set(reports.map((r) => categoryForReport(r.type)));
    return categories.size === 1 ? [...categories][0] : "other";
  };

  useEffect(() => {
    if (data && params.page > 1 && !data.items.length) {
      setSearch({ page: Math.max(1, Math.ceil(data.total / data.pageSize)) });
    }
  }, [data, params.page]);

  return (
    <>
      <PageToolbar
        actions={
          <>
            <ConfirmButton
              className="btn btn-sm"
              disabled={selected.size === 0}
              title={`Dismiss ${plural(selected.size, "report")}?`}
              description="Marks the selected reports as dismissed. Reports and blobs are retained."
              confirmLabel="Dismiss"
              onConfirm={() => dismiss([...selected])}
            >
              Dismiss ({selected.size})
            </ConfirmButton>
            <ConfirmButton
              className="btn btn-sm btn-error btn-outline"
              disabled={selectedBlobs.length === 0}
              title={`Delete ${plural(selectedBlobs.length, "reported blob")}?`}
              description={`Permanently deletes ${
                plural(selectedBlobs.length, "blob")
              } for all ${
                plural(
                  selectedBlobs.reduce((sum, r) => sum + r.ownerCount, 0),
                  "owner",
                )
              }. Reports are retained. This cannot be undone.`}
              confirmLabel="Delete blobs"
              onConfirm={() => deleteBlobs(selectedBlobs)}
            >
              Delete blobs ({selectedBlobs.length})
            </ConfirmButton>
            <BanBlobButton
              className="btn btn-sm btn-error"
              disabled={selectedBlobs.length === 0}
              title={`Ban ${plural(selectedBlobs.length, "reported blob")}`}
              label={`Ban blobs (${selectedBlobs.length})`}
              defaultCategory={sharedCategory(selectedBlobs)}
              submit={(input) => banBlobs(selectedBlobs, input)}
            />
          </>
        }
      >
        {data && (
          <>
            <span>
              <strong className="text-base-content">
                {formatNumber(data.total)}
              </strong>{" "}
              reports
            </span>
            <span>
              <strong className="text-base-content">
                {formatNumber(data.blobCount)}
              </strong>{" "}
              blobs
            </span>
            <span>
              <strong className="text-base-content">
                {formatNumber(data.reporterCount)}
              </strong>{" "}
              reporters
            </span>
          </>
        )}
      </PageToolbar>
      <div className="flex flex-wrap gap-2 mb-3">
        <ConfirmButton
          className="btn btn-error btn-outline"
          disabled={cleanup.isPending}
          title="Clear reports for missing blobs?"
          description="Permanently deletes all reports across the server whose blobs are not stored, including active and dismissed reports. Current filters and selection do not limit this action. This cannot be undone."
          confirmLabel="Delete reports"
          onConfirm={() => cleanup.mutateAsync("missing")}
        >
          Clear reports for missing blobs
        </ConfirmButton>
        <ConfirmButton
          className="btn btn-error btn-outline"
          disabled={cleanup.isPending}
          title="Clear dismissed reports?"
          description="Permanently deletes all dismissed reports across the server, whether their blobs are stored or missing. Current filters and selection do not limit this action. Blobs are not deleted. This cannot be undone."
          confirmLabel="Delete reports"
          onConfirm={() => cleanup.mutateAsync("dismissed")}
        >
          Clear dismissed reports
        </ConfirmButton>
      </div>
      {(params.reporter || params.owner) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          {params.reporter && (
            <span className="inline-flex items-center gap-2">
              Filed by <UserBadge pubkey={params.reporter} />
            </span>
          )}
          {params.owner && (
            <span className="inline-flex items-center gap-2">
              On blobs owned by <UserBadge pubkey={params.owner} />
            </span>
          )}
        </div>
      )}
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
          aria-label="Report status"
          className="select w-auto"
          value={params.status}
          onChange={(e) => setSearch({ status: e.target.value, page: 1 })}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          aria-label="Blob availability"
          className="select w-auto"
          value={params.availability}
          onChange={(e) => setSearch({ availability: e.target.value, page: 1 })}
        >
          <option value="all">All blobs</option>
          <option value="stored">Stored</option>
          <option value="missing">Not stored</option>
        </select>
        {(params.q || params.reporter || params.owner ||
          params.type !== "all" || params.status !== "all" ||
          params.availability !== "all") && (
          <Link to="/reports" className="btn btn-ghost">Reset</Link>
        )}
        {isFetching && !isPending && (
          <span className="loading loading-spinner loading-sm self-center" />
        )}
      </form>
      <ErrorAlert error={error ?? action.error ?? cleanup.error} />
      {isPending
        ? <Loading />
        : !data
        ? null
        : items.length === 0
        ? <EmptyState>No reports match these filters.</EmptyState>
        : (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="w-px">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label="Select page"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(items.map((report) => report.id)),
                        )}
                    />
                  </th>
                  <th className="w-px" />
                  <SortHeader<Sort>
                    column="blob"
                    label="Blob"
                    sort={params.sort}
                    dir={params.dir}
                  />
                  <SortHeader<Sort>
                    column="type"
                    label="Report"
                    sort={params.sort}
                    dir={params.dir}
                  />
                  <SortHeader<Sort>
                    column="reporter"
                    label="Reporter"
                    sort={params.sort}
                    dir={params.dir}
                  />
                  <SortHeader<Sort>
                    column="created"
                    label="Reported"
                    sort={params.sort}
                    dir={params.dir}
                  />
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((report) => (
                  <tr
                    key={report.id}
                    className={selected.has(report.id)
                      ? "bg-base-200"
                      : "hover:bg-base-200/50"}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`Select report ${report.id}`}
                        checked={selected.has(report.id)}
                        onChange={() => toggle(report.id)}
                      />
                    </td>
                    <td>
                      <Preview report={report} />
                    </td>
                    <td className="whitespace-nowrap">
                      <HashLink hash={report.blob} />
                      <div className="text-xs text-base-content/60">
                        {report.blobSize === null
                          ? <span className="text-warning">Not stored</span>
                          : (
                            <>
                              <span className="font-mono">
                                {report.blobType ?? "unknown"}
                              </span>{" "}
                              · {formatBytes(report.blobSize)} ·{" "}
                              {plural(report.ownerCount, "owner")}
                            </>
                          )}
                      </div>
                      {report.blobReportCount > 1 && (
                        <button
                          type="button"
                          className="link link-hover text-xs text-error"
                          title="Show all reports on this blob"
                          onClick={() =>
                            setSearch({
                              q: report.blob,
                              type: null,
                              status: null,
                              availability: null,
                              page: 1,
                            })}
                        >
                          {plural(report.blobReportCount, "report")} on blob
                        </button>
                      )}
                    </td>
                    <td className="min-w-64 max-w-md">
                      <span
                        className={`badge badge-sm ${
                          report.type ? "badge-soft badge-error" : "badge-ghost"
                        }`}
                      >
                        {report.type ?? "unspecified"}
                      </span>
                      <span className="badge badge-ghost badge-sm ml-1">
                        {report.dismissed ? "Dismissed" : "Active"}
                      </span>
                      <p
                        className={`mt-1 text-sm line-clamp-2 break-words ${
                          report.content ? "" : "text-base-content/50 italic"
                        }`}
                        title={report.content || undefined}
                      >
                        {report.content || "No report text"}
                      </p>
                    </td>
                    <td>
                      <Link
                        to={`/users/${report.reporter}`}
                        className="link link-hover"
                      >
                        <UserBadge pubkey={report.reporter} />
                      </Link>
                    </td>
                    <td
                      className="whitespace-nowrap"
                      title={`${
                        formatDate(report.created)
                      } (reporter-supplied)`}
                    >
                      {formatRelative(report.created)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <Link
                          to={`/blobs/${report.blob}`}
                          className="btn btn-ghost btn-xs"
                        >
                          Inspect
                        </Link>
                        <CopyButton
                          className="btn btn-ghost btn-xs"
                          value={report.eventId}
                          label="Event ID"
                        />
                        <ConfirmButton
                          className="btn btn-ghost btn-xs"
                          title="Dismiss report?"
                          description="Marks this report as dismissed. The report and blob are retained."
                          disabled={report.dismissed || action.isPending}
                          confirmLabel="Dismiss"
                          onConfirm={() => dismiss([report.id])}
                        >
                          Dismiss
                        </ConfirmButton>
                        <ConfirmButton
                          className="btn btn-ghost btn-xs text-error"
                          title="Delete reported blob?"
                          description={`Permanently deletes this blob for all ${
                            plural(report.ownerCount, "owner")
                          }. All reports are retained.`}
                          disabled={report.blobSize === null ||
                            action.isPending}
                          confirmLabel="Delete blob"
                          onConfirm={() => deleteBlobs([report])}
                        >
                          Delete
                        </ConfirmButton>
                        <BanBlobButton
                          className="btn btn-ghost btn-xs text-error"
                          label="Ban"
                          title="Ban reported blob"
                          defaultCategory={categoryForReport(report.type)}
                          submit={(input) => banBlobs([report], input)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {data && (
        <>
          <Paginator
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => setSearch({ page })}
          />
          <p className="text-xs text-base-content/60">
            Reports survive dismissal, deletion, bans, and pruning until
            explicitly cleaned up. Dates are supplied by reporters. Image
            previews are blurred until hovered.
          </p>
        </>
      )}
    </>
  );
}
