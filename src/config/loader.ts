import { parse as parseYaml } from "@std/yaml";
import { type Config, ConfigSchema } from "./schema.ts";

/** Recursively replace "${VAR_NAME}" placeholders with env var values. */
function interpolateEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      /\$\{([^}]+)\}/g,
      (_, name) => Deno.env.get(name) ?? `\${${name}}`,
    );
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map((
        [k, v],
      ) => [k, interpolateEnv(v)]),
    );
  }
  return value;
}

export async function loadConfig(configPath = "config.yml"): Promise<Config> {
  let raw: unknown = {};

  try {
    const text = await Deno.readTextFile(configPath);
    raw = parseYaml(text);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.warn(`Config file not found at "${configPath}", using defaults.`);
    } else {
      throw err;
    }
  }

  const interpolated = interpolateEnv(raw);
  const result = ConfigSchema.safeParse(interpolated);

  if (!result.success) {
    console.error("Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    Deno.exit(1);
  }

  return result.data;
}
