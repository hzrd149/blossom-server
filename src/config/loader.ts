import { parse as parseYaml } from "@std/yaml";
import { type Config, ConfigSchema } from "./schema.ts";

/**
 * Thrown when the config file is missing or the path is a directory while
 * strict config mode is enabled (BLOSSOM_REQUIRE_CONFIG=1).
 *
 * Without strict mode, a missing config silently boots the server on schema
 * defaults — an open server with no allowlists — which is a dangerous
 * fallback for closed deployments (a bad deploy that renames config.yml
 * evaporates every closed-server protection with only a console warning).
 */
export class MissingConfigError extends Error {
  constructor(path: string, reason: string) {
    super(
      `Strict config mode: config file ${reason} at "${path}" — refusing to start`,
    );
    this.name = "MissingConfigError";
  }
}

/**
 * Loads and validates the config file.
 *
 * Throws MissingConfigError (instead of falling back to defaults) when the
 * config file is missing or the path is a directory AND strict mode is on.
 * Strict mode is on when `requireConfig` is true, defaulting to the
 * BLOSSOM_REQUIRE_CONFIG=1 environment variable.
 *
 * All other config problems (unreadable file, invalid YAML, schema
 * violations) always throw / exit — the lenient fallback only ever applied
 * to the missing-file case.
 */
export async function loadConfigStrict(
  configPath = "config.yml",
  requireConfig = ["1", "true", "yes"].includes(
    (Deno.env.get("BLOSSOM_REQUIRE_CONFIG") ?? "").toLowerCase(),
  ),
): Promise<Config> {
  let raw: unknown = {};

  try {
    const text = await Deno.readTextFile(configPath);
    raw = parseYaml(text);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      if (requireConfig) {
        throw new MissingConfigError(configPath, "not found");
      }
      console.warn(`Config file not found at "${configPath}", using defaults.`);
    } else if (err instanceof Deno.errors.IsADirectory) {
      if (requireConfig) {
        throw new MissingConfigError(configPath, "path is a directory");
      }
      console.warn(
        `Config path "${configPath}" is a directory, using defaults.`,
      );
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

/**
 * User-facing wrapper: exits the process on MissingConfigError so a strict
 * misconfiguration is loud and fatal in deployments (systemd shows the
 * message in the journal and the unit enters a failed state).
 */
export async function loadConfig(configPath = "config.yml"): Promise<Config> {
  try {
    return await loadConfigStrict(configPath);
  } catch (err) {
    if (err instanceof MissingConfigError) {
      console.error(err.message);
      Deno.exit(1);
    }
    throw err;
  }
}

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
