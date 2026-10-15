import { assertEquals } from "@std/assert";
import type { StorageRule } from "../../src/config/schema.ts";
import { getFileRule, isPubkeyScoped, pubkeyAllowedByRules } from "../../src/prune/rules.ts";

const MEMBER = "a".repeat(64);
const STRANGER = "b".repeat(64);

/** A nip05 rule whose fetch has not succeeded yet: pubkeys is still empty. */
const pendingNip05Rule = (): StorageRule => ({ type: "*", expiration: "1 year", pubkeys: [], nip05Domains: ["example.org"] });

Deno.test("isPubkeyScoped: nip05 rules are scoped even while empty; explicit empty pubkeys without domains are not", () => {
  assertEquals(isPubkeyScoped({ type: "*", expiration: "1 week" }), false);
  assertEquals(isPubkeyScoped({ type: "*", expiration: "1 week", pubkeys: [] }), false);
  assertEquals(isPubkeyScoped({ type: "*", expiration: "1 week", pubkeys: [MEMBER] }), true);
  assertEquals(isPubkeyScoped({ type: "*", expiration: "1 week", nip05Domains: ["example.org"] }), true);
  assertEquals(isPubkeyScoped(pendingNip05Rule()), true);
});

Deno.test("getFileRule: a pending nip05 rule never matches a stranger, even with requirePubkeyInRule=false", () => {
  const nip05 = pendingNip05Rule();
  const fallback: StorageRule = { type: "image/*", expiration: "1 week" };

  assertEquals(getFileRule({ mimeType: "image/png", pubkey: STRANGER }, [nip05, fallback], false), fallback);
  assertEquals(getFileRule({ mimeType: "image/png" }, [nip05, fallback], false), fallback);
  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: STRANGER }, [nip05, fallback], false), null);
  assertEquals(getFileRule({ mimeType: "image/png", pubkey: STRANGER }, [nip05], false), null);
});

Deno.test("getFileRule: a populated nip05 rule matches its members only", () => {
  const nip05: StorageRule = { ...pendingNip05Rule(), pubkeys: [MEMBER] };
  const fallback: StorageRule = { type: "*", expiration: "1 week" };

  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: MEMBER }, [nip05, fallback], false), nip05);
  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: STRANGER }, [nip05, fallback], false), fallback);
  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: STRANGER }, [nip05, fallback], true), null);
});

Deno.test("getFileRule: explicit empty pubkeys without nip05Domains still behaves as an unscoped rule", () => {
  const unscoped: StorageRule = { type: "*", expiration: "1 week", pubkeys: [] };

  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: STRANGER }, [unscoped], false), unscoped);
  assertEquals(getFileRule({ mimeType: "text/plain" }, [unscoped], false), unscoped);
  assertEquals(getFileRule({ mimeType: "text/plain", pubkey: STRANGER }, [unscoped], true), null);
});

Deno.test("pubkeyAllowedByRules: a pending nip05 rule allows nobody; a populated one allows its members", () => {
  assertEquals(pubkeyAllowedByRules(STRANGER, [pendingNip05Rule()], true), false);
  assertEquals(pubkeyAllowedByRules(MEMBER, [{ ...pendingNip05Rule(), pubkeys: [MEMBER] }], true), true);
  assertEquals(pubkeyAllowedByRules(STRANGER, [{ ...pendingNip05Rule(), pubkeys: [MEMBER] }], true), false);
  assertEquals(pubkeyAllowedByRules(STRANGER, [pendingNip05Rule()], false), true);
});
