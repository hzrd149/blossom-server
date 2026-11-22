/**
 * Moderation input schemas — pure, browser-safe (imports zod and the rule-schema pubkey regex only).
 *
 * Shared by the moderation service, the Blossom routes, and the admin API contracts: ban
 * categories, hash format, and hex/npub pubkey normalization.
 */

import { z } from "zod";
import { HEX_PUBKEY_RE } from "./rule-schema.ts";

/** NIP-56 report types usable as ban categories. */
export const BAN_CATEGORIES = ["nudity", "malware", "profanity", "illegal", "spam", "impersonation", "other"] as const;
export type BanCategory = (typeof BAN_CATEGORIES)[number];
export const BanCategorySchema = z.enum(BAN_CATEGORIES);

/** SHA-256: 64 lowercase hex characters. */
export const HEX64_RE = /^[0-9a-f]{64}$/;

// --- npub decoding (minimal bech32, so this module needs no nostr library) ---

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GENERATOR[i];
  }
  return chk;
}

/** Decode a bech32 string with the given prefix into 32 bytes of hex, or null when invalid. */
export function decodeBech32Hex(value: string, prefix: string): string | null {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null;
  const str = value.toLowerCase();
  const sep = str.lastIndexOf("1");
  if (sep < 1 || str.slice(0, sep) !== prefix) return null;
  const data = [...str.slice(sep + 1)].map((c) => BECH32_CHARSET.indexOf(c));
  if (data.length < 7 || data.some((d) => d < 0)) return null;
  const hrp = [...prefix].map((c) => c.charCodeAt(0));
  if (bech32Polymod([...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31), ...data]) !== 1) return null;
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const word of data.slice(0, -6)) {
    acc = (acc << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0 || out.length !== 32) return null;
  return out.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalize a hex or npub pubkey to lowercase hex; null when invalid. */
export function normalizePubkey(value: string): string | null {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (HEX_PUBKEY_RE.test(lower)) return lower;
  return lower.startsWith("npub1") ? decodeBech32Hex(trimmed, "npub") : null;
}

// --- Field schemas ---

/** A hex or npub pubkey, stored as hex. */
export const PubkeyInputSchema = z.string().transform((value, ctx) => {
  const hex = normalizePubkey(value);
  if (!hex) {
    ctx.addIssue({ code: "custom", message: "Expected a 64-character hex pubkey or an npub" });
    return z.NEVER;
  }
  return hex;
});
