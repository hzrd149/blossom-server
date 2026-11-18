/// <reference lib="deno.ns" />

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import * as identity from "./identity.ts";
import type { NostrProvider, UnsignedNostrEvent } from "./types.ts";

const STORAGE_KEY = "blossom.identity.v1";

Deno.test("identity disposes anonymous keys and adopts the provider that signs", async () => {
  const originalProvider = globalThis.nostr;
  localStorage.removeItem(STORAGE_KEY);

  try {
    identity.signOut();
    const anonymous = identity.createLocalIdentity();
    const storedAnonymous = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    assertEquals(storedAnonymous.kind, "local");
    assertEquals(typeof storedAnonymous.sk, "string");

    globalThis.nostr = {
      getPublicKey: () => Promise.reject(new Error("cancelled")),
      signEvent: () => Promise.reject(new Error("unused")),
    } satisfies NostrProvider;
    await assertRejects(
      () => identity.signInWithProvider(),
      Error,
      "cancelled",
    );
    assertEquals(identity.getIdentity()?.pubkey, anonymous.pubkey);
    assertEquals(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!),
      storedAnonymous,
    );

    const firstSecret = generateSecretKey();
    const firstPubkey = getPublicKey(firstSecret);
    globalThis.nostr = {
      getPublicKey: () => Promise.resolve(firstPubkey),
      signEvent: (event) => Promise.resolve(finalizeEvent(event, firstSecret)),
    } satisfies NostrProvider;

    await identity.signInWithProvider();
    assertEquals(identity.getIdentity()?.pubkey, firstPubkey);
    assertEquals(identity.getIdentity()?.kind, "extension");
    assertEquals(identity.getIdentity()?.nsec, undefined);
    assertEquals(
      localStorage.getItem(STORAGE_KEY)?.includes(storedAnonymous.sk),
      false,
    );

    const replacementSecret = generateSecretKey();
    const replacementPubkey = getPublicKey(replacementSecret);
    let replacementCalled = false;
    globalThis.nostr = {
      isWnj: true,
      getPublicKey: () => Promise.resolve(replacementPubkey),
      signEvent: (event) => {
        replacementCalled = true;
        return Promise.resolve(finalizeEvent(event, replacementSecret));
      },
    } satisfies NostrProvider;

    const event: UnsignedNostrEvent = {
      kind: 24242,
      content: "Upload files",
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", "upload"], [
        "expiration",
        String(Math.floor(Date.now() / 1000) + 300),
      ]],
    };
    const signed = await identity.getIdentity()!.signEvent(event);

    assertEquals(replacementCalled, true);
    assertEquals(signed.pubkey, replacementPubkey);
    assertEquals(identity.getIdentity()?.pubkey, replacementPubkey);
    assertEquals(identity.getIdentity()?.kind, "remote");
    assertEquals(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!),
      { kind: "remote", pubkey: replacementPubkey },
    );

    identity.signOut();
    const nextAnonymous = identity.ensureIdentity();
    assertEquals(nextAnonymous.kind, "local");
    assertNotEquals(nextAnonymous.pubkey, anonymous.pubkey);
  } finally {
    localStorage.removeItem(STORAGE_KEY);
    globalThis.nostr = originalProvider;
  }
});

Deno.test("identity rejects provider events that alter the authorization", async () => {
  const originalProvider = globalThis.nostr;
  localStorage.removeItem(STORAGE_KEY);

  try {
    identity.signOut();
    const secret = generateSecretKey();
    const pubkey = getPublicKey(secret);
    globalThis.nostr = {
      getPublicKey: () => Promise.resolve(pubkey),
      signEvent: (event) =>
        Promise.resolve(
          finalizeEvent({ ...event, tags: [["t", "delete"]] }, secret),
        ),
    } satisfies NostrProvider;

    const signer = await identity.signInWithProvider();
    await assertRejects(
      () =>
        signer.signEvent({
          kind: 24242,
          content: "Upload files",
          created_at: Math.floor(Date.now() / 1000),
          tags: [["t", "upload"]],
        }),
      Error,
      "Signer returned an invalid event",
    );
    assertEquals(identity.getIdentity()?.pubkey, pubkey);
  } finally {
    localStorage.removeItem(STORAGE_KEY);
    globalThis.nostr = originalProvider;
  }
});
