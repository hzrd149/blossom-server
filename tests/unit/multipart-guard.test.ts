/**
 * Unit tests for isEnvelopeMime() — the multipart/urlencoded request-body
 * guard added after the 2026-08-27 incident (blobs stored as envelope bytes
 * with type multipart/form-data; see docs/10 incident report).
 *
 * Contract: callers pass the bare MIME (split on ';' before), but the helper
 * also tolerates whitespace and case variations defensively.
 */

import { assertEquals } from "@std/assert";
import { isEnvelopeMime } from "../../src/utils/mime.ts";

Deno.test("isEnvelopeMime: detects multipart variants", () => {
  assertEquals(isEnvelopeMime("multipart/form-data"), true);
  assertEquals(isEnvelopeMime("multipart/mixed"), true);
  assertEquals(isEnvelopeMime("multipart/related"), true);
});

Deno.test("isEnvelopeMime: detects the incident's exact value", () => {
  // real stored value from 2026-08-27 (header split on ';' at the call site):
  const header = "multipart/form-data; boundary=------BlossomUpload1787500197539";
  assertEquals(isEnvelopeMime(header.split(";")[0]), true);
});

Deno.test("isEnvelopeMime: detects urlencoded", () => {
  assertEquals(isEnvelopeMime("application/x-www-form-urlencoded"), true);
});

Deno.test("isEnvelopeMime: case and whitespace insensitive", () => {
  assertEquals(isEnvelopeMime("  Multipart/Form-Data "), true);
  assertEquals(isEnvelopeMime("MULTIPART/x"), true);
  assertEquals(isEnvelopeMime(" Application/X-WWW-Form-Urlencoded "), true);
});

Deno.test("isEnvelopeMime: passes legitimate media and fallback types", () => {
  const legit = [
    "image/png",
    "image/jpeg",
    "video/mp4",
    "video/webm",
    "audio/ogg",
    "application/pdf",
    "application/octet-stream",
    "text/plain",
    "application/json",
    "",
  ];
  for (const m of legit) {
    assertEquals(isEnvelopeMime(m), false, `should pass: "${m}"`);
  }
});

Deno.test("isEnvelopeMime: near-misses are not envelope types", () => {
  assertEquals(isEnvelopeMime("multiparticious/png"), false); // no slash after "multipart"
  assertEquals(isEnvelopeMime("image/multipart-ish"), false);
  assertEquals(isEnvelopeMime("application/x-www-form-urlencoded2"), false);
});
