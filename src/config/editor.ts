/**
 * config.yml editing for the admin console.
 *
 * Storage rules live only in the config file. The console renders a new file by
 * replacing `storage.rules` in the raw (uninterpolated) YAML document, so comments,
 * formatting, and ${ENV_VAR} placeholders elsewhere in the file survive. When the
 * file is writable the server writes it back; otherwise the console offers the
 * rendered text for the operator to copy into place.
 */

import { dirname, join } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import { Document, isMap, parseDocument } from "yaml";
import type { ConfiguredStorageRule } from "../policy/rule-schema.ts";

export interface ConfigFileState {
  /** Path the server was started with, or null when no config path is known (tests, embedded use). */
  path: string | null;
  exists: boolean;
  /** The file exists and this process can open it for writing. */
  writable: boolean;
  /** Raw file text; empty when the file does not exist. */
  text: string;
  /** SHA-256 of `text`; null when the file does not exist. Used as an optimistic-concurrency token. */
  hash: string | null;
}

/** The file changed on disk since the client read it. */
export class ConfigChangedError extends Error {
  constructor() {
    super("config.yml changed on disk since it was loaded; reload and retry");
    this.name = "ConfigChangedError";
  }
}

/** The config file cannot be written by this process (read-only mount, Nix store, missing file). */
export class ConfigNotWritableError extends Error {
  constructor(path: string | null) {
    super(path ? `Config file "${path}" is not writable by the server` : "No config file path is known to the server");
    this.name = "ConfigNotWritableError";
  }
}

export async function hashText(text: string): Promise<string> {
  return encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function canOpenForWrite(path: string): Promise<boolean> {
  try {
    const file = await Deno.open(path, { write: true });
    file.close();
    return true;
  } catch {
    return false;
  }
}

export async function readConfigFile(path: string | null | undefined): Promise<ConfigFileState> {
  if (!path) return { path: null, exists: false, writable: false, text: "", hash: null };
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.IsADirectory) {
      return { path, exists: false, writable: false, text: "", hash: null };
    }
    throw err;
  }
  return { path, exists: true, writable: await canOpenForWrite(path), text, hash: await hashText(text) };
}

/**
 * Canonical config form of a rule: field order fixed, defaults omitted
 * (`enabled: true`, empty `note`/`pubkeys`/`nip05Domains`).
 */
export function cleanRule(rule: ConfiguredStorageRule): ConfiguredStorageRule {
  const note = rule.note?.trim();
  return {
    type: rule.type,
    expiration: rule.expiration,
    ...(rule.basis ? { basis: rule.basis } : {}),
    ...(rule.pubkeys?.length ? { pubkeys: rule.pubkeys } : {}),
    ...(rule.nip05Domains?.length ? { nip05Domains: rule.nip05Domains } : {}),
    ...(rule.enabled === false ? { enabled: false } : {}),
    ...(note ? { note } : {}),
  };
}

function parseDocumentStrict(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`config.yml is not valid YAML: ${doc.errors[0].message}`);
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error("config.yml must contain a YAML mapping");
  return doc;
}

/** Return `text` with `storage.rules` replaced by `rules`, preserving everything else in the document. */
export function renderConfigWithRules(text: string, rules: readonly ConfiguredStorageRule[]): string {
  const doc = parseDocumentStrict(text);
  doc.setIn(["storage", "rules"], doc.createNode(rules.map(cleanRule)));
  return String(doc);
}

/** A minimal `storage.rules` YAML snippet, for operators who prefer to paste only the rules. */
export function renderRulesSnippet(rules: readonly ConfiguredStorageRule[]): string {
  const doc = new Document({ storage: { rules: rules.map(cleanRule) } });
  return String(doc);
}

// Serialize writes within this process so two saves cannot interleave.
let _writeLock: Promise<unknown> = Promise.resolve();

/**
 * Replace the config file with `text` if its current contents still hash to
 * `expectedHash`. Writes a sibling temp file and renames it over the original
 * (preserving the file mode); when that is impossible, e.g. a single-file bind
 * mount, falls back to rewriting the file in place. Returns the new hash.
 */
export function writeConfigFile(path: string, text: string, expectedHash: string): Promise<string> {
  const run = _writeLock.then(async () => {
    const current = await readConfigFile(path);
    if (!current.writable) throw new ConfigNotWritableError(path);
    if (current.hash !== expectedHash) throw new ConfigChangedError();

    // Write through symlinks (e.g. config.yml -> dotfiles) instead of replacing the link.
    const target = await Deno.realPath(path);
    const { mode } = await Deno.stat(target);
    const tmp = join(dirname(target), `.${crypto.randomUUID()}.config.tmp`);
    try {
      await Deno.writeTextFile(tmp, text, { createNew: true, mode: mode ?? 0o644 });
      if (mode !== null) await Deno.chmod(tmp, mode & 0o7777);
      await Deno.rename(tmp, target);
    } catch {
      await Deno.remove(tmp).catch(() => {});
      await Deno.writeTextFile(target, text);
    }
    return await hashText(text);
  });
  _writeLock = run.catch(() => {});
  return run;
}
