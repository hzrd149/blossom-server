/**
 * Nostr profile metadata lookup for the admin dashboard.
 *
 * Exports bare module-level singletons following the standard applesauce
 * pattern. The event loader is wired at module-load time; lookup relays are
 * held in a BehaviorSubject so they can be updated at any point without
 * recreating the loader.
 *
 * This module is only imported when the admin dashboard is enabled.
 */

import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core/event-store";
import type { ProfileContent } from "applesauce-core/helpers";
import { loadAsyncMap } from "applesauce-loaders/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { BehaviorSubject } from "rxjs";

// ── Singletons ────────────────────────────────────────────────────────────────

export const eventStore = new EventStore();

export const pool = new RelayPool({
  keepAlive: 10_000,
  eoseTimeout: 8_000,
});

/** Update this subject at any time to change the relays used for profile lookup. */
export const lookupRelays$ = new BehaviorSubject<string[]>([]);

export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  // Fire immediately — the default 1 s batch window is for reactive UIs
  // batching many simultaneous component requests, not SSR one-shot fetches.
  bufferTime: 100,
});

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch Nostr kind:0 profile metadata for a single pubkey.
 *
 * Checks the in-process EventStore cache first (synchronous, zero latency).
 * Falls back to relay fetch, bounded by `timeout`. Returns null on timeout or
 * any error — the caller always gets a result quickly.
 */
export async function fetchUserProfile(
  pubkey: string,
  timeout = 4_000,
): Promise<ProfileContent | null> {
  try {
    const user = castUser(pubkey, eventStore);
    return await user.profile$.$first(timeout, null);
  } catch {
    return null;
  }
}

/**
 * Fetch Nostr kind:0 profile metadata for multiple pubkeys in parallel.
 *
 * All fetches race concurrently via loadAsyncMap. Each is individually bounded
 * by `timeout` via $first — a slow relay for one pubkey never delays others.
 * Timed-out entries are undefined in the returned Map.
 */
export async function fetchUserProfiles(
  pubkeys: string[],
  timeout = 4_000,
): Promise<Map<string, ProfileContent | undefined>> {
  const result = new Map<string, ProfileContent | undefined>();
  if (pubkeys.length === 0) return result;

  const promiseMap: Record<string, Promise<ProfileContent | null>> = {};
  for (const pubkey of pubkeys) {
    promiseMap[pubkey] = castUser(pubkey, eventStore).profile$.$first(
      timeout,
      null,
    );
  }

  try {
    const resolved = await loadAsyncMap(promiseMap, timeout + 500);
    for (const [pubkey, profile] of Object.entries(resolved)) {
      result.set(pubkey, profile ?? undefined);
    }
  } catch {
    // Partial results are fine — return whatever was collected.
  }

  return result;
}
