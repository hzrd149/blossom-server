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

Deno.test("ConfigSchema: storage rule accepts nip05Domains", () => {
  const config = ConfigSchema.parse({
    storage: {
      rules: [{ type: "*", expiration: "1 year", nip05Domains: ["example.org", "edufeed.org"] }],
    },
  });

  assertEquals(config.storage.rules[0].nip05Domains, ["example.org", "edufeed.org"]);
  assertEquals(config.storage.rules[0].pubkeys, undefined);
});

Deno.test("ConfigSchema: storage.nip05 defaults", () => {
  const config = ConfigSchema.parse({});

  assertEquals(config.storage.nip05.refreshIntervalMs, 600_000);
  assertEquals(config.storage.nip05.timeoutMs, 5000);
});

Deno.test("ConfigSchema: storage.nip05.refreshIntervalMs rejects values below one minute", () => {
  const result = ConfigSchema.safeParse({ storage: { nip05: { refreshIntervalMs: 1000 } } });

  assertEquals(result.success, false);
});

Deno.test("ConfigSchema: storage.nip05.refreshIntervalMs accepts 0 (startup only)", () => {
  const config = ConfigSchema.parse({ storage: { nip05: { refreshIntervalMs: 0, timeoutMs: 1000 } } });

  assertEquals(config.storage.nip05.refreshIntervalMs, 0);
  assertEquals(config.storage.nip05.timeoutMs, 1000);
});

Deno.test("ConfigSchema: storage.nip05.timeoutMs rejects values below one second", () => {
  const result = ConfigSchema.safeParse({ storage: { nip05: { timeoutMs: 999 } } });

  assertEquals(result.success, false);
});

Deno.test("ConfigSchema: storage.nip05.refreshIntervalMs rejects values beyond the setTimeout limit", () => {
  const result = ConfigSchema.safeParse({ storage: { nip05: { refreshIntervalMs: 2_147_483_648 } } });

  assertEquals(result.success, false);
  assertEquals(result.error?.issues[0].message.includes("2147483647"), true);
});

Deno.test("ConfigSchema: nip05Domains rejects values that are not bare domains", () => {
  for (const domain of ["https://example.org", "example.org/", "example.org/.well-known", "user:pw@example.org", "example.org?name=alice", ""]) {
    const result = ConfigSchema.safeParse({
      storage: { rules: [{ type: "*", expiration: "1 year", nip05Domains: ["ok.example", domain] }] },
    });

    assertEquals(result.success, false, `domain=${JSON.stringify(domain)}`);
    const issue = result.error!.issues[0];
    assertEquals(issue.path, ["storage", "rules", 0, "nip05Domains", 1]);
    assertEquals(issue.message.includes("Invalid NIP-05 domain"), true, issue.message);
  }
});

Deno.test("ConfigSchema: nip05Domains accepts IDN domains", () => {
  const config = ConfigSchema.parse({
    storage: { rules: [{ type: "*", expiration: "1 year", nip05Domains: ["bücher.example", "xn--bcher-kva.example", "Example.ORG"] }] },
  });

  assertEquals(config.storage.rules[0].nip05Domains, ["bücher.example", "xn--bcher-kva.example", "Example.ORG"]);
});
