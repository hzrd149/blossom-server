/**
 * NIP-05 domain allowlists for storage rules.
 *
 * A storage rule may name `nip05Domains`. Every pubkey published in
 * `https://<domain>/.well-known/nostr.json` is unioned into that rule's
 * `pubkeys` allowlist, so "anyone with a handle on our domain may upload"
 * works without restarting the server per new member.
 *
 * Semantics:
 *   - Each rule's ORIGINAL static `pubkeys` are captured once at creation and
 *     always kept; fetched pubkeys are added on top.
 *   - Each distinct domain is fetched once per refresh, even when several
 *     rules share it.
 *   - The per-domain cache is only replaced after a successful fetch. A failed
 *     fetch keeps the previous set (stale-on-error). A domain that has never
 *     succeeded contributes nothing (fail closed).
 *   - `rule.pubkeys` is rewritten in place (a new array on the same rule
 *     object) so every consumer holding the config — upload, mirror, media,
 *     prune — sees the current allowlist without re-plumbing.
 *
 * Pure with respect to time and network: `fetchImpl` and the timer functions
 * are injectable for tests.
 */

import type { StorageRule } from "../config/schema.ts";
import { normalizeNip05Domain, nostrJsonUrl } from "./nip05-domain.ts";

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

export interface Nip05FetchOptions {
  /** Fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many milliseconds. */
  timeoutMs: number;
}

export interface Nip05DomainResult {
  domain: string;
  /** Number of pubkeys now cached for this domain (the previous count on error). */
  count: number;
  /** Set when the fetch failed; the cached set (if any) was kept. */
  error?: string;
  /** True when a successful fetch produced a different set than the cached one. */
  changed: boolean;
}

export interface Nip05Allowlist {
  /** Distinct, normalized domains across all rules. */
  readonly domains: string[];
  /** Fetch every domain once, then rewrite the pubkeys of every rule that has nip05Domains. */
  refresh(): Promise<{ domains: Nip05DomainResult[] }>;
}

/**
 * Fetch `https://<domain>/.well-known/nostr.json` and return the set of valid
 * pubkeys from its `names` map.
 *
 * Throws on a redirect (NIP-05 says fetchers MUST ignore redirects), a non-2xx
 * response, a non-JSON body, or a body that is not an object. Values that are
 * not 64 hex characters are skipped; uppercase hex is lowercased. A missing or
 * malformed `names` map yields an empty set.
 */
export async function fetchNip05Pubkeys(
  domain: string,
  { fetchImpl = fetch, timeoutMs }: Nip05FetchOptions,
): Promise<Set<string>> {
  const url = nostrJsonUrl(normalizeNip05Domain(domain));
  const res = await fetchImpl(url.toString(), {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Response is not valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Response is not a JSON object");
  }

  const names = (body as { names?: unknown }).names;
  const pubkeys = new Set<string>();
  if (names === null || typeof names !== "object" || Array.isArray(names)) return pubkeys;

  for (const value of Object.values(names as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const pubkey = value.toLowerCase();
    if (HEX_PUBKEY_RE.test(pubkey)) pubkeys.add(pubkey);
  }
  return pubkeys;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Create an allowlist manager for every rule in `rules` that has `nip05Domains`.
 * Rules without `nip05Domains` are never touched.
 */
export function createNip05Allowlist(
  rules: StorageRule[],
  options: Nip05FetchOptions,
): Nip05Allowlist {
  const entries = rules
    .filter((rule) => rule.nip05Domains !== undefined && rule.nip05Domains.length > 0)
    .map((rule) => ({
      rule,
      staticPubkeys: [...(rule.pubkeys ?? [])],
      domains: [...new Set(rule.nip05Domains!.map(normalizeNip05Domain))],
    }));
  const domains = [...new Set(entries.flatMap((entry) => entry.domains))];
  const cache = new Map<string, Set<string>>();

  const apply = () => {
    for (const entry of entries) {
      const merged = new Set(entry.staticPubkeys);
      for (const domain of entry.domains) {
        for (const pubkey of cache.get(domain) ?? []) merged.add(pubkey);
      }
      entry.rule.pubkeys = [...merged];
    }
  };

  const refresh = async () => {
    const results = await Promise.all(
      domains.map(async (domain): Promise<Nip05DomainResult> => {
        try {
          const fetched = await fetchNip05Pubkeys(domain, options);
          const previous = cache.get(domain);
          const changed = previous === undefined || !setsEqual(previous, fetched);
          cache.set(domain, fetched);
          return { domain, count: fetched.size, changed };
        } catch (err) {
          const error = err instanceof Error ? err.message || err.name : String(err);
          return { domain, count: cache.get(domain)?.size ?? 0, error, changed: false };
        }
      }),
    );
    apply();
    return { domains: results };
  };

  return { domains, refresh };
}

export interface Nip05RefreshTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const DEFAULT_TIMERS: Nip05RefreshTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface Nip05RefreshOptions {
  /** Delay before the first refresh of the loop. Defaults to intervalMs; shorten it to retry a failed startup fetch sooner. */
  initialDelayMs?: number;
  log?: Pick<Console, "log" | "warn">;
  timers?: Nip05RefreshTimers;
}

/**
 * Refresh `allowlist` every `intervalMs` using a recursive setTimeout (the next
 * run is scheduled only after the current one completes, like the prune loop).
 * Logs only on changes or errors. Returns a function that cancels the loop.
 */
export function startNip05Refresh(
  allowlist: Nip05Allowlist,
  intervalMs: number,
  { initialDelayMs = intervalMs, log = console, timers = DEFAULT_TIMERS }: Nip05RefreshOptions = {},
): () => void {
  let stopped = false;
  let timer: unknown;

  const run = async () => {
    if (stopped) return;
    try {
      const { domains } = await allowlist.refresh();
      for (const result of domains) {
        if (result.error) {
          log.warn(`[nip05] ${result.domain}: fetch failed (${result.error}), keeping ${result.count} cached`);
        } else if (result.changed) {
          log.log(`[nip05] ${result.domain}: ${result.count} pubkeys`);
        }
      }
    } catch (err) {
      log.warn(`[nip05] Unexpected error in refresh loop: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stopped) timer = timers.setTimeout(run, intervalMs);
  };

  timer = timers.setTimeout(run, initialDelayMs);
  return () => {
    stopped = true;
    if (timer !== undefined) timers.clearTimeout(timer);
  };
}
