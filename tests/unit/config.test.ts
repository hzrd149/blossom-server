import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  loadConfig,
  loadConfigStrict,
  MissingConfigError,
} from "../../src/config/loader.ts";
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

Deno.test("loadConfigStrict: throws MissingConfigError for missing file in strict mode", async () => {
  await assertRejects(
    () => loadConfigStrict("/nonexistent-strict-test/config.yml", true),
    MissingConfigError,
  );
});

Deno.test("loadConfigStrict: throws MissingConfigError for directory path in strict mode", async () => {
  const dir = await Deno.makeTempDir();
  const configPath = join(dir, "config.yml");

  try {
    await Deno.mkdir(configPath);

    await assertRejects(
      () => loadConfigStrict(configPath, true),
      MissingConfigError,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfigStrict: lenient mode still falls back to defaults", async () => {
  const config = await loadConfigStrict(
    "/nonexistent-strict-test/config.yml",
    false,
  );
  assertEquals(config.host, "0.0.0.0");
  assertEquals(config.port, 3000);
});

Deno.test("loadConfigStrict: valid file loads identically in strict mode", async () => {
  const dir = await Deno.makeTempDir();
  const configPath = join(dir, "config.yml");

  try {
    await Deno.writeTextFile(configPath, "port: 3001\n");

    const config = await loadConfigStrict(configPath, true);
    assertEquals(config.port, 3001);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
