import type { FC } from "@hono/hono/jsx";
import type { IDbHandle } from "../db/handle.ts";
import { REPORT_TYPES } from "../db/reports.ts";
import {
  AdminLayout,
  Badge,
  DangerButton,
  EmptyState,
  formatDate,
  PageHeader,
  Pagination,
  SecondaryButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  truncateHash,
} from "./layout.tsx";

const PAGE_SIZE = 50;

function reportTypeColor(type: string | null): string {
  switch (type) {
    case "nudity":
      return "red";
    case "illegal":
      return "red";
    case "malware":
      return "red";
    case "spam":
      return "yellow";
    case "impersonation":
      return "yellow";
    case "profanity":
      return "gray";
    default:
      return "gray";
  }
}

interface ReportsPageProps {
  db: IDbHandle;
  page: number;
  typeFilter: string;
}

export const ReportsPage: FC<ReportsPageProps> = async (
  { db, page, typeFilter },
) => {
  const offset = (page - 1) * PAGE_SIZE;
  const filter = typeFilter ? { type: typeFilter } : undefined;

  const [reports, total] = await Promise.all([
    db.listAllReports({
      filter,
      limit: PAGE_SIZE,
      offset,
      sort: ["created", "DESC"],
    }),
    db.countReports(filter),
  ]);

  const baseUrl = typeFilter
    ? `/admin/reports?type=${encodeURIComponent(typeFilter)}`
    : "/admin/reports";

  return (
    <AdminLayout title="Reports" section="reports">
      <PageHeader
        title="Reports"
        subtitle={`${total.toLocaleString()} report${total !== 1 ? "s" : ""}${
          typeFilter ? ` of type "${typeFilter}"` : ""
        }`}
      />

      {/* Type filter tabs */}
      <div class="mb-4 flex flex-wrap gap-2">
        <a
          href="/admin/reports"
          class={!typeFilter
            ? "px-3 py-1.5 rounded text-xs font-medium bg-purple-700 text-white"
            : "px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"}
        >
          All
        </a>
        {REPORT_TYPES.map((t) => (
          <a
            key={t}
            href={`/admin/reports?type=${t}`}
            class={typeFilter === t
              ? "px-3 py-1.5 rounded text-xs font-medium bg-purple-700 text-white"
              : "px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"}
          >
            {t}
          </a>
        ))}
      </div>

      {reports.length === 0 ? <EmptyState message="No reports found." /> : (
        <>
          <Table>
            <Thead>
              <tr>
                <Th>ID</Th>
                <Th>Type</Th>
                <Th>Blob</Th>
                <Th>Reporter</Th>
                <Th>Content</Th>
                <Th>Date</Th>
                <Th>Actions</Th>
              </tr>
            </Thead>
            <Tbody>
              {reports.map((report) => {
                const dismissUrl = `/admin/api/reports/${report.id}/dismiss`;
                const deleteBlobUrl =
                  `/admin/api/reports/${report.id}/delete-blob`;
                return (
                  <tr
                    key={report.id}
                    class="hover:bg-gray-900 transition-colors"
                  >
                    <Td mono>
                      <a
                        href={`/admin/reports/${report.id}`}
                        class="text-purple-400 hover:text-purple-300 hover:underline"
                      >
                        #{report.id}
                      </a>
                    </Td>
                    <Td>
                      {report.type
                        ? (
                          <Badge color={reportTypeColor(report.type)}>
                            {report.type}
                          </Badge>
                        )
                        : <span class="text-gray-600">—</span>}
                    </Td>
                    <Td mono>
                      <a
                        href={`/admin/blobs/${report.blob}`}
                        class="text-purple-400 hover:text-purple-300 hover:underline"
                        title={report.blob}
                      >
                        {truncateHash(report.blob)}
                      </a>
                    </Td>
                    <Td mono>
                      <span title={report.reporter} class="text-gray-300">
                        {truncateHash(report.reporter)}
                      </span>
                    </Td>
                    <Td>
                      <span
                        class="text-gray-400 max-w-xs truncate block"
                        title={report.content}
                      >
                        {report.content || (
                          <em class="text-gray-600">no content</em>
                        )}
                      </span>
                    </Td>
                    <Td>{formatDate(report.created)}</Td>
                    <Td>
                      <div class="flex gap-2 flex-wrap">
                        <SecondaryButton
                          onclick={`adminAction('${dismissUrl}','POST','Dismiss report #${report.id}?')`}
                        >
                          Dismiss
                        </SecondaryButton>
                        <DangerButton
                          onclick={`adminAction('${deleteBlobUrl}','POST','Delete the reported blob and dismiss all its reports? This cannot be undone.')`}
                        >
                          Delete blob
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
