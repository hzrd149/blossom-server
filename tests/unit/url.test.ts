/**
 * Unit tests for getBaseUrl — verifies reverse-proxy scheme handling.
 *
 * The server typically runs behind a TLS-terminating proxy (nginx, Caddy,
 * Traefik, Cloudflare). The connection it sees is plain HTTP, but blob
 * descriptor URLs returned to clients must use the original `https://`
 * scheme. We rely on `X-Forwarded-Proto` (de-facto) and the RFC 7239
 * `Forwarded` header to recover the original scheme.
 */

import { assertEquals } from "@std/assert";
import { getBaseUrl } from "../../src/utils/url.ts";

Deno.test("getBaseUrl: no proxy headers — uses connection scheme", () => {
  const req = new Request("http://localhost:3000/");
  assertEquals(getBaseUrl(req, ""), "http://localhost:3000");
});

Deno.test("getBaseUrl: no proxy headers with publicDomain", () => {
  const req = new Request("http://localhost:3000/");
  assertEquals(getBaseUrl(req, "cdn.example.com"), "http://cdn.example.com");
});

Deno.test("getBaseUrl: X-Forwarded-Proto upgrades to https with publicDomain", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "x-forwarded-proto": "https" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: X-Forwarded-Proto upgrades to https without publicDomain", () => {
  const req = new Request("http://internal.svc:3000/", {
    headers: { "x-forwarded-proto": "https" },
  });
  assertEquals(getBaseUrl(req, ""), "https://internal.svc:3000");
});

Deno.test("getBaseUrl: X-Forwarded-Proto with multiple comma-separated values uses first", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "x-forwarded-proto": "https, http" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: X-Forwarded-Proto is case-insensitive", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "x-forwarded-proto": "HTTPS" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: X-Forwarded-Proto with unknown value falls back to connection scheme", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "x-forwarded-proto": "ftp" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "http://cdn.example.com");
});

Deno.test("getBaseUrl: RFC 7239 Forwarded header proto=https", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "forwarded": "for=192.0.2.1;proto=https;by=203.0.113.43" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: RFC 7239 Forwarded header with quoted proto", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "forwarded": 'proto="https";for=192.0.2.1' },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: X-Forwarded-Proto wins over Forwarded header", () => {
  const req = new Request("http://localhost:3000/", {
    headers: {
      "x-forwarded-proto": "https",
      "forwarded": "proto=http",
    },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: trailing slash in publicDomain is stripped", () => {
  const req = new Request("http://localhost:3000/", {
    headers: { "x-forwarded-proto": "https" },
  });
  assertEquals(getBaseUrl(req, "cdn.example.com/"), "https://cdn.example.com");
});

Deno.test("getBaseUrl: incoming https stays https without forwarded headers", () => {
  const req = new Request("https://cdn.example.com/");
  assertEquals(getBaseUrl(req, ""), "https://cdn.example.com");
});

// ---------------------------------------------------------------------------
// isServeStaticCandidate — public-asset path guard
// ---------------------------------------------------------------------------

import { isServeStaticCandidate } from "../../src/utils/url.ts";

Deno.test("isServeStaticCandidate: accepts flat public asset names", () => {
  assertEquals(isServeStaticCandidate("/favicon.ico"), true);
  assertEquals(isServeStaticCandidate("/client.js"), true);
  assertEquals(isServeStaticCandidate("/abc-123_0.A"), true);
});

Deno.test("isServeStaticCandidate: rejects bare root and nested paths", () => {
  assertEquals(isServeStaticCandidate("/"), false);
  assertEquals(isServeStaticCandidate("/a/b.png"), false);
  assertEquals(isServeStaticCandidate("/nested/dir/file.js"), false);
});

Deno.test("isServeStaticCandidate: rejects URL slop and special characters", () => {
  assertEquals(isServeStaticCandidate("/foo.png%22,%22x"), false);
  assertEquals(isServeStaticCandidate('/foo.png","created_at":1'), false);
  assertEquals(isServeStaticCandidate("/caf\u00e9.js"), false);
});

Deno.test("isServeStaticCandidate: rejects traversal", () => {
  assertEquals(isServeStaticCandidate("/.."), false);
  assertEquals(isServeStaticCandidate("/../etc/passwd"), false);
});

Deno.test("isServeStaticCandidate: rejects over-long segments", () => {
  assertEquals(isServeStaticCandidate(`/${"a".repeat(128)}`), true);
  assertEquals(isServeStaticCandidate(`/${"a".repeat(129)}`), false);
  assertEquals(isServeStaticCandidate(`/${"a".repeat(300)}`), false);
});
