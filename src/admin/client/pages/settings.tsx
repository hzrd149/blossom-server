import { useQuery } from "@tanstack/react-query";
import { adminQueries } from "../api/queries.ts";
import { ErrorAlert, Loading, PageToolbar } from "../components/ui.tsx";
import { formatBytes } from "../lib/format.ts";

export function SettingsPage() {
  const { data, error, isPending } = useQuery(adminQueries.configuration());
  if (isPending) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  const { settings } = data;
  const rows: [string, string][] = [
    ["Storage backend", settings.storageBackend],
    ["Config file", data.configFile.path ?? "none"],
    [
      "Storage rules editing",
      data.configFile.writable
        ? "saved to the config file and applied immediately"
        : "export only (config file is not writable by the server)",
    ],
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
      <PageToolbar>
        Server configuration is managed in config.yml and applied on restart.
        Storage rules are edited on the Rules page and apply immediately.
      </PageToolbar>
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
