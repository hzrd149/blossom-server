import { useCallback, useState } from "@hono/hono/jsx/dom";
import { signInWithProvider, signOut, useIdentity } from "./identity.ts";

function shortNpub(npub: string): string {
  return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}

const SOURCE_LABEL = {
  extension: "via browser extension",
  remote: "via remote signer",
  local: "key stored in this browser",
} as const;

/**
 * Signing in lives here and only here, so that uploading never has to stop and
 * ask. The button covers both a NIP-07 extension and a NIP-46 remote signer —
 * window.nostr.js guarantees only one of the two is ever present, so there is
 * nothing to choose between and no dialog to show.
 *
 * For a generated key this bar is also the only place it can be recovered
 * from; without it those blobs can never be deleted.
 */
export function IdentityBar() {
  const identity = useIdentity();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyKey = useCallback(() => {
    if (!identity?.nsec) return;
    navigator.clipboard
      .writeText(identity.nsec)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [identity]);

  const signIn = useCallback(() => {
    setError(null);
    setBusy(true);
    signInWithProvider()
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setBusy(false));
    // window.nostr.js resolves nothing when its connect dialog is dismissed, so
    // the promise above may never settle. Clear the busy state on a timer too,
    // rather than leaving the button disabled for good.
    setTimeout(() => setBusy(false), 3000);
  }, []);

  const signedInWithProvider = identity?.kind === "extension" ||
    identity?.kind === "remote";

  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 border-b border-gray-800 text-xs text-gray-500">
      {identity
        ? (
          <>
            <span class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            <span class="font-mono text-gray-400" title={identity.npub}>
              {shortNpub(identity.npub)}
            </span>
            <span>{SOURCE_LABEL[identity.kind]}</span>
          </>
        )
        : <span>Uploads are signed for you — no account needed</span>}

      {error && <span class="text-red-400">{error}</span>}

      <div class="ml-auto flex items-center gap-3">
        {identity?.nsec && (
          <button
            type="button"
            class="hover:text-gray-300 underline"
            onClick={copyKey}
          >
            {copied ? "Copied" : "Copy secret key"}
          </button>
        )}
        {!signedInWithProvider && (
          <button
            type="button"
            class="hover:text-gray-300 underline disabled:opacity-50"
            disabled={busy}
            onClick={signIn}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        )}
        {identity && (
          <button
            type="button"
            class="hover:text-gray-300 underline"
            onClick={signOut}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
