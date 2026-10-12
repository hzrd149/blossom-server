import { assertEquals } from "@std/assert";
import {
  blobKind,
  blobKindLabel,
  blobListFilterSql,
  pageFileHint,
} from "../../src/utils/blob-kind.ts";

Deno.test("blobKind: pictures, pages, apps, and unlabeled", () => {
  assertEquals(blobKind("image/jpeg"), "image");
  assertEquals(blobKind("image/svg+xml"), "page");
  assertEquals(blobKind("text/html"), "page");
  assertEquals(blobKind("application/vnd.android.package-archive"), "app");
  assertEquals(blobKind("video/mp4"), "video");
  assertEquals(blobKind(null), "unknown");
  assertEquals(blobKind("application/octet-stream"), "unknown");
});

Deno.test("blobKindLabel: words an operator can scan", () => {
  assertEquals(blobKindLabel("image"), "Picture");
  assertEquals(blobKindLabel("unknown"), "Unlabeled");
  assertEquals(blobKindLabel("app"), "Android app");
});

Deno.test("blobListFilterSql: pictures exclude svg, unlabeled includes empty type", () => {
  assertEquals(
    blobListFilterSql("images", "b.type"),
    "b.type LIKE 'image/%' AND b.type != 'image/svg+xml'",
  );
  assertEquals(
    blobListFilterSql("unlabeled", "type"),
    "(type IS NULL OR type = '' OR type = 'application/octet-stream')",
  );
  assertEquals(blobListFilterSql("all", "b.type"), null);
  assertEquals(blobListFilterSql(undefined, "b.type"), null);
});

Deno.test("pageFileHint: title and markdown heading, not the whole file", () => {
  assertEquals(
    pageFileHint("text/html", "<html><title>Garden notes</title><p>secret</p>"),
    "Garden notes",
  );
  assertEquals(
    pageFileHint("text/markdown", "# Hello page\n\nbody"),
    "Hello page",
  );
  assertEquals(pageFileHint("text/css", "body{color:red}"), "Stylesheet");
});
