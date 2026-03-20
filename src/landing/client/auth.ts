// ---------------------------------------------------------------------------
// Nostr signing helpers — BUD-11 kind 24242 auth event construction.
// ---------------------------------------------------------------------------

import type { FileStatus, UploadFile } from "./types.ts";
import { sha256Hex } from "./helpers.ts";

export const MAX_X_TAGS_PER_EVENT = 60;

/**
 * Hash all files in the batch sequentially, reporting status as each starts.
 * Returns a map of upload-file id → hex sha256.
 */
export async function hashBatch(
  files: UploadFile[],
  onFileStatus: (id: string, status: FileStatus) => void,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const uf of files) {
    onFileStatus(uf.id, "hashing");
    const hash = await sha256Hex(uf.file);
    results.set(uf.id, hash);
  }
  return results;
}

/** Build a BUD-11 kind 24242 auth event covering a batch of hashes. */
export async function signBatch(
  // deno-lint-ignore no-explicit-any
  nostr: any,
  hashes: string[],
  authVerb: string,
  content: string,
): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const authEvent = await nostr.signEvent({
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
