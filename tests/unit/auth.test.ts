/**
 * Unit tests for src/middleware/auth.ts
 *
 * Tests BUD-11 auth event parsing, requireAuth, and requireXTag.
 * Uses real Nostr signed events generated with nostr-tools.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { encodeBase64Url } from "@std/encoding/base64url";
import { HTTPException } from "@hono/hono/http-exception";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";
import { parseAuthEvent, requireAuth, requireXTag } from "../../src/middleware/auth.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sk = generateSecretKey();
const _pk = getPublicKey(sk);

/** Build a valid BUD-11 kind 24242 auth event. Accepts tag overrides. */
function makeEvent(overrides: Partial<{
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}>): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      tags: [
        ["t", "upload"],
        ["expiration", String(now + 600)],
      ],
      content: "Upload blob",
      ...overrides,
    },
    sk,
  );
}

/** Encode a Nostr event as a Base64url string (BUD-11 format). */
function encodeEvent(event: NostrEvent): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(event)));
}

/** Build the Authorization header value for an event. */
function authHeader(event: NostrEvent): string {
  return `Nostr ${encodeEvent(event)}`;
}

// ---------------------------------------------------------------------------
// parseAuthEvent — valid event
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: valid event returns the event", () => {
  const event = makeEvent({});
  const result = parseAuthEvent(encodeEvent(event), null);
  assertEquals(result.id, event.id);
  assertEquals(result.pubkey, event.pubkey);
});

// ---------------------------------------------------------------------------
// parseAuthEvent — Base64url encoding
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects non-base64 raw string", () => {
  assertThrows(
    () => parseAuthEvent("!!!not-base64!!!", null),
    HTTPException,
  );
});

// ---------------------------------------------------------------------------
// parseAuthEvent — kind check
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects event with wrong kind", () => {
  const event = makeEvent({ kind: 1 });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "kind 24242",
  );
});

// ---------------------------------------------------------------------------
// parseAuthEvent — created_at check
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects event with created_at in the future", () => {
  const future = Math.floor(Date.now() / 1000) + 9999;
  const event = makeEvent({ created_at: future });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "future",
  );
});

// ---------------------------------------------------------------------------
// parseAuthEvent — expiration tag
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects event with missing expiration tag", () => {
  const event = makeEvent({ tags: [["t", "upload"]] });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "expiration",
  );
});

Deno.test("parseAuthEvent: rejects event with expired expiration tag", () => {
  const past = Math.floor(Date.now() / 1000) - 1;
  const event = makeEvent({
    tags: [["t", "upload"], ["expiration", String(past)]],
  });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "expired",
  );
});

// ---------------------------------------------------------------------------
// parseAuthEvent — t tag
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects event with missing t tag", () => {
  const now = Math.floor(Date.now() / 1000);
  const event = makeEvent({
    tags: [["expiration", String(now + 600)]],
  });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "t tag",
  );
});

// ---------------------------------------------------------------------------
// parseAuthEvent — server tag scoping
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: server tag matches domain → accepted", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["server", "cdn.example.com"],
    ],
  });
  const result = parseAuthEvent(encodeEvent(event), "cdn.example.com");
  assertEquals(result.id, event.id);
});

Deno.test("parseAuthEvent: server tag present but domain does not match → rejected", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["server", "other.example.com"],
    ],
  });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), "cdn.example.com"),
    HTTPException,
    "not valid for this server",
  );
});

Deno.test("parseAuthEvent: server tag present but serverDomain is null → rejected", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["server", "cdn.example.com"],
    ],
  });
  assertThrows(
    () => parseAuthEvent(encodeEvent(event), null),
    HTTPException,
    "not valid for this server",
  );
});

Deno.test("parseAuthEvent: no server tags → valid for any server", () => {
  const event = makeEvent({});
  // Should not throw regardless of serverDomain
  const result = parseAuthEvent(encodeEvent(event), "anything.example.com");
  assertEquals(result.id, event.id);
});

// ---------------------------------------------------------------------------
// parseAuthEvent — signature verification
// ---------------------------------------------------------------------------

Deno.test("parseAuthEvent: rejects event with invalid signature", () => {
  const event = makeEvent({});
  // Tamper with the sig
  const tampered = { ...event, sig: "a".repeat(128) };
  assertThrows(
    () => parseAuthEvent(encodeEvent(tampered as NostrEvent), null),
    HTTPException,
    "signature invalid",
  );
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

// Build a minimal mock Hono Context for requireAuth testing
function makeCtx(auth: NostrEvent | undefined, authType: string | undefined) {
  const vars = new Map<string, unknown>([
    ["auth", auth],
    ["authType", authType],
  ]);
  return {
    get: (key: string) => vars.get(key),
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("requireAuth: throws 401 when no auth", () => {
  const ctx = makeCtx(undefined, undefined);
  assertThrows(
    () => requireAuth(ctx, "upload"),
    HTTPException,
  );
  try {
    requireAuth(ctx, "upload");
  } catch (err) {
    assertEquals((err as HTTPException).status, 401);
  }
});

Deno.test("requireAuth: throws 403 when t tag type does not match", () => {
  const event = makeEvent({ tags: [["t", "delete"], ["expiration", String(Math.floor(Date.now() / 1000) + 600)]] });
  const ctx = makeCtx(event, "delete");
  try {
    requireAuth(ctx, "upload");
  } catch (err) {
    assertEquals((err as HTTPException).status, 403);
  }
});

Deno.test("requireAuth: returns event when auth and type match", () => {
  const event = makeEvent({});
  const ctx = makeCtx(event, "upload");
  const result = requireAuth(ctx, "upload");
  assertEquals(result.id, event.id);
});

// ---------------------------------------------------------------------------
// requireXTag
// ---------------------------------------------------------------------------

const TEST_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

Deno.test("requireXTag: no x tags → no throw (open auth event)", () => {
  const event = makeEvent({});
  // Should not throw — open upload token
  requireXTag(event, TEST_HASH);
});

Deno.test("requireXTag: x tag present and hash matches → no throw", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["x", TEST_HASH],
    ],
  });
  requireXTag(event, TEST_HASH);
});

Deno.test("requireXTag: x tag present but hash does not match → throws 403", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["x", OTHER_HASH],
    ],
  });
  assertThrows(
    () => requireXTag(event, TEST_HASH),
    HTTPException,
  );
  try {
    requireXTag(event, TEST_HASH);
  } catch (err) {
    assertEquals((err as HTTPException).status, 403);
  }
});

Deno.test("requireXTag: multiple x tags, one matches → no throw", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["x", OTHER_HASH],
      ["x", TEST_HASH],
    ],
  });
  requireXTag(event, TEST_HASH);
});

Deno.test("requireXTag: x tags present, empty hash → throws 403", () => {
  const event = makeEvent({
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      ["x", TEST_HASH],
    ],
  });
  assertThrows(
    () => requireXTag(event, ""),
    HTTPException,
  );
});
