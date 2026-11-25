import { useMutation, useQueryClient } from "@tanstack/react-query";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import {
  BAN_CATEGORIES,
  type BanBlobResultDto,
  type BanCategory,
  type BlobModerationStatus,
  isBanCategory,
  parseBlobRef,
} from "../../contracts/moderation.ts";
import { adminApi } from "../api/client.ts";
import { adminQueryKeys } from "../api/queries.ts";
import { ErrorAlert } from "./ui.tsx";
import { useToast } from "./toasts.tsx";
import { safeNpub } from "./user.tsx";

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Parse an npub, nprofile, or hex pubkey; null when invalid. */
export function parsePubkeyInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const pubkey = normalizeToPubkey(trimmed);
    return pubkey && /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : null;
  } catch {
    return null;
  }
}

/** Default ban category for a report type: the type when it is a category, else "other". */
export function categoryForReport(
  type: string | null | undefined,
): BanCategory {
  return isBanCategory(type) ? type : "other";
}

export function CategorySelect(
  { value, onChange, allowNone, id, className = "select w-full", label }: {
    value: string;
    onChange: (value: string) => void;
    allowNone?: string;
    id?: string;
    className?: string;
    /** aria-label, for selects without a visible label. */
    label?: string;
  },
) {
  return (
    <select
      id={id}
      aria-label={label}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowNone !== undefined && <option value="">{allowNone}</option>}
      {BAN_CATEGORIES.map((category) => (
        <option key={category} value={category}>{category}</option>
      ))}
    </select>
  );
}

/** Button that opens a modal form. `children` receives a close() callback. */
function DialogButton(
  { label, className, disabled, title, children }: {
    label: ReactNode;
    className: string;
    disabled?: boolean;
    title: string;
    children: (close: () => void) => ReactNode;
  },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {label}
      </button>
      <dialog ref={dialog} className="modal" onClose={() => setOpen(false)}>
        <div className="modal-box">
          <h3 className="text-lg font-semibold">{title}</h3>
          {open && children(close)}
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">close</button>
        </form>
      </dialog>
    </>
  );
}

function Field(
  { label, hint, children }: {
    label: string;
    hint?: ReactNode;
    children: ReactNode;
  },
) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-base-content/70">{label}</span>
      {children}
      {hint && <span className="text-xs text-base-content/60">{hint}</span>}
    </label>
  );
}

