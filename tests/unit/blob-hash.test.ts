/**
 * Unit tests for extractBlobHash — strict /:filename segment validation
 * for the BUD-01 blob routes.
 *
 * The segment must be exactly the 64-char hash with an optional short
 * alphanumeric extension. URLs that carry slop after the hash (event JSON
 * glued on by misbehaving Nostr clients) must be rejected so they fall
 * through to 404 instead of fuzzy-matching the leading hex run.
 */

import { assertEquals } from "@std/assert";
import { extractBlobHash } from "../../src/routes/blobs.ts";

const HASH = "d4866dccea9958f6af941e39e7a4664e8d339f1e35177fca71e8275ecfb50532";

Deno.test("extractBlobHash: bare 64-char hash", () => {
  assertEquals(extractBlobHash(HASH), HASH);
});

Deno.test("extractBlobHash: hash with .png extension", () => {
  assertEquals(extractBlobHash(`${HASH}.png`), HASH);
});

Deno.test("extractBlobHash: hash with .jpeg extension", () => {
  assertEquals(extractBlobHash(`${HASH}.jpeg`), HASH);
});

Deno.test("extractBlobHash: 10-char extension is accepted", () => {
  assertEquals(extractBlobHash(`${HASH}.abcdefghij`), HASH);
});

Deno.test("extractBlobHash: 11-char extension is rejected", () => {
  assertEquals(extractBlobHash(`${HASH}.abcdefghijk`), null);
});

Deno.test("extractBlobHash: trailing dot is rejected", () => {
  assertEquals(extractBlobHash(`${HASH}.`), null);
});

Deno.test("extractBlobHash: uppercase hash is rejected", () => {
  assertEquals(extractBlobHash(HASH.toUpperCase()), null);
});

Deno.test("extractBlobHash: 63-char hash is rejected", () => {
  assertEquals(extractBlobHash(HASH.slice(1)), null);
});

Deno.test("extractBlobHash: 65-char hash is rejected", () => {
  assertEquals(extractBlobHash(`${HASH}a`), null);
});

Deno.test("extractBlobHash: encoded JSON slop is rejected", () => {
  assertEquals(
    extractBlobHash(`${HASH}.png%22,%22created_at%22:1787905306`),
    null,
  );
});

Deno.test("extractBlobHash: decoded JSON slop is rejected", () => {
  assertEquals(
    extractBlobHash(`${HASH}.png","created_at":1787905306,"kind":1`),
    null,
  );
});

Deno.test("extractBlobHash: nested path is rejected", () => {
  assertEquals(extractBlobHash(`sub/${HASH}`), null);
});

Deno.test("extractBlobHash: empty segment is rejected", () => {
  assertEquals(extractBlobHash(""), null);
});
