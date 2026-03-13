export function truncateHash(hash: string) {
  return hash.slice(0, 4) + "…" + hash.slice(-4, hash.length);
}
