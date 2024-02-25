import dayjs from "dayjs";
import { JSONFilePreset } from "lowdb/node";
import path from "node:path";

type DBSchema = {
  blobs: Record<string, { expiration?: number; pubkeys?: string[]; created: number; mimeType?: string; size?: number }>;
  usedTokens: Record<string, number>;
};
const db = await JSONFilePreset<DBSchema>(path.join(process.cwd(), "database.json"), {
  blobs: {},
  usedTokens: {},
});
db.data.blobs = db.data.blobs || {};
db.data.usedTokens = db.data.usedTokens || {};
setInterval(() => db.write(), 1000);

export function hasBlobEntry(hash: string) {
  return !!db.data.blobs[hash];
}
export function getOrCreateBlobEntry(hash: string) {
  let blob = db.data.blobs[hash];
  if (!blob) blob = db.data.blobs[hash] = { created: dayjs().unix() };
  return blob;
}
export function setBlobExpiration(hash: string, expiration: number) {
  let blob = getOrCreateBlobEntry(hash);

  if (blob.expiration) blob.expiration = Math.max(blob.expiration, expiration);
  else blob.expiration = expiration;
}
export function setBlobMimetype(hash: string, mimeType: string) {
  let blob = getOrCreateBlobEntry(hash);
  blob.mimeType = mimeType;
}
export function setBlobSize(hash: string, size: number) {
  let blob = getOrCreateBlobEntry(hash);
  blob.size = size;
}
export function addPubkeyToBlob(hash: string, pubkey: string) {
  let blob = getOrCreateBlobEntry(hash);
  if (blob.pubkeys) {
    if (!blob.pubkeys.includes(pubkey)) blob.pubkeys.push(pubkey);
  } else blob.pubkeys = [pubkey];
}
export function removePubkeyFromBlob(hash: string, pubkey: string) {
  let blob = getOrCreateBlobEntry(hash);
  if (blob.pubkeys) {
    if (blob.pubkeys.includes(pubkey)) blob.pubkeys.splice(blob.pubkeys.indexOf(pubkey), 1);
  }
}

export function hasUsedToken(token: string) {
  return db.data.usedTokens[token] !== undefined;
}
export function setUsedToken(token: string, expiration: number) {
  db.data.usedTokens[token] = expiration;
}
export function pruneUsedTokens() {
  const now = dayjs().unix();
  for (const [token, expiration] of Object.entries(db.data.usedTokens)) {
    if (expiration < now) delete db.data.usedTokens[token];
  }
}

export { db };
