import { nip19 } from "nostr-tools";

export function isHex(str?: string) {
  if (str?.match(/^[0-9a-f]+$/i)) return true;
  return false;
}
export function safeDecode(str: string) {
  try {
    return nip19.decode(str);
  } catch (e) {}
}
export function getPubkeyFromDecodeResult(result?: nip19.DecodeResult) {
  if (!result) return;
  switch (result.type) {
    case "naddr":
    case "nprofile":
      return result.data.pubkey;
    case "npub":
      return result.data;
  }
}
export function normalizeToHexPubkey(hex: string) {
  if (isHex(hex)) return hex;
  const decode = safeDecode(hex);
  if (!decode) return null;
  return getPubkeyFromDecodeResult(decode) ?? null;
}
