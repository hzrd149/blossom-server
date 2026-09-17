/**
 * Resolves the signer used for BUD-11 auth events.
 *
 * A kind 24242 signature is required for every authenticated request, but that
 * is not something the person dropping a file on the page should have to solve
 * first. Uploading therefore never asks a question: with no signer, a key is
 * generated, stored in localStorage, and used immediately.
 *
 * Signing in with a NIP-07 extension or a NIP-46 remote signer is a separate,
 * deliberate act — the button in IdentityBar — and never happens mid-upload.
 *
 * A generated key is a real identity as far as the server is concerned: it owns
 * the blobs it uploads and can delete them. It is only rejected when
 * `upload.requirePubkeyInRule` restricts uploads to known pubkeys, in which
 * case the upload fails with the server's own 403 and its X-Reason text.
 */
import { useEffect, useState } from "@hono/hono/jsx/dom";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import { npubEncode, nsecEncode } from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from "./types.ts";
import { getNostrProvider } from "./auth.ts";

const STORAGE_KEY = "blossom.identity.v1";
const HEX_32_RE = /^[0-9a-f]{64}$/i;

type StoredIdentity =
  | { kind: "extension" | "remote"; pubkey: string }
  | { kind: "local"; sk: string };

/**
 * window.nostr.js marks its own shim with `isWnj` and removes itself entirely
 * when a real extension is present, so exactly one of these is ever true.
 * Both are checked at the moment of use: extensions inject on their own
 * schedule, and window.nostr.js installs from a mount callback.
 */
export function hasExtension(): boolean {
  const nostr = getNostrProvider();
  return !!nostr && !nostr.isWnj;
}

export function hasRemoteSigner(): boolean {
  return getNostrProvider()?.isWnj === true;
}

function localSigner(skHex: string): Signer {
  const sk = hexToBytes(skHex);
  const pubkey = getPublicKey(sk);
  return {
    kind: "local",
    pubkey,
    npub: npubEncode(pubkey),
    nsec: nsecEncode(sk),
    signEvent: (event) => Promise.resolve(finalizeEvent(event, sk)),
  };
}

/**
 * Reads window.nostr at sign time rather than capturing it, so a remote signer
 * that reconnects — or an extension that loads late — still works.
 */
function providerSigner(kind: "extension" | "remote", pubkey: string): Signer {
  return {
    kind,
    pubkey,
    npub: npubEncode(pubkey),
    signEvent: async (event) => {
      const nostr = getNostrProvider();
      if (!nostr) throw new Error("Signer is no longer available");
      const signed = await nostr.signEvent(event);
      if (!isValidSignedEvent(signed, event)) {
        throw new Error("Signer returned an invalid event");
      }

      const actualKind = nostr.isWnj ? "remote" : "extension";
      if (actualKind !== kind || signed.pubkey !== pubkey) {
        const adopted = providerSigner(actualKind, signed.pubkey);
        writeStored({ kind: actualKind, pubkey: signed.pubkey });
        setIdentity(adopted);
      }

      return signed;
    },
  };
}

function isValidSignedEvent(
  signed: SignedNostrEvent,
  unsigned: UnsignedNostrEvent,
): boolean {
  return HEX_32_RE.test(signed?.pubkey) &&
    signed.kind === unsigned.kind &&
    signed.content === unsigned.content &&
    signed.created_at === unsigned.created_at &&
    JSON.stringify(signed.tags) === JSON.stringify(unsigned.tags) &&
    verifyEvent(signed);
}

function readStored(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (parsed?.kind === "local" && HEX_32_RE.test(parsed.sk)) return parsed;
    if (
      (parsed?.kind === "extension" || parsed?.kind === "remote") &&
      HEX_32_RE.test(parsed.pubkey)
    ) return parsed;
    return null;
  } catch {
    // Corrupt entry, or localStorage blocked entirely (private browsing). Treat
    // as signed out — a fresh key per page load still works.
    return null;
  }
}

function writeStored(value: StoredIdentity | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Non-fatal: the in-memory signer still serves this page load.
  }
}

function restore(): Signer | null {
  const stored = readStored();
  if (!stored) return null;
  try {
    // Deliberately not gated on the provider being present yet: this runs at
    // module load, before window.nostr.js has installed its shim.
    return stored.kind === "local"
      ? localSigner(stored.sk)
      : providerSigner(stored.kind, stored.pubkey);
  } catch {
    return null;
  }
}

let _current: Signer | null = restore();
const listeners = new Set<() => void>();

export function getIdentity(): Signer | null {
  return _current;
}

function setIdentity(signer: Signer | null): void {
  _current = signer;
  for (const fn of listeners) fn();
}

/** Generate a key, persist it, and sign in with it. */
export function createLocalIdentity(): Signer {
  const skHex = bytesToHex(generateSecretKey());
  writeStored({ kind: "local", sk: skHex });
  const signer = localSigner(skHex);
  setIdentity(signer);
  return signer;
}

/**
 * Sign in with whichever provider window.nostr currently is.
 *
 * For a remote signer this getPublicKey() call is what opens the
 * window.nostr.js connect UI, which is why it only ever runs from an explicit
 * button press.
 */
export async function signInWithProvider(): Promise<Signer> {
  const nostr = getNostrProvider();
  if (typeof nostr?.getPublicKey !== "function") {
    throw new Error("No signer available");
  }
  const kind = nostr.isWnj ? "remote" : "extension";
  const pubkey = await nostr.getPublicKey();
  if (!HEX_32_RE.test(pubkey)) {
    throw new Error("Signer returned an invalid public key");
  }
  writeStored({ kind, pubkey });
  const signer = providerSigner(kind, pubkey);
  setIdentity(signer);
  return signer;
}

export function signOut(): void {
  writeStored(null);
  setIdentity(null);
}

/**
 * The signer to upload with. Never prompts, never returns null — signing in is
 * a separate, opt-in action.
 */
export function ensureIdentity(): Signer {
  return _current ?? createLocalIdentity();
}

export function useIdentity(): Signer | null {
  const [signer, setSigner] = useState<Signer | null>(getIdentity());
  useEffect(() => {
    const fn = () => setSigner(getIdentity());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return signer;
}
