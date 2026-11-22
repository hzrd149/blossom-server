import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { type RefObject, useMemo, useRef, useState } from "react";
import type {
  ConfigFileView,
  ManagedStorageRule,
  RenderedConfig,
  RulesView,
} from "../../contracts/rules.ts";
import { adminApi, AdminApiError } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorAlert,
  Loading,
  PageToolbar,
} from "../components/ui.tsx";
import { useToast } from "../components/toasts.tsx";
import { safeNpub } from "../components/user.tsx";
import { normalizeNip05Domain } from "../../../allowlist/nip05-domain.ts";

interface DraftRule {
  key: number;
  type: string;
  expiration: string;
  basis: "accessed" | "uploaded";
  pubkeys: string;
  nip05Domains: string;
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
    nip05Domains: (rule.nip05Domains ?? []).join("\n"),
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

/** Parse the NIP-05 domain textarea (newline/comma separated bare domains). */
function parseDomains(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    try {
      domains.push(normalizeNip05Domain(token));
    } catch {
      invalid.push(token);
    }
  }
  return { domains: [...new Set(domains)], invalid };
}

function fromDraft(draft: DraftRule): ManagedStorageRule {
  const { pubkeys } = parsePubkeys(draft.pubkeys);
  const { domains } = parseDomains(draft.nip05Domains);
  return {
    type: draft.type.trim(),
    expiration: draft.expiration.trim(),
    ...(draft.basis === "uploaded" ? { basis: "uploaded" as const } : {}),
    ...(pubkeys.length ? { pubkeys } : {}),
    ...(domains.length ? { nip05Domains: domains } : {}),
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
  { rule, index, count, issues, update, move, remove }: {
    rule: DraftRule;
    index: number;
    count: number;
    issues: string[];
    update: (patch: Partial<DraftRule>) => void;
    move: (delta: number) => void;
    remove: () => void;
  },
) {
  const { invalid } = parsePubkeys(rule.pubkeys);
  const invalidDomains = parseDomains(rule.nip05Domains).invalid;
  return (
    <li
      className={`rounded-box border bg-base-100 p-4 ${
        issues.length || invalid.length || invalidDomains.length
          ? "border-error"
          : "border-base-300"
      } ${rule.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-neutral">#{index + 1}</span>
        <label className="label cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-success"
            checked={rule.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          {rule.enabled ? "Enabled" : "Disabled"}
        </label>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={index === 0}
            onClick={() => move(-1)}
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={index === count - 1}
            onClick={() => move(1)}
            aria-label="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            className="btn btn-ghost text-error"
            onClick={remove}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
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
            Only for pubkeys (npub or hex, one per line; empty and no domains =
            everyone)
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
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="text-base-content/70">
            Also for members of NIP-05 domains (one per line; every pubkey in
            the domain's /.well-known/nostr.json)
          </span>
          <textarea
            className="textarea textarea-bordered font-mono"
            rows={1}
            value={rule.nip05Domains}
            placeholder="example.org"
            onChange={(e) => update({ nip05Domains: e.target.value })}
          />
        </label>
      </div>
      {(issues.length > 0 || invalid.length > 0 || invalidDomains.length > 0) &&
        (
          <ul className="mt-2 text-sm text-error">
            {invalid.length > 0 && (
              <li>Not a valid pubkey: {invalid.join(", ")}</li>
            )}
            {invalidDomains.length > 0 && (
              <li>Not a bare domain: {invalidDomains.join(", ")}</li>
            )}
            {issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        )}
    </li>
  );
}

type ConfigTab = "full" | "rules";

/**
 * Review the rendered config.yml. Writable configs are written and applied from
 * here; read-only configs are copied or downloaded for the operator to install.
 */
function ConfigDialog(
  { dialog, file, rendered, renderError, save }: {
    dialog: RefObject<HTMLDialogElement | null>;
    file: ConfigFileView;
    rendered: RenderedConfig | undefined;
    renderError: unknown;
    save: {
      mutate: () => void;
      isPending: boolean;
      error: unknown;
      reset: () => void;
    };
  },
) {
  const [tab, setTab] = useState<ConfigTab>("full");
  const text = rendered
    ? (tab === "full" ? rendered.text : rendered.snippet)
    : "";
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = tab === "full" ? "config.yml" : "storage-rules.yml";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const close = () => dialog.current?.close();
  const fileName = file.path ?? "config.yml";
  return (
    <dialog ref={dialog} className="modal" onClose={save.reset}>
      <div className="modal-box flex max-w-4xl flex-col gap-3">
        <h3 className="text-lg font-semibold">
          {file.writable ? `Write rules to ${fileName}` : `Updated ${fileName}`}
        </h3>
        <p className="text-sm text-base-content/80">
          {file.writable
            ? (
              <>
                Saving replaces <code>storage.rules</code> in{" "}
                <code className="break-all">{fileName}</code>{" "}
                and applies the rules immediately. Comments and all other
                settings in the file are kept.
              </>
            )
            : !file.path
            ? (
              <>
                The server was not started with a config file path. Save this
                file as the server's config and restart it.
              </>
            )
            : (
              <>
                The server cannot write{" "}
                <code className="break-all">{fileName}</code>{" "}
                (for example a Nix store path or a read-only Docker mount).
                Replace the file with this version, then restart the server. If
                the server reads the edited file directly, use{" "}
                <em>Apply rules from config.yml</em> instead of restarting.
              </>
            )}
        </p>
        <div role="tablist" className="tabs tabs-border">
          {([["full", "Full config.yml"], ["rules", "Rules only"]] as const)
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`tab ${tab === key ? "tab-active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
        </div>
        <ErrorAlert error={renderError} title="Could not render config.yml" />
        {!rendered && !renderError ? <Loading label="Rendering…" /> : (
          <textarea
            className="textarea textarea-bordered h-96 w-full font-mono text-xs"
            readOnly
            spellCheck={false}
            value={text}
            aria-label={tab === "full"
              ? "Rendered config.yml"
              : "Rendered storage rules"}
          />
        )}
        <p className="text-xs text-base-content/60">
          This is the file as stored on disk. <code>${"{VAR}"}</code>{" "}
          placeholders are not expanded, but secrets written in plain text are
          included.
        </p>
        <ErrorAlert error={save.error} title="Rules were not saved" />
        <div className="modal-action mt-0 flex-wrap">
          <button type="button" className="btn btn-ghost" onClick={close}>
            {file.writable ? "Cancel" : "Close"}
          </button>
          <CopyButton value={text} label="Copy" />
          <button
            type="button"
            className="btn"
            disabled={!rendered}
            onClick={download}
          >
            Download
          </button>
          {file.writable && tab === "full" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!rendered || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Write &amp; apply
            </button>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="Close">close</button>
      </form>
    </dialog>
  );
}

function RulesEditor({ view }: { view: RulesView }) {
  const queryClient = useQueryClient();
  const notify = useToast();
  const [draft, setDraft] = useState<DraftRule[]>(() =>
    view.rules.map(toDraft)
  );
  // The config.yml contents this edit is based on; a mismatch on save is a 409.
  const [baseHash, setBaseHash] = useState(view.configFile.hash);
  const saved = useMemo(() => normalizeForCompare(view.rules), [view.rules]);
  const draftRules = useMemo(() => draft.map(fromDraft), [draft]);
  const dirty = normalizeForCompare(draftRules) !== saved;
  const hasInvalidPubkeys = draft.some((rule) =>
    parsePubkeys(rule.pubkeys).invalid.length > 0 ||
    parseDomains(rule.nip05Domains).invalid.length > 0
  );
  const file = view.configFile;
  const dialog = useRef<HTMLDialogElement>(null);

  const discard = () => setDraft(view.rules.map(toDraft));

  const onApplied = (next: RulesView) => {
    queryClient.setQueryData(adminQueryKeys.rules, next);
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.prune });
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.blobs });
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.configuration });
  };
  const render = useMutation({
    mutationFn: () => adminApi.renderRules({ rules: draftRules }),
  });
  const save = useMutation({
    mutationFn: () => {
      if (!baseHash) throw new Error("config.yml is not available");
      return adminApi.saveRules({ hash: baseHash, rules: draftRules });
    },
    onSuccess: (next) => {
      dialog.current?.close();
      onApplied(next);
      notify(
        `Storage rules written to ${
          next.configFile.path ?? "config.yml"
        } and applied`,
      );
    },
  });
  const reload = useMutation({
    mutationFn: adminApi.reloadRules,
    onSuccess: (next) => {
      onApplied(next);
      notify(
        `Applied ${next.rules.length} storage rule(s) from ${
          next.configFile.path ?? "config.yml"
        }`,
      );
    },
  });
  const conflict = save.error instanceof AdminApiError &&
      save.error.status === 409
    ? save.error.message
    : null;
  const openDialog = () => {
    save.reset();
    render.mutate();
    dialog.current?.showModal();
  };

  const validationError = render.error ?? save.error;
  const issuesFor = (index: number) =>
    validationError instanceof AdminApiError
      ? validationError.issues.filter((issue) =>
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
  const fileName = file.path ?? "config.yml";

  return (
    <>
      <PageToolbar
        actions={
          <>
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
              disabled={hasInvalidPubkeys || (file.writable && !dirty)}
              onClick={openDialog}
            >
              {file.writable ? "Save to config.yml…" : "Export config.yml…"}
            </button>
          </>
        }
      >
        Rules are evaluated top to bottom; the first match admits an upload and
        decides how long it is kept.
      </PageToolbar>
      <div role="note" className="alert alert-soft mb-4 text-sm">
        {file.writable
          ? (
            <span>
              Rules are stored in{" "}
              <code className="break-all">{fileName}</code>. Saving writes the
              file and applies the rules immediately.
            </span>
          )
          : (
            <span>
              {file.path
                ? (
                  <>
                    <code className="break-all">{fileName}</code>{" "}
                    is read-only for the server.
                  </>
                )
                : "The server has no config file to write."}{" "}
              Edit the rules here, then export the updated config.yml and
              install it yourself.
            </span>
          )}
      </div>
      {file.error && (
        <ErrorAlert
          error={file.error}
          title={`${fileName} on disk is invalid`}
        />
      )}
      {!file.error && !file.inSync && (
        <div role="alert" className="alert alert-warning mb-4">
          <span>
            <code className="break-all">{fileName}</code>{" "}
            has different storage rules than the server is using (edited outside
            the console?).
          </span>
          <ConfirmButton
            className="btn"
            title={`Apply rules from ${fileName}?`}
            description="Replaces the rules in effect with storage.rules from the file. Unsaved edits on this page are discarded. Other settings in the file still need a restart."
            confirmLabel="Apply"
            onConfirm={() =>
              reload.mutateAsync()}
          >
            Apply rules from config.yml
          </ConfirmButton>
        </div>
      )}
      {conflict && (
        <div role="alert" className="alert alert-warning mb-4">
          <span>
            {conflict}. Your edits were not saved.
          </span>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await queryClient.invalidateQueries({
                queryKey: adminQueryKeys.rules,
              });
              const latest = queryClient.getQueryData<RulesView>(
                adminQueryKeys.rules,
              );
              setBaseHash(latest?.configFile.hash ?? null);
              save.reset();
            }}
          >
            Keep my edits and retry
          </button>
        </div>
      )}
      <ErrorAlert error={reload.error} title="Rules were not reloaded" />
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
          a pubkey list or NIP-05 domains can admit uploads.
        </div>
      )}
      <ConfigDialog
        dialog={dialog}
        file={file}
        rendered={render.data}
        renderError={render.error}
        save={save}
      />
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
                issues={issuesFor(index)}
                update={(patch) => update(index, patch)}
                move={(delta) => move(index, delta)}
                remove={() =>
                  setDraft((rules) => rules.filter((_, i) => i !== index))}
              />
            ))}
          </ol>
        )}
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
    </>
  );
}

export function RulesPage() {
  const { data, error, isPending } = useQuery(adminQueries.rules());
  if (isPending) return <Loading />;
  if (!data) return <ErrorAlert error={error} />;
  // Re-mount the editor when the rules in effect change (save, reload, another session).
  return <RulesEditor key={data.version} view={data} />;
}
