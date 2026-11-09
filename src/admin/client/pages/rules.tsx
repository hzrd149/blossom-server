import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { useEffect, useMemo, useState } from "react";
import type {
  ManagedStorageRule,
  PruneCandidateDto,
  RuleProbe,
  RuleProbeResult,
  RulesView,
} from "../../contracts/rules.ts";
import { adminApi, AdminApiError } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  EmptyState,
  ErrorAlert,
  HashLink,
  Loading,
  PageHeader,
} from "../components/ui.tsx";
import { safeNpub } from "../components/user.tsx";
import { formatBytes, formatDate, formatRelative } from "../lib/format.ts";

interface DraftRule {
  key: number;
  type: string;
  expiration: string;
  basis: "accessed" | "uploaded";
  pubkeys: string;
  enabled: boolean;
  note: string;
}

let nextKey = 1;

function toDraft(rule: ManagedStorageRule): DraftRule {
  return {
    key: nextKey++,
    type: rule.type,
    expiration: rule.expiration,
    basis: rule.basis ?? "accessed",
    pubkeys: (rule.pubkeys ?? []).map((pk) => safeNpub(pk) ?? pk).join("\n"),
    enabled: rule.enabled !== false,
    note: rule.note ?? "",
  };
}

/** Parse the pubkey textarea (npub, nprofile, or hex; newline/comma separated). */
function parsePubkeys(text: string): { pubkeys: string[]; invalid: string[] } {
  const pubkeys: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    let pubkey: string | null = null;
    try {
      pubkey = normalizeToPubkey(token);
    } catch { /* invalid */ }
    if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) pubkeys.push(pubkey);
    else invalid.push(token);
  }
  return { pubkeys: [...new Set(pubkeys)], invalid };
}

