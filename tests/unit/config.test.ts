import { assertEquals } from "@std/assert";
import { ConfigSchema } from "../../src/config/schema.ts";

Deno.test("ConfigSchema: media thumbnail defaults are enabled", () => {
  const config = ConfigSchema.parse({ media: { enabled: true } });

  assertEquals(config.media.thumbnail.enabled, true);
  assertEquals(config.media.thumbnail.maxWidth, 512);
  assertEquals(config.media.thumbnail.maxHeight, 512);
  assertEquals(config.media.thumbnail.quality, 80);
  assertEquals(config.media.thumbnail.outputFormat, "webp");
  assertEquals(config.media.thumbnail.videoSeek, 1);
});
