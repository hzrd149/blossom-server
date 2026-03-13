/**
 * Lightweight debug logger.
 * Enabled by setting the DEBUG environment variable to any non-empty value.
 *
 * Usage:
 *   import { debug } from "../middleware/debug.ts";
 *   debug("[upload:123]", "rejected: file too large");
 */

const enabled = Boolean(Deno.env.get("DEBUG"));

export function debug(...args: unknown[]): void {
  if (enabled) console.debug(...args);
}
