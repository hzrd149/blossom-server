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
  const [confirmingSignIn, setConfirmingSignIn] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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

  const beginSignIn = useCallback(() => {
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

  const signIn = useCallback(() => {
    if (identity?.kind === "local") {
      setConfirmError(null);
      setConfirmingSignIn(true);
      return;
    }
    beginSignIn();
  }, [beginSignIn, identity]);

  const continueSignIn = useCallback(
    async (backup: boolean) => {
      if (backup && identity?.nsec) {
        try {
          await navigator.clipboard.writeText(identity.nsec);
        } catch {
          setConfirmError("Could not copy the key. Try the copy button first.");
          return;
        }
      }
      setConfirmingSignIn(false);
      beginSignIn();
    },
    [beginSignIn, identity],
  );

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
            class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-800 hover:text-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-600"
            onClick={copyKey}
            aria-label={copied ? "Secret key copied" : "Copy secret key"}
            title={copied ? "Copied" : "Copy secret key"}
          >
            {copied
              ? (
                <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true">
                  <path
                    d="m4 10 4 4 8-9"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                  />
                </svg>
              )
              : (
                <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true">
                  <rect
                    x="7"
                    y="3"
                    width="9"
                    height="11"
                    rx="2"
                    fill="none"
                    stroke="currentColor"
                  />
                  <path
                    d="M5 6H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2"
                    fill="none"
                    stroke="currentColor"
                  />
                </svg>
              )}
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

      {confirmingSignIn && identity?.kind === "local" && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="identity-switch-title"
            class="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-5 text-sm text-gray-300 shadow-2xl"
          >
            <h3
              id="identity-switch-title"
              class="text-base font-semibold text-white"
            >
              Switch to your Nostr account?
            </h3>
            <p class="mt-2 text-gray-400">
              Your previous uploads belong to a temporary anonymous key. If you
              discard it, you will not be able to manage those uploads later.
            </p>
            {confirmError && (
              <p class="mt-3 text-xs text-red-400">{confirmError}</p>
            )}
            <div class="mt-5 flex flex-col gap-2">
              <button
                type="button"
                class="rounded-lg px-3 py-2 text-gray-400 hover:bg-gray-800 hover:text-white"
                onClick={() => setConfirmingSignIn(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="rounded-lg border border-gray-700 px-3 py-2 text-gray-200 hover:bg-gray-800"
                onClick={() => continueSignIn(true)}
              >
                Copy key and continue
              </button>
              <button
                type="button"
                class="rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-500"
                onClick={() => continueSignIn(false)}
                autoFocus
              >
                Continue without backup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
