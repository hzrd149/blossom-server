import { assertEquals } from "@std/assert";
import { extractBlobHash } from "../../src/routes/blobs.ts";

const HASH = "0123456789abcdef".repeat(4);
const UPPER_HASH = HASH.toUpperCase();

const ACCEPTED_FILENAMES = [
  ["lowercase bare hash", HASH],
  ["uppercase bare hash", UPPER_HASH],
  ["one-character extension", `${HASH}.a`],
  ["ten-character extension", `${HASH}.abcdefghij`],
  ["multiple extension segments", `${HASH}.tar.gz.123`],
] as const;

for (const [name, filename] of ACCEPTED_FILENAMES) {
  Deno.test(`extractBlobHash accepts ${name}`, () => {
    assertEquals(extractBlobHash(filename), HASH);
  });
}

const REJECTED_FILENAMES = [
  ["63 hexadecimal characters", HASH.slice(1)],
  ["65 hexadecimal characters", `${HASH}a`],
  ["prefix slop", `x${HASH}`],
  ["suffix slop", `${HASH}x`],
  ["an eleven-character extension", `${HASH}.abcdefghijk`],
  ["a trailing dot", `${HASH}.`],
  ["an empty extension segment", `${HASH}..png`],
  ["a quote", `${HASH}\"`],
  ["a comma", `${HASH},png`],
  ["JSON text", `${HASH}{\"ext\":\"png\"}`],
  ["whitespace", `${HASH} .png`],
  ["an encoded slash", `${HASH}%2fextra`],
  ["an encoded backslash", `${HASH}%5cextra`],
] as const;

for (const [name, filename] of REJECTED_FILENAMES) {
  Deno.test(`extractBlobHash rejects ${name}`, () => {
    assertEquals(extractBlobHash(filename), null);
  });
}
