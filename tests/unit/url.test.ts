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
import { getBaseUrl, isStaticCandidate } from "../../src/utils/url.ts";

const EXACT_MAX_PATH = `/${Array.from({ length: 8 }, () => "a".repeat(255)).join("/")}`;
const OVER_MAX_PATH = `/${
  [
    ...Array.from({ length: 8 }, () => "a".repeat(226)),
    "b".repeat(232),
  ].join("/")
}`;

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

const STATIC_CANDIDATE_PATHS = [
  ["safe nested path", "/nested/assets/app.js"],
  ["decoded space", "/operator%20assets/logo.png"],
  ["ordinary BMP Unicode", "/caf%C3%A9/menu.css"],
  ["ordinary non-BMP Unicode", "/emoji/%F0%9F%8C%B8.png"],
  ["255-code-point segment", `/${"a".repeat(255)}`],
  ["63 non-BMP code points at 252 UTF-8 bytes", `/${"😀".repeat(63)}`],
  ["255 combining-sequence code points", `/${`${"e\u0301".repeat(127)}x`}`],
  ["2,048-code-point decoded path", EXACT_MAX_PATH],
] as const;

for (const [name, pathname] of STATIC_CANDIDATE_PATHS) {
  Deno.test(`isStaticCandidate accepts ${name}`, () => {
    assertEquals(isStaticCandidate(pathname), true);
  });
}

const NON_CANDIDATE_PATHS = [
  ["a relative path", "relative/file.js"],
  ["malformed percent encoding", "/bad%encoding.js"],
  ["lowercase encoded slash", "/bad%2fpath"],
  ["uppercase encoded slash", "/bad%2Fpath"],
  ["lowercase encoded backslash", "/bad%5cpath"],
  ["uppercase encoded backslash", "/bad%5Cpath"],
  ["double-encoded slash", "/bad%252fpath"],
  ["triple-encoded slash", "/bad%25252Fpath"],
  ["double-encoded backslash", "/bad%255cpath"],
  ["a NUL control", "/bad%00path"],
  ["a C0 control", "/bad%1fpath"],
  ["DEL", "/bad%7fpath"],
  ["a C1 control", "/bad%C2%80path"],
  ["a decoded backslash", "/bad\\path"],
  ["an empty interior segment", "/nested//asset.js"],
  ["a dot segment", "/nested/./asset.js"],
  ["a traversal segment", "/nested/../asset.js"],
  ["a trailing empty segment", "/nested/asset.js/"],
  ["a 256-code-point segment", `/${"a".repeat(256)}`],
  ["64 non-BMP code points at 256 UTF-8 bytes", `/${"😀".repeat(64)}`],
  ["256 non-BMP code points", `/${"😀".repeat(256)}`],
  ["256 combining-sequence code points", `/${"e\u0301".repeat(128)}`],
  ["a 2,049-code-point decoded path", OVER_MAX_PATH],
] as const;

for (const [name, pathname] of NON_CANDIDATE_PATHS) {
  Deno.test(`isStaticCandidate rejects ${name}`, () => {
    assertEquals(isStaticCandidate(pathname), false);
  });
}
