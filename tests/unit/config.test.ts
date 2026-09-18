import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadConfig } from "../../src/config/loader.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

Deno.test("ConfigSchema: media thumbnail defaults are enabled", () => {
  const config = ConfigSchema.parse({ media: { enabled: true } });

  assertEquals(config.media.tmpDir, "./data/media-tmp");
  assertEquals(config.media.thumbnail.enabled, true);
  assertEquals(config.media.thumbnail.maxWidth, 512);
  assertEquals(config.media.thumbnail.maxHeight, 512);
  assertEquals(config.media.thumbnail.quality, 80);
  assertEquals(config.media.thumbnail.outputFormat, "webp");
  assertEquals(config.media.thumbnail.videoSeek, 1);
});

Deno.test("ConfigSchema: media optimizeByDefault and video keepMetadata default off", () => {
  const config = ConfigSchema.parse({ media: { enabled: true } });

  assertEquals(config.media.optimizeByDefault, false);
  assertEquals(config.media.video.keepMetadata, false);
});

Deno.test("loadConfig: directory config path uses defaults", async () => {
  const dir = await Deno.makeTempDir();
  const configPath = join(dir, "config.yml");

  try {
    await Deno.mkdir(configPath);

    const config = await loadConfig(configPath);

    assertEquals(config.host, "0.0.0.0");
    assertEquals(config.port, 3000);
    assertEquals(config.database.path, "data/sqlite.db");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
