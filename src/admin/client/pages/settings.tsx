import { useQuery } from "@tanstack/react-query";
import { adminQueries } from "../api/queries.ts";
import { ErrorAlert, Loading, PageHeader } from "../components/ui.tsx";
import { formatBytes } from "../lib/format.ts";

export function SettingsPage() {
  const { data, error, isPending } = useQuery(adminQueries.configuration());
  if (isPending) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  const { settings } = data;
  const rows: [string, string][] = [
    ["Storage backend", settings.storageBackend],
    ["Active storage rules", String(settings.storageRuleCount)],
    ["Uploads", settings.uploadEnabled ? "enabled" : "disabled"],
    ["Maximum upload size", formatBytes(settings.uploadMaxSize)],
    [
      "Upload authentication",
      settings.uploadRequireAuth ? "required" : "optional",
    ],
  ];
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Server configuration is managed in config.yml and applied on restart."
      />
      {!settings.uploadRequireAuth && (
        <div
          role="alert"
          className="alert alert-warning alert-soft mb-4 text-sm"
        >
          Uploads do not require authentication. Anonymous uploads are owned by
          a shared "anonymous" pseudo-user, so they cannot be traced to a
          pubkey.
        </div>
      )}
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th className="w-1/3 font-medium text-base-content/70">
                  {label}
                </th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
