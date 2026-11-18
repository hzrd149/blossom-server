/**
 * NIP-05 domain validation shared by the config schema and the allowlist fetcher.
 *
 * A domain is accepted when `https://<domain>/.well-known/nostr.json` parses to
 * exactly that path with no credentials, query or fragment — so a value that
 * smuggles in a scheme, path or query (`https://example.org`, `example.org/`,
 * `user:pw@example.org`) is rejected. The normalized form is the URL host, which
 * lowercases and punycode-encodes IDN labels (`bücher.example` → `xn--bcher-kva.example`).
 */

/** Returns the normalized host for a NIP-05 domain, or throws when the value is not a bare domain. */
export function normalizeNip05Domain(domain: string): string {
  const trimmed = domain.trim();
  let url: URL;
  try {
    url = new URL(`https://${trimmed}/.well-known/nostr.json`);
  } catch {
    throw new Error(`Invalid NIP-05 domain "${domain}": not a valid hostname`);
  }
  if (
    trimmed === "" || url.username || url.password || url.search || url.hash || url.pathname !== "/.well-known/nostr.json" ||
    /[/?#@\\]/.test(trimmed)
  ) {
    throw new Error(`Invalid NIP-05 domain "${domain}": expected a bare domain such as "example.org"`);
  }
  return url.host;
}

/** Builds the nostr.json URL for an already normalized domain. */
export function nostrJsonUrl(domain: string): URL {
  return new URL(`https://${domain}/.well-known/nostr.json`);
}
