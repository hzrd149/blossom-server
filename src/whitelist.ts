import axios from 'axios';
import { config } from './config.js';

let whitelistCache: Set<string> = new Set();
let lastFetchTime = 0;

export async function fetchWhitelist() {
  if (!config.whitelist.enabled) {
    whitelistCache.clear();
    return whitelistCache;
  }

  const now = Date.now();
  if (now - lastFetchTime < config.whitelist.fetchDelay * 1000) {
    return whitelistCache;
  }

  try {
    const response = await axios.get(`https://${config.whitelist.domain}/.well-known/nostr.json`);
    const data = response.data;
    if (data && data.names) {
      whitelistCache = new Set(Object.values(data.names));
      lastFetchTime = now;
    }
  } catch (error) {
    console.error("Failed to fetch whitelist:", error);
  }

  return whitelistCache;
}

export function isWhitelisted(pubkey: string): boolean {
  if (!config.whitelist.enabled) return true; // Allow all if whitelist is disabled
  return whitelistCache.has(pubkey);
} 