function fromDraft(draft: DraftRule): ManagedStorageRule {
  const { pubkeys } = parsePubkeys(draft.pubkeys);
  return {
    type: draft.type.trim(),
    expiration: draft.expiration.trim(),
    ...(draft.basis === "uploaded" ? { basis: "uploaded" as const } : {}),
    ...(pubkeys.length ? { pubkeys } : {}),
    enabled: draft.enabled,
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
}

const normalizeForCompare = (rules: ManagedStorageRule[]) =>
  JSON.stringify(
    rules.map((r) => ({
      ...r,
      basis: r.basis === "uploaded" ? "uploaded" : undefined,
      enabled: r.enabled !== false,
    })),
  );

function RuleRow(
  { rule, index, count, editable, issues, update, move, remove }: {
    rule: DraftRule;
    index: number;
    count: number;
    editable: boolean;
    issues: string[];
    update: (patch: Partial<DraftRule>) => void;
    move: (delta: number) => void;
    remove: () => void;
  },
) {
  const { invalid } = parsePubkeys(rule.pubkeys);
  return (
    <li
      className={`rounded-box border bg-base-100 p-4 ${
        issues.length || invalid.length ? "border-error" : "border-base-300"
      } ${rule.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-neutral">#{index + 1}</span>
        <label className="label cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-success"
            checked={rule.enabled}
            disabled={!editable}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          {rule.enabled ? "Enabled" : "Disabled"}
        </label>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!editable || index === 0}
            onClick={() => move(-1)}
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!editable || index === count - 1}
            onClick={() => move(1)}
            aria-label="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            className="btn btn-ghost text-error"
            disabled={!editable}
            onClick={remove}
          >
            Remove
          </button>
        </div>
      </div>
      <fieldset
        disabled={!editable}
        className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr]"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-base-content/70">MIME pattern</span>
          <input
            className="input input-bordered font-mono"
            value={rule.type}
            placeholder="image/*"
            onChange={(e) => update({ type: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-base-content/70">Keep for</span>
          <input
            className="input input-bordered"
            value={rule.expiration}
            placeholder="1 month"
            onChange={(e) => update({ expiration: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-base-content/70">Measured from</span>
          <select
            className="select select-bordered"
            value={rule.basis}
            onChange={(e) =>
              update({ basis: e.target.value as DraftRule["basis"] })}
          >
            <option value="accessed">Last access (falls back to upload)</option>
            <option value="uploaded">First upload</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="text-base-content/70">
            Only for pubkeys (npub or hex, one per line; empty = everyone)
          </span>
          <textarea
            className="textarea textarea-bordered font-mono"
            rows={2}
            value={rule.pubkeys}
            onChange={(e) => update({ pubkeys: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-base-content/70">Note</span>
          <input
            className="input input-bordered"
            value={rule.note}
            maxLength={500}
            onChange={(e) => update({ note: e.target.value })}
          />
        </label>
      </fieldset>
      {(issues.length > 0 || invalid.length > 0) && (
        <ul className="mt-2 text-sm text-error">
          {invalid.length > 0 && (
            <li>Not a valid pubkey: {invalid.join(", ")}</li>
          )}
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
    </li>
  );
}

function ProbePanel({ rules }: { rules: ManagedStorageRule[] }) {
  const [probe, setProbe] = useState<
    {
      endpoint: NonNullable<RuleProbe["endpoint"]>;
      mimeType: string;
      pubkey: string;
    }
  >({
    endpoint: "upload",
    mimeType: "image/png",
    pubkey: "",
  });
  const preview = useMutation({
    mutationFn: () => {
      const pubkey = probe.pubkey.trim()
        ? parsePubkeys(probe.pubkey).pubkeys[0] ?? probe.pubkey.trim()
        : undefined;
      return adminApi.previewRules({
        rules,
        probes: [{
          endpoint: probe.endpoint,
          mimeType: probe.mimeType.trim() || null,
          pubkey,
        }],
      });
    },
  });
  const result: RuleProbeResult | undefined = preview.data?.probes[0];
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">Test an upload</h2>
        <p className="text-sm text-base-content/60">
          Checks the rules in the Rules tab, including unsaved changes.
        </p>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            preview.mutate();
          }}
        >
          <select
            className="select select-bordered"
            value={probe.endpoint}
            onChange={(e) =>
              setProbe({
                ...probe,
                endpoint: e.target.value as typeof probe.endpoint,
              })}
          >
            <option value="upload">PUT /upload</option>
            <option value="media">PUT /media</option>
            <option value="mirror">PUT /mirror</option>
          </select>
          <input
            className="input input-bordered font-mono"
            placeholder="MIME type"
            value={probe.mimeType}
            onChange={(e) => setProbe({ ...probe, mimeType: e.target.value })}
          />
          <input
            className="input input-bordered font-mono"
            placeholder="Uploader npub or hex (optional)"
            value={probe.pubkey}
            onChange={(e) => setProbe({ ...probe, pubkey: e.target.value })}
          />
          <button
            type="submit"
            className="btn"
            disabled={preview.isPending}
          >
            Test
          </button>
        </form>
        <ErrorAlert error={preview.error} />
        {result && (
          <div
            role="status"
            className={`alert alert-soft ${
              result.accepted ? "alert-success" : "alert-warning"
            }`}
          >
            {result.accepted
              ? `Accepted — governed by rule #${(result.ruleIndex ?? 0) + 1}`
              : `Rejected with ${result.status}: ${result.reason}`}
          </div>
        )}
      </div>
    </section>
  );
}

function describeReason(candidate: PruneCandidateDto): string {
  const reason = candidate.reason;
  if (reason.kind === "ownerless") return "no owners";
  if (reason.kind === "thumbnail") return "thumbnail of pruned blob";
  return `rule #${reason.ruleIndex + 1}, ${
    reason.basis === "accessed" ? "last accessed" : "uploaded"
  } ${formatRelative(reason.basisTimestamp)}`;
}

