import type { NostrProvider, Signer } from "./types.ts";
import { createLimiter } from "./scheduler.ts";

export const MAX_X_TAGS_PER_EVENT = 60;

export function getNostrProvider(): NostrProvider | undefined {
  return globalThis.nostr;
}

// Shared across both panels so an extension never receives overlapping prompts.
const signSerially = createLimiter(1);

/** Reuse a batch token, refreshing only when queued work outlives its lifetime. */
export function batchAuthorization(
  signer: Signer,
  hashes: string[],
  verb: string,
  content: string,
): () => Promise<string> {
  let header: string | undefined;
  let refreshAt = 0;
  let signing: Promise<string> | undefined;
  return () => {
    if (header && Date.now() < refreshAt) return Promise.resolve(header);
    if (!signing) {
      signing = signSerially(async () => {
        const started = Date.now();
        header = await signBatch(signer, [...new Set(hashes)], verb, content);
        refreshAt = started + 240_000;
        return header;
      }).finally(() => signing = undefined);
    }
    return signing;
  };
}

/** Build a BUD-11 kind 24242 auth event covering a batch of hashes. */
export async function signBatch(
  signer: Signer,
  hashes: string[],
  authVerb: string,
  content: string,
): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const authEvent = await signer.signEvent({
    kind: 24242,
    content,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["t", authVerb], ...hashes.map((h) => ["x", h]), [
      "expiration",
      String(expiration),
    ]],
  });
  return "Nostr " + btoa(JSON.stringify(authEvent));
}
