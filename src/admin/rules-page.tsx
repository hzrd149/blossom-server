/** @jsxImportSource hono/jsx */
import type { FC } from "@hono/hono/jsx";
import type { Config } from "../config/schema.ts";
import { AdminLayout, Badge, EmptyState, PageHeader, Tbody, Td, Th, Thead, Table } from "./layout.tsx";

interface RulesPageProps {
  config: Config;
}

function ruleTypeColor(type: string): string {
  switch (type) {
    case "allow":
      return "green";
    case "deny":
      return "red";
    default:
      return "gray";
  }
}

export const RulesPage: FC<RulesPageProps> = ({ config }) => {
  const rules = config.storage.rules;

  return (
    <AdminLayout title="Rules" section="rules">
      <PageHeader title="Storage Rules" subtitle={`${rules.length} rule${rules.length !== 1 ? "s" : ""} configured`} />

      <div class="mb-4 p-4 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-400">
        Rules are evaluated in order. The first matching rule wins. Rules are defined in{" "}
        <code class="font-mono text-purple-400">config.yml</code> under{" "}
        <code class="font-mono text-purple-400">storage.rules</code>.
      </div>

      {rules.length === 0 ? (
        <EmptyState message="No storage rules configured. All uploads are accepted by default." />
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>#</Th>
              <Th>Type</Th>
              <Th>MIME Pattern</Th>
              <Th>Pubkeys</Th>
              <Th>Expiration</Th>
            </tr>
          </Thead>
          <Tbody>
            {rules.map((rule, idx) => (
              <tr key={idx} class="hover:bg-gray-900 transition-colors">
                <Td>
                  <span class="text-gray-500 font-mono text-xs">{idx + 1}</span>
                </Td>
                <Td>
                  <Badge color={ruleTypeColor(rule.type)}>{rule.type}</Badge>
                </Td>
                <Td mono>
                  <span class="text-gray-200">{rule.type}</span>
                </Td>
                <Td>
                  {!rule.pubkeys || rule.pubkeys.length === 0 ? (
                    <span class="text-gray-600">all</span>
                  ) : (
                    <div class="space-y-0.5">
                      {rule.pubkeys.map((pk) => (
                        <div key={pk} class="font-mono text-xs text-gray-300">
                          {pk.slice(0, 16)}…
                        </div>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <Badge color="yellow">{rule.expiration}</Badge>
                </Td>
                <Td>
                  <span class="text-gray-600">—</span>
                </Td>
                <Td>
                  {!rule.pubkeys || rule.pubkeys.length === 0 ? (
                    <span class="text-gray-600">all</span>
                  ) : (
                    <div class="space-y-0.5">
                      {rule.pubkeys.map((pk) => (
                        <div key={pk} class="font-mono text-xs text-gray-300">
                          {pk.slice(0, 16)}…
                        </div>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  {rule.expiration ? (
                    <Badge color="yellow">{rule.expiration}</Badge>
                  ) : (
                    <span class="text-gray-600">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Global settings */}
      <div class="mt-6 bg-gray-900 border border-gray-800 rounded-lg p-5">
        <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Global Storage Settings</h2>
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt class="text-xs text-gray-500 mb-1">Remove when no owners</dt>
            <dd>
              <Badge color={config.storage.removeWhenNoOwners ? "red" : "gray"}>
                {config.storage.removeWhenNoOwners ? "enabled" : "disabled"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 mb-1">Backend</dt>
            <dd>
              <Badge color="purple">{config.storage.backend}</Badge>
            </dd>
          </div>
        </dl>
      </div>
    </AdminLayout>
  );
};
