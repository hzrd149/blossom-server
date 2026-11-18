import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { BlobDetail } from "../../contracts/blobs.ts";
import { adminApi, AdminApiError } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorAlert,
  HashLink,
  Loading,
  PageHeader,
} from "../components/ui.tsx";
import { UserBadge } from "../components/user.tsx";
import {
  formatBytes,
  formatDate,
  formatRelative,
  mediaKind,
  shortHash,
} from "../lib/format.ts";
import { Link, navigate } from "../router.tsx";

function Section(
  { title, children, actions }: {
    title: string;
    children: ReactNode;
    actions?: ReactNode;
  },
) {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="card-title text-base">{title}</h2>
          {actions}
        </div>
        {children}
      </div>
    </section>
  );
}

function MediaPreview({ blob }: { blob: BlobDetail }) {
  // Reported media stays blurred until an admin deliberately reveals it.
  const [revealed, setRevealed] = useState(blob.reports.length === 0);
  const kind = mediaKind(blob.type);
  if (!kind) {
    return (
      <div className="flex h-48 items-center justify-center rounded-box bg-base-200 text-base-content/60">
        No inline preview for {blob.type ?? "unknown type"}
      </div>
    );
  }
  const media = kind === "image"
    ? (
      <img
        src={blob.path}
        alt=""
        className="max-h-[28rem] w-full rounded-box object-contain bg-base-200"
      />
    )
    : kind === "video"
    ? (
      <video
        src={blob.path}
        controls={revealed}
        preload="metadata"
        className="max-h-[28rem] w-full rounded-box bg-base-200"
      />
    )
    : <audio src={blob.path} controls className="w-full" />;
  return (
    <div className="relative overflow-hidden rounded-box">
      <div className={revealed ? undefined : "pointer-events-none blur-2xl"}>
        {media}
      </div>
      {!revealed && (
        <button
          type="button"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-base-300/40 text-sm font-medium"
          onClick={() => setRevealed(true)}
        >
          <span className="badge badge-warning">Reported content</span>
          Click to reveal
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-base-content/60">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </>
  );
}

function Retention({ blob }: { blob: BlobDetail }) {
  const { retention } = blob;
  if (blob.thumbnailOf) {
    return (
      <p className="text-sm">
        Generated thumbnail — removed together with its parent blob.
      </p>
    );
  }
  if (!retention.rule) {
    return (
      <p className="text-sm">
        No storage rule governs this blob, so it is never pruned by rule.
      </p>
    );
  }
  const expired = retention.expiresAt !== null &&
    retention.expiresAt * 1000 < Date.now();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <Field label="Rule">
        <Link to="/rules" className="link">
          #{(retention.ruleIndex ?? 0) + 1}
        </Link>{" "}
        <code>{retention.rule.type}</code> kept {retention.rule.expiration}{" "}
        after {retention.basis === "accessed" ? "last access" : "upload"}
      </Field>
      <Field label="Expires">
        <span
          title={formatDate(retention.expiresAt)}
          className={expired ? "text-warning" : undefined}
        >
          {expired
            ? `eligible since ${formatRelative(retention.expiresAt)}`
            : formatRelative(retention.expiresAt)}
        </span>
      </Field>
    </dl>
  );
}

export function BlobPage({ sha256 }: { sha256: string }) {
  const hash = sha256.toLowerCase();
  const queryClient = useQueryClient();
  const { data: blob, error, isPending } = useQuery({
    ...adminQueries.blob(hash),
    enabled: /^[0-9a-f]{64}$/.test(hash),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: adminQueryKeys.all });
  const reportAction = useMutation({
    mutationFn: (
      { id, action }: { id: number; action: "dismiss" | "delete-blob" },
    ) => adminApi.reportAction(id, action),
    onSettled: invalidate,
  });

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return <ErrorAlert error={new Error("Not a valid SHA-256 hash")} />;
  }
  if (isPending) return <Loading />;
  if (error instanceof AdminApiError && error.status === 404) {
    return (
      <>
        <PageHeader
          title="Blob not found"
          subtitle={<span className="font-mono">{hash}</span>}
        />
        <EmptyState>
          This hash is not stored on the server.{" "}
          <Link to={`/users/${hash}`} className="link">
            Look it up as a user instead
          </Link>.
        </EmptyState>
      </>
    );
  }
  if (!blob) return <ErrorAlert error={error} />;

  return (
    <>
      <PageHeader
        title={
          <span className="font-mono text-xl">
            {shortHash(blob.sha256, 16)}
          </span>
        }
        subtitle={
          <>
            {blob.type ?? "unknown type"} · {formatBytes(blob.size)} · uploaded
            {" "}
            {formatRelative(blob.uploaded)}
          </>
        }
        actions={
          <>
            <a
              href={blob.path}
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              Open
            </a>
            <CopyButton value={blob.sha256} label="Copy hash" />
            <ConfirmButton
              title="Delete this blob?"
              description={`The blob is removed for all ${blob.owners.length} owner(s) and deleted from storage. This cannot be undone.`}
              confirmLabel="Delete blob"
              confirmText="delete"
              onConfirm={async () => {
                await adminApi.deleteBlob(blob.sha256);
                await invalidate();
                navigate("/content");
              }}
            >
              Delete
            </ConfirmButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <MediaPreview blob={blob} />
          <Section title={`Reports (${blob.reports.length})`}>
            <ErrorAlert error={reportAction.error} />
            {blob.reports.length === 0
              ? <p className="text-sm text-base-content/60">No reports.</p>
              : (
                <ul className="divide-y divide-base-300">
                  {blob.reports.map((report) => (
                    <li
                      key={report.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2"
                    >
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-warning badge-sm">
                            {report.type ?? "unspecified"}
                          </span>
                          <Link
                            to={`/users/${report.reporter}`}
                            className="link link-hover"
                          >
                            <UserBadge pubkey={report.reporter} />
                          </Link>
                          <span
                            className="text-base-content/60"
                            title={formatDate(report.created)}
                          >
                            {formatRelative(report.created)}
                          </span>
                        </div>
                        {report.content && (
                          <p className="mt-1 whitespace-pre-wrap break-words">
                            {report.content}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={reportAction.isPending}
                        onClick={() =>
                          reportAction.mutate({
                            id: report.id,
                            action: "dismiss",
                          })}
                      >
                        Dismiss
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          <Section title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <Field label="SHA-256">
                <span className="font-mono text-xs">{blob.sha256}</span>
              </Field>
              <Field label="Type">{blob.type ?? "—"}</Field>
              <Field label="Size">
                {formatBytes(blob.size)} ({blob.size.toLocaleString()} bytes)
              </Field>
              <Field label="Uploaded">{formatDate(blob.uploaded)}</Field>
              <Field label="Last access">
                {blob.accessed
                  ? `${formatRelative(blob.accessed)} (${
                    formatDate(blob.accessed)
                  })`
                  : "never"}
              </Field>
              {blob.thumbnail && (
                <Field label="Thumbnail">
                  <HashLink hash={blob.thumbnail} />
                </Field>
              )}
              {blob.thumbnailOf && (
                <Field label="Thumbnail of">
                  <HashLink hash={blob.thumbnailOf} />
                </Field>
              )}
              {blob.derivedFrom.length > 0 && (
                <Field label="Optimized from">
                  <span className="flex flex-col">
                    {blob.derivedFrom.map((h) => (
                      <span key={h} className="font-mono text-xs" title={h}>
                        {shortHash(h)}
                      </span>
                    ))}
                  </span>
                </Field>
              )}
            </dl>
            {blob.nip94 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-base-content/60">
                  NIP-94 tags
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-base-200 p-2 text-xs">{JSON.stringify(blob.nip94, null, 2)}</pre>
              </details>
            )}
          </Section>
          <Section title="Retention">
            <Retention blob={blob} />
          </Section>
          <Section title={`Owners (${blob.owners.length})`}>
            {blob.owners.length === 0
              ? (
                <p className="text-sm text-base-content/60">
                  No owners — eligible for ownerless cleanup.
                </p>
              )
              : (
                <ul className="flex flex-col gap-2">
                  {blob.owners.map((owner) => (
                    <li
                      key={owner.pubkey}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <Link
                        to={`/users/${owner.pubkey}`}
                        className="min-w-0 hover:underline"
                      >
                        <UserBadge pubkey={owner.pubkey} />
                      </Link>
                      <span
                        className="shrink-0 text-base-content/60"
                        title={formatDate(owner.uploaded)}
                      >
                        {formatRelative(owner.uploaded)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Section>
        </div>
      </div>
    </>
  );
}
