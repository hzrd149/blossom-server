import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { loadConfig, loadConfigStrict, MissingConfigError } from "../../src/config/loader.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

Deno.test("ConfigSchema: media thumbnail defaults are enabled", () => {
  const config = ConfigSchema.parse({ media: { enabled: true } });

  assertEquals(config.media.requirePubkeyInRule, true);
  assertEquals(config.media.tmpDir, "./data/media-tmp");
  assertEquals(config.media.thumbnail.enabled, true);
  assertEquals(config.media.thumbnail.maxWidth, 512);
  assertEquals(config.media.thumbnail.maxHeight, 512);
  assertEquals(config.media.thumbnail.quality, 80);
  assertEquals(config.media.thumbnail.outputFormat, "webp");
  assertEquals(config.media.thumbnail.videoSeek, 1);
});

Deno.test("ConfigSchema: media pubkey rule requirement can be disabled", () => {
  const config = ConfigSchema.parse({
    media: { requirePubkeyInRule: false },
  });

  assertEquals(config.media.requirePubkeyInRule, false);
});

Deno.test("loadConfig: legacy media config inherits upload pubkey setting", async () => {
  const dir = await Deno.makeTempDir();
  const configPath = join(dir, "config.yml");
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));

  try {
    await Deno.writeTextFile(
      configPath,
      "upload:\n  requirePubkeyInRule: false\nmedia:\n  enabled: true\n",
    );
    const inheritedFalse = await loadConfig(configPath);
    assertEquals(inheritedFalse.media.requirePubkeyInRule, false);

    await Deno.writeTextFile(
      configPath,
      "upload:\n  requirePubkeyInRule: true\nmedia:\n  enabled: true\n",
    );
    const inheritedTrue = await loadConfig(configPath);
    assertEquals(inheritedTrue.media.requirePubkeyInRule, true);

    await Deno.writeTextFile(
      configPath,
      "upload:\n  requirePubkeyInRule: true\nmedia:\n  requirePubkeyInRule: false\n",
    );
    const explicitMediaSetting = await loadConfig(configPath);
    assertEquals(explicitMediaSetting.media.requirePubkeyInRule, false);

    assertEquals(warnings.length, 2);
    assertEquals(
      warnings.every((warning) =>
        warning.includes(
          "falling back to upload.requirePubkeyInRule for backward compatibility",
        )
      ),
      true,
    );
  } finally {
    console.warn = originalWarn;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfig: directory config path uses defaults", async () => {
  const dir = await Deno.makeTempDir();
  const configPath = join(dir, "config.yml");
  const previous = Deno.env.get("BLOSSOM_REQUIRE_CONFIG");

  try {
    Deno.env.delete("BLOSSOM_REQUIRE_CONFIG");
    await Deno.mkdir(configPath);

    const config = await loadConfig(configPath);

    assertEquals(config.host, "0.0.0.0");
    assertEquals(config.port, 3000);
    assertEquals(config.database.path, "data/sqlite.db");
  } finally {
    if (previous !== undefined) Deno.env.set("BLOSSOM_REQUIRE_CONFIG", previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfigStrict: environment enables strict mode for a missing file", async () => {
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get("BLOSSOM_REQUIRE_CONFIG");

  try {
    Deno.env.set("BLOSSOM_REQUIRE_CONFIG", "1");
    await assertRejects(
      () => loadConfigStrict(join(dir, "missing.yml")),
      MissingConfigError,
      "not found",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("BLOSSOM_REQUIRE_CONFIG");
    else Deno.env.set("BLOSSOM_REQUIRE_CONFIG", previous);
    await Deno.remove(dir, { recursive: true });
  }
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
  const dir = await Deno.makeTempDir();

  try {
    const config = await loadConfigStrict(join(dir, "missing.yml"), false);
    assertEquals(config.host, "0.0.0.0");
    assertEquals(config.port, 3000);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
