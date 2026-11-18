import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  cleanRule,
  ConfigChangedError,
  hashText,
  readConfigFile,
  renderConfigWithRules,
  renderRulesSnippet,
  writeConfigFile,
} from "../../src/config/editor.ts";
import { parseConfigText } from "../../src/config/loader.ts";
import { RuleStore } from "../../src/policy/rule-store.ts";

const SOURCE = `# Header comment
port: 3000 # inline comment
storage:
  backend: local
  # Rules comment
  rules:
    - type: "*"
      expiration: 1 week
s3Key: "\${S3_ACCESS_KEY}"
`;

Deno.test("cleanRule omits defaults and keeps a stable field order", () => {
  assertEquals(
    cleanRule({ note: " hi ", enabled: true, pubkeys: [], nip05Domains: [], basis: undefined, expiration: "1 day", type: "*" }),
    { type: "*", expiration: "1 day", note: "hi" },
  );
  assertEquals(Object.keys(cleanRule({ enabled: false, type: "*", basis: "uploaded", expiration: "1 day" })), [
    "type",
    "expiration",
    "basis",
    "enabled",
  ]);
});

Deno.test("renderConfigWithRules replaces only storage.rules and preserves comments and placeholders", () => {
  const text = renderConfigWithRules(SOURCE, [
    { type: "image/*", expiration: "1 month", basis: "uploaded", enabled: true },
    { type: "*", expiration: "1 day", enabled: false, note: "off for now" },
  ]);
  assertStringIncludes(text, "# Header comment");
  assertStringIncludes(text, "port: 3000 # inline comment");
  assertStringIncludes(text, "# Rules comment");
  assertStringIncludes(text, '"${S3_ACCESS_KEY}"');
  const parsed = parseYaml(text) as { storage: { backend: string; rules: unknown[] } };
  assertEquals(parsed.storage.backend, "local");
  assertEquals(parsed.storage.rules, [
    { type: "image/*", expiration: "1 month", basis: "uploaded" },
    { type: "*", expiration: "1 day", enabled: false, note: "off for now" },
  ]);
});

Deno.test("renderConfigWithRules creates storage.rules in an empty or rule-less file", () => {
  for (const source of ["", "port: 3000\n", "storage:\n  backend: local\n"]) {
    const parsed = parseYaml(renderConfigWithRules(source, [{ type: "*", expiration: "1 day" }])) as {
      storage: { rules: unknown[] };
    };
    assertEquals(parsed.storage.rules, [{ type: "*", expiration: "1 day" }]);
  }
  assertThrows(() => renderConfigWithRules("storage: [", []), Error, "YAML");
  assertThrows(() => renderConfigWithRules("- a list\n", []), Error, "mapping");
});

Deno.test("renderRulesSnippet contains only storage.rules", () => {
  const snippet = renderRulesSnippet([{ type: "video/*", expiration: "3 days", pubkeys: ["a".repeat(64)] }]);
  assertEquals(parseYaml(snippet), { storage: { rules: [{ type: "video/*", expiration: "3 days", pubkeys: ["a".repeat(64)] }] } });
});

Deno.test("config rules with enabled/note load, and disabled rules are not evaluated", () => {
  const config = parseConfigText(
    "storage:\n  rules:\n    - type: image/*\n      expiration: 1 day\n      enabled: false\n      note: paused\n    - type: '*'\n      expiration: 1 week\n",
    { quiet: true },
  );
  const store = new RuleStore(config.storage.rules);
  assertEquals(store.entries().length, 2);
  assertEquals(store.current(), [{ type: "*", expiration: "1 week" }]);
});

Deno.test("readConfigFile and writeConfigFile detect writability and stale hashes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "blossom-config-editor-" });
  try {
    const path = join(dir, "config.yml");
    assertEquals(await readConfigFile(undefined), { path: null, exists: false, writable: false, text: "", hash: null });
    assertEquals((await readConfigFile(path)).exists, false);

    await Deno.writeTextFile(path, SOURCE);
    await Deno.chmod(path, 0o640);
    const state = await readConfigFile(path);
    assertEquals(state.exists, true);
    assertEquals(state.writable, true);
    assertEquals(state.hash, await hashText(SOURCE));

    const next = renderConfigWithRules(SOURCE, [{ type: "*", expiration: "1 day" }]);
    const hash = await writeConfigFile(path, next, state.hash!);
    assertEquals(await Deno.readTextFile(path), next);
    assertEquals(hash, await hashText(next));
    assertEquals((await Deno.stat(path)).mode! & 0o777, 0o640, "file mode is preserved");
    assertEquals([...Deno.readDirSync(dir)].map((e) => e.name), ["config.yml"], "no temp files left behind");

    await assertRejects(() => writeConfigFile(path, SOURCE, state.hash!), ConfigChangedError);
    assertEquals(await Deno.readTextFile(path), next);

    // Symlinked configs are written through, keeping the link.
    const link = join(dir, "link.yml");
    await Deno.symlink(path, link);
    await writeConfigFile(link, SOURCE, hash);
    assert((await Deno.lstat(link)).isSymlink);
    assertEquals(await Deno.readTextFile(path), SOURCE);

    if (Deno.uid() !== 0) {
      await Deno.chmod(path, 0o444);
      assertEquals((await readConfigFile(path)).writable, false);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
