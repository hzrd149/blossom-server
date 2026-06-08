import { assertEquals } from "@std/assert";
import { nip94Tags, optionalNip94Tags } from "../../src/utils/nip94.ts";

Deno.test("nip94Tags: emits core file metadata tags", () => {
  const tags = nip94Tags({
    url: "https://cdn.example.com/blob.png",
    sha256: "a".repeat(64),
    size: 1234,
    type: "Image/PNG",
  });

  assertEquals(tags, [
    ["url", "https://cdn.example.com/blob.png"],
    ["m", "image/png"],
    ["x", "a".repeat(64)],
    ["size", "1234"],
  ]);
});

Deno.test("optionalNip94Tags: emits optional ox and dim tags", () => {
  const tags = optionalNip94Tags({
    originalSha256: "c".repeat(64),
    dim: "640x480",
  });

  assertEquals(tags, [
    ["ox", "c".repeat(64)],
    ["dim", "640x480"],
  ]);
});

Deno.test("optionalNip94Tags: emits optional thumb tag", () => {
  const tags = optionalNip94Tags({
    thumbnail: {
      url: "https://cdn.example.com/thumb.webp",
      sha256: "d".repeat(64),
    },
  });

  assertEquals(tags, [
    ["thumb", "https://cdn.example.com/thumb.webp", "d".repeat(64)],
  ]);
});

Deno.test("nip94Tags: appends optional tags after core tags", () => {
  const tags = nip94Tags({
    url: "https://cdn.example.com/optimized.webp",
    sha256: "b".repeat(64),
    size: 5678,
    type: "image/webp",
    tags: [
      ["ox", "c".repeat(64)],
      ["dim", "640x480"],
    ],
  });

  assertEquals(tags, [
    ["url", "https://cdn.example.com/optimized.webp"],
    ["m", "image/webp"],
    ["x", "b".repeat(64)],
    ["size", "5678"],
    ["ox", "c".repeat(64)],
    ["dim", "640x480"],
  ]);
});
