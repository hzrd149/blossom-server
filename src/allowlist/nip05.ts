/**
 * NIP-05 domain allowlists for storage rules.
 *
 * A storage rule may name `nip05Domains`. Every pubkey published in
 * `https://<domain>/.well-known/nostr.json` is unioned into that rule's
 * `pubkeys` allowlist, so "anyone with a handle on our domain may upload"
 * works without editing the rule per new member.
 *
 * Semantics:
 *   - The allowlist never edits rules. It keeps a per-domain member cache and
 *     hands it to its source (the RuleStore), which merges members into the
 *     active rules it serves (see applyNip05Members). Static `pubkeys` are kept
 *     as configured and fetched pubkeys are never persisted.
 *   - The domains to fetch are read from the source on every refresh, so rules
 *     edited at runtime (database-managed rules) are picked up.
 *   - Each distinct domain is fetched once per refresh, even when several
 *     rules share it.
 *   - The per-domain cache is only replaced after a successful fetch. A failed
 *     fetch keeps the previous set (stale-on-error). A domain that has never
 *     succeeded contributes nothing (fail closed).
 *
 * Pure with respect to time and network: `fetchImpl` and the timer functions
 * are injectable for tests.
 */

import { HEX_PUBKEY_RE, type StorageRule } from "../policy/rule-schema.ts";
import { normalizeNip05Domain, nostrJsonUrl } from "./nip05-domain.ts";

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

export type Nip05Members = ReadonlyMap<string, ReadonlySet<string>>;

/** Where the allowlist reads its domains from and delivers fetched members to (the RuleStore). */
export interface Nip05Source {
  /** Distinct, normalized domains referenced by the active rules. */
  nip05Domains(): string[];
  setNip05Members(members: Nip05Members): void;
}

export interface Nip05Allowlist {
  /** Distinct, normalized domains the source currently references. */
  readonly domains: string[];
  /** Fetch every referenced domain once and deliver the updated members to the source. */
  refresh(): Promise<{ domains: Nip05DomainResult[] }>;
  /** Fetch only referenced domains that have no cached result yet (e.g. just added at runtime). */
  refreshMissing(): Promise<{ domains: Nip05DomainResult[] }>;
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
 * Return `rules` with every member of each rule's `nip05Domains` unioned into
 * its `pubkeys`. Rules without domains are returned as-is; the input is not modified.
 */
export function applyNip05Members(rules: readonly StorageRule[], members: Nip05Members): StorageRule[] {
  return rules.map((rule) => {
    if (!rule.nip05Domains?.length) return rule;
    const merged = new Set(rule.pubkeys);
    for (const domain of rule.nip05Domains) {
      for (const pubkey of members.get(domain) ?? []) merged.add(pubkey);
    }
    return { ...rule, pubkeys: [...merged] };
  });
}

/** Distinct domains across `rules`, in first-seen order. */
export function nip05DomainsOf(rules: readonly StorageRule[]): string[] {
  return [...new Set(rules.flatMap((rule) => rule.nip05Domains ?? []))];
}

/** Create an allowlist that fetches the domains `source` references and delivers members back to it. */
export function createNip05Allowlist(source: Nip05Source, options: Nip05FetchOptions): Nip05Allowlist {
  const cache = new Map<string, Set<string>>();
  // Domains attempted at least once (success or failure), so refreshMissing does not hammer a failing domain.
  const attempted = new Set<string>();

  const fetchDomains = async (domains: string[]) => {
    const results = await Promise.all(
      domains.map(async (domain): Promise<Nip05DomainResult> => {
        attempted.add(domain);
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
    source.setNip05Members(new Map(cache));
    return { domains: results };
  };

  /** Current domains, after forgetting those no rule references any more (so a re-added domain is fetched afresh). */
  const referencedDomains = () => {
    const domains = source.nip05Domains();
    for (const domain of [...attempted]) {
      if (!domains.includes(domain)) {
        attempted.delete(domain);
        cache.delete(domain);
      }
    }
    return domains;
  };

  return {
    get domains() {
      return source.nip05Domains();
    },
    refresh() {
      return fetchDomains(referencedDomains());
    },
    refreshMissing() {
      return fetchDomains(referencedDomains().filter((domain) => !attempted.has(domain)));
    },
  };
}

/** Log fetch errors always and successful fetches only when the member set changed. */
export function logNip05Results(results: Nip05DomainResult[], log: Pick<Console, "log" | "warn"> = console): void {
  for (const result of results) {
    if (result.error) {
      log.warn(`[nip05] ${result.domain}: fetch failed (${result.error}), keeping ${result.count} cached`);
    } else if (result.changed) {
      log.log(`[nip05] ${result.domain}: ${result.count} pubkeys`);
    }
  }
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
  allowlist: Pick<Nip05Allowlist, "refresh">,
  intervalMs: number,
  { initialDelayMs = intervalMs, log = console, timers = DEFAULT_TIMERS }: Nip05RefreshOptions = {},
): () => void {
  let stopped = false;
  let timer: unknown;

  const run = async () => {
    if (stopped) return;
    try {
      logNip05Results((await allowlist.refresh()).domains, log);
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