function BanUserForm(
  { pubkey: fixed, close, onBanned }: {
    pubkey?: string;
    close: () => void;
    onBanned?: () => void;
  },
) {
  const notify = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState(fixed ? safeNpub(fixed) ?? fixed : "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [content, setContent] = useState<"keep" | "remove">("keep");
  const pubkey = parsePubkeyInput(input);
  const ban = useMutation({
    mutationFn: () =>
      adminApi.banPubkey({
        pubkey: pubkey!,
        reason: reason ? reason as BanCategory : null,
        note,
        content,
      }),
    onSuccess: (result) => {
      notify(
        content === "remove"
          ? `User banned. Ownership removed from ${
            plural(result.removedOwnership, "blob")
          }; ${plural(result.deleted.length, "orphaned blob")} deleted.`
          : "User banned. Existing content was kept.",
      );
      onBanned?.();
      close();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pubkey) ban.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <Field
        label="Pubkey"
        hint={input && !pubkey
          ? "Enter an npub or 64-character hex key."
          : undefined}
      >
        <input
          className={`input w-full font-mono ${
            input && !pubkey ? "input-error" : ""
          }`}
          value={input}
          readOnly={!!fixed}
          placeholder="npub1… or hex"
          onChange={(e) => setInput(e.target.value)}
          autoFocus={!fixed}
        />
      </Field>
      <Field label="Reason (optional)">
        <CategorySelect
          value={reason}
          onChange={setReason}
          allowNone="No reason"
        />
      </Field>
      <Field label="Note (admins only, never shared)">
        <input
          className="input w-full"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 text-base-content/70">Existing content</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            className="radio mt-0.5"
            name="ban-content"
            checked={content === "keep"}
            onChange={() => setContent("keep")}
          />
          <span>
            <strong>Keep</strong>{" "}
            — existing blobs stay available. The user can no longer upload,
            mirror, or report.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            className="radio mt-0.5"
            name="ban-content"
            checked={content === "remove"}
            onChange={() => setContent("remove")}
          />
          <span>
            <strong>Remove</strong>{" "}
            — removes this user's ownership from every blob. Only blobs left
            with no other owner are deleted; blobs shared with other users stay
            available for them. Removed content is not restored by unbanning.
          </span>
        </label>
      </fieldset>
      <ErrorAlert error={ban.error} title="User was not banned" />
      <div className="modal-action mt-0">
        <button type="button" className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-error"
          disabled={!pubkey || ban.isPending}
        >
          {ban.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Ban user
        </button>
      </div>
    </form>
  );
}

export function BanUserButton(
  {
    pubkey,
    className = "btn btn-error btn-outline",
    label = "Ban user",
    onBanned,
  }: {
    pubkey?: string;
    className?: string;
    label?: ReactNode;
    onBanned?: () => void;
  },
) {
  return (
    <DialogButton label={label} className={className} title="Ban user">
      {(close) => (
        <BanUserForm pubkey={pubkey} close={close} onBanned={onBanned} />
      )}
    </DialogButton>
  );
}

export function banBlobMessage(result: BanBlobResultDto): string {
  const related = result.banned.length - 1;
  return `Blob banned${
    related > 0 ? ` with ${plural(related, "related blob")}` : ""
  }. ${
    plural(result.deleted.length, "stored blob")
  } deleted. Reports retained.`;
}

function BanBlobForm(
  { sha256: fixed, defaultCategory, close, onBanned, submit: customSubmit }: {
    sha256?: string;
    defaultCategory?: BanCategory;
    close: () => void;
    onBanned?: () => void;
    submit?: (
      input: { category: BanCategory; note: string },
    ) => Promise<string>;
  },
) {
  const notify = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState(fixed ?? "");
  const [category, setCategory] = useState<string>(defaultCategory ?? "other");
  const [note, setNote] = useState("");
  const sha256 = fixed ?? parseBlobRef(input);
  const ban = useMutation({
    mutationFn: async () => {
      if (customSubmit) {
        return await customSubmit({
          category: category as BanCategory,
          note,
        });
      }
      return banBlobMessage(
        await adminApi.banBlob({
          sha256: sha256!,
          category: category as BanCategory,
          note,
        }),
      );
    },
    onSuccess: (message) => {
      notify(message);
      onBanned?.();
      close();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sha256 || customSubmit) ban.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      {!customSubmit && (
        <Field
          label="Blob"
          hint={input && !sha256
            ? "Enter a SHA-256 or a blob URL."
            : sha256 && sha256 !== input.trim().toLowerCase()
            ? <span className="font-mono break-all">{sha256}</span>
            : undefined}
        >
          <input
            className={`input w-full font-mono ${
              input && !sha256 ? "input-error" : ""
            }`}
            value={input}
            readOnly={!!fixed}
            placeholder="SHA-256 or https://…/<sha256>.png"
            onChange={(e) => setInput(e.target.value)}
            autoFocus={!fixed}
          />
        </Field>
      )}
      <Field
        label="Category"
        hint="Published with the ban when publishing is enabled."
      >
        <CategorySelect value={category} onChange={setCategory} />
      </Field>
      <Field label="Note (admins only, never published)">
        <input
          className="input w-full"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <p className="text-sm text-base-content/80">
        The blob is deleted for all owners, together with its optimized
        derivative, original, and thumbnails, which are banned too. Reports are
        retained. The hash can no longer be uploaded or mirrored. Unbanning does
        not restore deleted files.
      </p>
      <ErrorAlert error={ban.error} title="Blob was not banned" />
      <div className="modal-action mt-0">
        <button type="button" className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-error"
          disabled={(!sha256 && !customSubmit) || ban.isPending}
        >
          {ban.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Ban blob
        </button>
      </div>
    </form>
  );
}

/**
 * Ban a blob. Without `sha256` the form asks for a hash or blob URL. With `submit`, the form
 * collects only category and note and delegates (e.g. to report ban actions); it returns the toast text.
 */
export function BanBlobButton(
  {
    sha256,
    defaultCategory,
    className = "btn btn-error btn-outline",
    label = "Ban blob",
    title = "Ban blob",
    disabled,
    onBanned,
    submit,
  }: {
    sha256?: string;
    defaultCategory?: BanCategory;
    className?: string;
    label?: ReactNode;
    title?: string;
    disabled?: boolean;
    onBanned?: () => void;
    submit?: (
      input: { category: BanCategory; note: string },
    ) => Promise<string>;
  },
) {
  return (
    <DialogButton
      label={label}
      className={className}
      title={title}
      disabled={disabled}
    >
      {(close) => (
        <BanBlobForm
          sha256={sha256}
          defaultCategory={defaultCategory}
          close={close}
          onBanned={onBanned}
          submit={submit}
        />
      )}
    </DialogButton>
  );
}

/** Badge for a blob's local ban. */
export function ModerationBadges({ status }: { status: BlobModerationStatus }) {
  return status.ban
    ? <span className="badge badge-error">Banned: {status.ban.category}</span>
    : null;
}
