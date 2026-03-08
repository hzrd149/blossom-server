import { config } from "./config.js";
import logger from "./logger.js";

const log = logger.extend("whitelist");

// Cached set of allowed pubkeys (hex). Starts empty.
// When enabled + domain configured, an empty cache means everyone is denied (fail closed).
let whitelistCache: Set<string> = new Set();
let lastFetchTime = 0;

async function refreshWhitelist(): Promise<void> {
  if (!config.whitelist.nip05Domain) return;

  try {
    const data: unknown = await fetch(`https://${config.whitelist.nip05Domain}/.well-known/nostr.json`).then((res) =>
      res.json(),
    );

    if (data && typeof data === "object" && "names" in data && data.names && typeof data.names === "object") {
      // NIP-05: the values of the "names" map are hex pubkeys
      const fetched = new Set<string>(Object.values(data.names as Record<string, string>));

      // Union with hard-coded pubkeys from config
      whitelistCache = new Set<string>([...(config.whitelist.pubkeys ?? []), ...fetched]);
      lastFetchTime = Date.now();
      log("Refreshed whitelist from %s: %d pubkeys", config.whitelist.nip05Domain, whitelistCache.size);
    }
  } catch (error) {
    log("Failed to fetch NIP-05 whitelist from %s: %o", config.whitelist.nip05Domain, error);
    // Fail closed: do not update cache on error.
    // Hard-coded pubkeys (config.whitelist.pubkeys) are still checked directly in isWhitelisted.
  }
}

/**
 * Returns true if the given hex pubkey is allowed by the whitelist.
 *
 * When whitelist is disabled, always returns true.
 * When enabled, the cache is refreshed if stale, then the pubkey is checked
 * against the union of the NIP-05 domain fetch and the hard-coded pubkeys list.
 * Hard-coded pubkeys are always checked even if the domain fetch failed.
 */
export async function isWhitelisted(pubkey: string): Promise<boolean> {
  if (!config.whitelist.enabled) return true;

  const now = Date.now();
  const refreshInterval = (config.whitelist.refreshInterval ?? 3600) * 1000;

  // Refresh if cache is stale or has never been populated
  if (now - lastFetchTime >= refreshInterval) {
    await refreshWhitelist();
  }

  // Hard-coded pubkeys are always trusted, even if the domain fetch failed
  if (config.whitelist.pubkeys?.includes(pubkey)) return true;

  return whitelistCache.has(pubkey);
}
