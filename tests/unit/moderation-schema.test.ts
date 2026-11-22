import { assert, assertEquals } from "@std/assert";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { npubEncode } from "nostr-tools/nip19";
import { BAN_CATEGORIES, normalizePubkey, PubkeyInputSchema } from "../../src/policy/moderation-schema.ts";
import { REPORT_TYPES } from "../../src/db/reports.ts";

const PUBKEY = getPublicKey(generateSecretKey());

Deno.test("ban categories match NIP-56 report types", () => {
  assertEquals([...BAN_CATEGORIES], [...REPORT_TYPES]);
});

Deno.test("normalizePubkey accepts hex and npub", () => {
  assertEquals(normalizePubkey(PUBKEY.toUpperCase()), PUBKEY);
  assertEquals(normalizePubkey(npubEncode(PUBKEY)), PUBKEY);
  assertEquals(normalizePubkey(npubEncode(PUBKEY).toUpperCase()), PUBKEY);
  assertEquals(normalizePubkey(npubEncode(PUBKEY).slice(0, -1) + "q"), null); // bad checksum
  assertEquals(normalizePubkey("npub1abc"), null);
  assertEquals(normalizePubkey("xyz"), null);
});

Deno.test("PubkeyInputSchema stores an npub as hex and rejects invalid keys", () => {
  assertEquals(PubkeyInputSchema.parse(npubEncode(PUBKEY)), PUBKEY);
  assert(!PubkeyInputSchema.safeParse("npub1bogus").success);
});
