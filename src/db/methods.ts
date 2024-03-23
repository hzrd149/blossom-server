import dayjs from "dayjs";
import db from "./db.js";
import { NostrEvent } from "@nostr-dev-kit/ndk";

export async function updateBlobAccess(blob: string, accessed = dayjs().unix()) {
  db.prepare(`INSERT or replace INTO accessed (blob, timestamp) VALUES (?, ?)`).run(blob, accessed);
}
export async function forgetBlobAccessed(blob: string) {
  db.prepare(`DELETE FROM accessed WHERE blob = ?`).run(blob);
}

export async function addToken(token: { id: string; event: NostrEvent; expiration: number; type: string }) {
  db.prepare(`INSERT INTO tokens (id, pubkey, type, expiration, event) VALUES (?, ?, ?, ?, ?)`).run(
    token.id,
    token.event.pubkey,
    token.type,
    token.expiration,
    JSON.stringify(token.event),
  );
}
export function hasUsedToken(token: string) {
  return !!db.prepare(`SELECT * FROM tokens WHERE id = ?`).get(token);
}
