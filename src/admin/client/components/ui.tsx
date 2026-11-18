import { type ReactNode, useEffect, useRef, useState } from "react";
import { AdminApiError } from "../api/client.ts";
import { formatNumber, shortHash } from "../lib/format.ts";
import { Link } from "../router.tsx";

export function PageHeader(
  { title, subtitle, actions }: {
    title: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
  },
) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{title}</h1>
        {subtitle && <p className="text-base-content/60 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 py-10 justify-center text-base-content/60"
      role="status"
    >
      <span className="loading loading-spinner loading-md" />
      {label}
    </div>
  );
}

export function ErrorAlert(
  { error, title = "Request failed" }: { error: unknown; title?: string },
) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const issues = error instanceof AdminApiError ? error.issues : [];
  return (
    <div role="alert" className="alert alert-error alert-soft my-3">
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm">{message}</div>
        {issues.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {issues.map((issue) => (
              <li key={issue.path + issue.message}>
                {issue.path ? `${issue.path}: ` : ""}
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-base-content/50 py-10 text-center">{children}</div>
  );
}

export function StatTile(
  { label, value, hint, to }: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    to?: string;
  },
) {
  const body = (
    <div className="stat">
      <div className="stat-title">{label}</div>
      <div className="stat-value text-2xl tabular-nums">{value}</div>
      {hint && <div className="stat-desc">{hint}</div>}
    </div>
  );
  return (
    <div className="stats border border-base-300 bg-base-100 shadow-sm">
      {to
        ? (
          <Link to={to} className="hover:bg-base-200 transition-colors">
            {body}
          </Link>
        )
        : body}
    </div>
  );
}

export function CopyButton(
  { value, label = "Copy" }: { value: string; label?: string },
) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title={`Copy ${value}`}
      onClick={() =>
        navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(
          () => {},
        )}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function HashLink({ hash, length }: { hash: string; length?: number }) {
  return (
    <Link
      to={`/blobs/${hash}`}
      className="link link-hover font-mono text-sm"
      title={hash}
    >
      {shortHash(hash, length)}
    </Link>
  );
}

export function Paginator(
  { page, pageSize, total, onPage }: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (page: number) => void;
  },
) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <span className="text-base-content/60">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </span>
      <div className="join">
        <button
          type="button"
          className="btn join-item"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="btn join-item pointer-events-none">
          Page {page} / {pages}
        </span>
        <button
          type="button"
          className="btn join-item"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Button that opens a confirmation dialog. With `confirmText`, the admin must type
 * it exactly before the destructive action is enabled.
 */
export function ConfirmButton(
  {
    children,
    title,
    description,
    confirmLabel = "Confirm",
    confirmText,
    onConfirm,
    className = "btn btn-error",
    disabled,
  }: {
    children: ReactNode;
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    confirmText?: string;
    onConfirm: () => Promise<unknown> | void;
    className?: string;
    disabled?: boolean;
  },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = () => {
    dialog.current?.close();
    setTyped("");
    setError(null);
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => dialog.current?.showModal()}
      >
        {children}
      </button>
      <dialog ref={dialog} className="modal" onClose={() => setTyped("")}>
        <div className="modal-box">
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <div className="py-3 text-sm text-base-content/80">
              {description}
            </div>
          )}
          {confirmText && (
            <label className="form-control w-full">
              <span className="label-text text-sm">
                Type <code className="font-mono">{confirmText}</code> to confirm
              </span>
              <input
                className="input input-bordered w-full mt-1"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
              />
            </label>
          )}
          <ErrorAlert error={error} />
          <div className="modal-action">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-error"
              disabled={busy ||
                (confirmText !== undefined && typed !== confirmText)}
              onClick={confirm}
            >
              {busy && <span className="loading loading-spinner loading-xs" />}
              {confirmLabel}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">close</button>
        </form>
      </dialog>
    </>
  );
}
