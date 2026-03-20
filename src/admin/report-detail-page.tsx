/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import {
  AdminLayout,
  Badge,
  DangerButton,
  formatDate,
  PageHeader,
  SecondaryButton,
  truncateHash,
} from "./layout.tsx";

function reportTypeColor(type: string | null): string {
  switch (type) {
    case "nudity":
    case "illegal":
    case "malware":
      return "red";
    case "spam":
    case "impersonation":
      return "yellow";
    default:
      return "gray";
  }
}

interface ReportDetailPageProps {
  db: IDbHandle;
  reportId: number;
}

export const ReportDetailPage: FC<ReportDetailPageProps> = async (
  { db, reportId },
) => {
  const report = await db.getReport(reportId);

  if (!report) {
    return (
      <AdminLayout title="Report not found" section="reports">
        <PageHeader title="Report not found" />
        <p class="text-gray-400 text-sm">
          No report with ID{" "}
          <code class="font-mono text-purple-400">#{reportId}</code> exists.
        </p>
        <a
          href="/admin/reports"
          class="mt-4 inline-block text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Reports
        </a>
      </AdminLayout>
    );
  }

  const dismissUrl = `/admin/api/reports/${report.id}/dismiss`;
  const deleteBlobUrl = `/admin/api/reports/${report.id}/delete-blob`;

  return (
    <AdminLayout title={`Report #${report.id}`} section="reports">
      <div class="mb-4">
        <a
          href="/admin/reports"
          class="text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Reports
        </a>
      </div>

      <PageHeader title={`Report #${report.id}`} />

      <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4 max-w-2xl">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Details
        </h2>

        <dl class="space-y-3">
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Report ID</dt>
            <dd class="font-mono text-sm text-gray-200">#{report.id}</dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Type</dt>
            <dd>
              {report.type
                ? (
                  <Badge color={reportTypeColor(report.type)}>
                    {report.type}
                  </Badge>
                )
                : <span class="text-gray-600 text-sm">—</span>}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Reported Blob</dt>
            <dd class="font-mono text-xs text-gray-200 break-all">
              <a
                href={`/admin/blobs/${report.blob}`}
                class="text-purple-400 hover:text-purple-300 hover:underline"
              >
                {report.blob}
              </a>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Reporter Pubkey</dt>
            <dd class="font-mono text-xs text-gray-200 break-all">
              {report.reporter}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Nostr Event ID</dt>
            <dd class="font-mono text-xs text-gray-400 break-all">
              {report.event_id}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Content</dt>
            <dd class="text-sm text-gray-300 whitespace-pre-wrap">
              {report.content || <em class="text-gray-600">no content</em>}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-0.5">Date</dt>
            <dd class="text-sm text-gray-200">{formatDate(report.created)}</dd>
          </div>
        </dl>

        <div class="pt-2 flex gap-2 flex-wrap border-t border-gray-800">
          <SecondaryButton
            onclick={`adminAction('${dismissUrl}','POST','Dismiss report #${report.id}?')`}
          >
            Dismiss report
          </SecondaryButton>
          <DangerButton
            onclick={`adminAction('${deleteBlobUrl}','POST','Delete blob ${
              truncateHash(report.blob)
            } and dismiss all its reports? This cannot be undone.')`}
          >
            Delete blob + dismiss all
          </DangerButton>
        </div>
      </div>
    </AdminLayout>
  );
};