function PrunePanel({ rules }: { rules: ManagedStorageRule[] }) {
  const queryClient = useQueryClient();
  const status = useQuery(adminQueries.pruneStatus());
  const sample = useMutation({
    mutationFn: () => adminApi.previewRules({ rules, prune: true }),
  });
  const run = useMutation({
    mutationFn: adminApi.runPrune,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.prune }),
  });
  // Refresh inventory views once a manual run finishes.
  const running = status.data?.running;
  useEffect(() => {
    if (running === false) {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.content });
    }
  }, [running, queryClient]);
  const candidates = sample.data?.pruneSample ?? null;
  const totalBytes = candidates?.reduce((sum, c) => sum + c.size, 0) ?? 0;
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3">
        <h2 className="card-title text-base">Prune</h2>
        <ErrorAlert error={status.error ?? run.error ?? sample.error} />
        {status.data && (
          <p className="text-sm">
            {status.data.running
              ? <span className="badge badge-info badge-sm">running</span>
              : "Idle"} · last run {status.data.lastRun
              ? (
                <span title={formatDate(status.data.lastRun.finished / 1000)}>
                  {formatRelative(status.data.lastRun.finished / 1000)}{" "}
                  ({status.data.lastRun.deleted} deleted,{" "}
                  {status.data.lastRun.errors} errors)
                </span>
              )
              : "never"}
            {status.data.nextRun && (
              <>· next {formatRelative(status.data.nextRun / 1000)}</>
            )}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={sample.isPending}
            onClick={() => sample.mutate()}
          >
            {sample.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Preview with draft rules
          </button>
          <ConfirmButton
            className="btn btn-warning"
            disabled={status.data?.running}
            title="Run prune now?"
            description="Deletes expired blobs according to the saved rules (not unsaved changes)."
            confirmLabel="Run prune"
            onConfirm={() => run.mutateAsync()}
          >
            Run prune now
          </ConfirmButton>
        </div>
        {candidates && (
          candidates.length === 0
            ? (
              <p className="text-sm text-base-content/60">
                Nothing would be deleted in the next cycle.
              </p>
            )
            : (
              <>
                <p className="text-sm">
                  Next cycle would delete at least{" "}
                  <strong>{candidates.length}</strong> blob(s),{" "}
                  {formatBytes(totalBytes)}. Sample of up to{" "}
                  {status.data?.batchSize ?? "batch size"} per rule:
                </p>
                <ul className="max-h-72 overflow-y-auto text-sm">
                  {candidates.slice(0, 200).map((c) => (
                    <li
                      key={c.sha256}
                      className="flex justify-between gap-2 py-0.5"
                    >
                      <HashLink hash={c.sha256} />
                      <span className="text-base-content/60 text-right">
                        {describeReason(c)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )
        )}
      </div>
    </section>
  );
}

function RulesEditor({ view }: { view: RulesView }) {
  const queryClient = useQueryClient();
  const tabs = ["Rules", "Prune", "Debug"] as const;
  const [tab, setTab] = useState<typeof tabs[number]>("Rules");
  const [draft, setDraft] = useState<DraftRule[]>(() =>
    view.rules.map(toDraft)
  );
  const [baseVersion, setBaseVersion] = useState(view.version);
  const saved = useMemo(() => normalizeForCompare(view.rules), [view.rules]);
  const draftRules = useMemo(() => draft.map(fromDraft), [draft]);
  const dirty = normalizeForCompare(draftRules) !== saved;
  const hasInvalidPubkeys = draft.some((rule) =>
    parsePubkeys(rule.pubkeys).invalid.length > 0
  );

  const discard = () => {
    setDraft(view.rules.map(toDraft));
    setBaseVersion(view.version);
  };

  const onSaved = (next: RulesView) => {
    queryClient.setQueryData(adminQueryKeys.rules, next);
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.prune });
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.blobs });
    setDraft(next.rules.map(toDraft));
    setBaseVersion(next.version);
  };
  const save = useMutation({
    mutationFn: () =>
      adminApi.saveRules({ version: baseVersion, rules: draftRules }),
    onSuccess: onSaved,
  });
  const reset = useMutation({
    mutationFn: () => adminApi.resetRules(baseVersion),
    onSuccess: onSaved,
  });
  const conflict = save.error instanceof AdminApiError &&
    save.error.status === 409;

  const issuesFor = (index: number) =>
    save.error instanceof AdminApiError
      ? save.error.issues.filter((issue) =>
        issue.path.startsWith(`rules.${index}.`)
      ).map((issue) => `${issue.path.split(".")[2]}: ${issue.message}`)
      : [];
  const update = (index: number, patch: Partial<DraftRule>) =>
    setDraft((rules) =>
      rules.map((r, i) => i === index ? { ...r, ...patch } : r)
    );
  const move = (index: number, delta: number) =>
    setDraft((rules) => {
      const next = [...rules];
      const [rule] = next.splice(index, 1);
      next.splice(index + delta, 0, rule);
      return next;
    });
  const activeCount = draft.filter((rule) => rule.enabled).length;

  return (
    <>
      <PageHeader
        title="Storage rules"
        subtitle="Rules are evaluated top to bottom; the first match admits an upload and decides how long it is kept."
        actions={view.editable && (
          <>
            <ConfirmButton
              className="btn btn-ghost"
              title="Reset rules to config.yml?"
              description="Replaces every database-managed rule with storage.rules from config.yml. Changes apply immediately."
              confirmLabel="Reset"
              onConfirm={() => reset.mutateAsync()}
            >
              Reset to config
            </ConfirmButton>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!dirty}
              onClick={discard}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || hasInvalidPubkeys || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Save &amp; apply
            </button>
          </>
        )}
      />
      {!view.editable && (
        <div role="note" className="alert alert-info alert-soft mb-4 text-sm">
          These rules come from <code>storage.rules</code>{" "}
          in config.yml and are read-only. Set{" "}
          <code className="break-all">storage.rulesManagement: database</code>
          {" "}
          to edit them here and apply changes without a restart.
        </div>
      )}
      {conflict && (
        <div role="alert" className="alert alert-warning mb-4">
          <span>
            Someone else changed the rules. Your edits were not saved.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: adminQueryKeys.rules })
                .then(discard)}
          >
            Load latest (discard mine)
          </button>
        </div>
      )}
      {!conflict && (
        <ErrorAlert
          error={save.error ?? reset.error}
          title="Rules were not saved"
        />
      )}
      {activeCount === 0 && (
        <div
          role="alert"
          className="alert alert-warning alert-soft mb-4 text-sm"
        >
          With no enabled rules, every upload is rejected.
        </div>
      )}
      {(view.requirePubkeyInRule.upload || view.requirePubkeyInRule.media) && (
        <div role="note" className="alert alert-soft mb-4 text-sm">
          <code>requirePubkeyInRule</code>{" "}
          is on{view.requirePubkeyInRule.upload ? " for uploads" : ""}
          {view.requirePubkeyInRule.media ? " for media" : ""}: only rules with
          a pubkey list can admit uploads.
        </div>
      )}
      <div
        role="tablist"
        aria-label="Storage rules tools"
        className="tabs tabs-border mb-4"
      >
        {tabs.map((name, index) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`rules-tab-${name}`}
            aria-controls={`rules-panel-${name}`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            className={`tab ${tab === name ? "tab-active" : ""}`}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                ? (index + tabs.length - 1) % tabs.length
                : event.key === "Home"
                ? 0
                : event.key === "End"
                ? tabs.length - 1
                : null;
              if (next === null) return;
              event.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`rules-tab-${tabs[next]}`)?.focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="rules-panel-Rules"
        aria-labelledby="rules-tab-Rules"
        hidden={tab !== "Rules"}
      >
        {draft.length === 0
          ? <EmptyState>No rules.</EmptyState>
          : (
            <ol className="flex flex-col gap-3">
              {draft.map((rule, index) => (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  index={index}
                  count={draft.length}
                  editable={view.editable}
                  issues={issuesFor(index)}
                  update={(patch) => update(index, patch)}
                  move={(delta) => move(index, delta)}
                  remove={() =>
                    setDraft((rules) => rules.filter((_, i) => i !== index))}
                />
              ))}
            </ol>
          )}
        {view.editable && (
          <button
            type="button"
            className="btn btn-outline mt-3"
            onClick={() =>
              setDraft((
                rules,
              ) => [...rules, toDraft({ type: "*", expiration: "1 week" })])}
          >
            Add rule
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id="rules-panel-Prune"
        aria-labelledby="rules-tab-Prune"
        hidden={tab !== "Prune"}
      >
        <PrunePanel rules={draftRules} />
      </div>
      <div
        role="tabpanel"
        id="rules-panel-Debug"
        aria-labelledby="rules-tab-Debug"
        hidden={tab !== "Debug"}
      >
        <ProbePanel rules={draftRules} />
      </div>
    </>
  );
}

export function RulesPage() {
  const { data, error, isPending } = useQuery(adminQueries.rules());
  if (isPending) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  // Re-mount the editor when the saved version changes outside this session (e.g. reset).
  return <RulesEditor key={data.version} view={data} />;
}
