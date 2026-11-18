import { useQuery } from "@tanstack/react-query";
import { adminQueries } from "../api/queries.ts";
import { ErrorAlert, Loading, StatTile } from "../components/ui.tsx";
import {
  formatBytes,
  formatDate,
  formatNumber,
  formatRelative,
} from "../lib/format.ts";
import { Link } from "../router.tsx";

function PruneCard() {
  const { data, error } = useQuery(adminQueries.pruneStatus());
  const rules = useQuery(adminQueries.rules());
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h2 className="card-title text-base">Retention</h2>
        <ErrorAlert error={error ?? rules.error} />
        {data && rules.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-base-content/60">Rules</dt>
            <dd>
              {rules.data.rules.filter((r) => r.enabled !== false).length}{" "}
              active
              {rules.data.configFile.inSync ? "" : " (config.yml differs)"}
            </dd>
            <dt className="text-base-content/60">Prune</dt>
            <dd>
              {data.running
                ? <span className="badge badge-info badge-sm">running</span>
                : data.enabled
                ? "idle"
                : "nothing to prune"}
            </dd>
            <dt className="text-base-content/60">Last run</dt>
            <dd
              title={formatDate(
                data.lastRun ? data.lastRun.finished / 1000 : null,
              )}
            >
              {data.lastRun
                ? `${
                  formatRelative(data.lastRun.finished / 1000)
                } — ${data.lastRun.deleted} deleted, ${data.lastRun.errors} errors`
                : "not yet"}
            </dd>
            <dt className="text-base-content/60">Next run</dt>
            <dd>{data.nextRun ? formatRelative(data.nextRun / 1000) : "—"}</dd>
          </dl>
        )}
        <div className="card-actions justify-end">
          <Link to="/rules" className="btn">Manage rules</Link>
        </div>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { data, error, isPending } = useQuery(adminQueries.summary());
  return (
    <>
      <ErrorAlert error={error} />
      {isPending
        ? <Loading />
        : data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label="Blobs"
              value={formatNumber(data.blobCount)}
              to="/content"
            />
            <StatTile
              label="Stored"
              value={formatBytes(data.totalSize)}
              hint="logical bytes"
            />
            <StatTile
              label="New in 24h"
              value={formatNumber(data.dailyUploads)}
              to="/content?sort=uploaded&dir=desc"
            />
            <StatTile
              label="Users"
              value={formatNumber(data.userCount)}
              hint="owners and reporters"
              to="/users"
            />
            <StatTile
              label="Reports"
              to="/reports"
              value={formatNumber(data.reportCount)}
              hint={`${formatNumber(data.reportedBlobCount)} reported blob${
                data.reportedBlobCount === 1 ? "" : "s"
              }`}
            />
          </div>
        )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <PruneCard />
      </div>
    </>
  );
}
