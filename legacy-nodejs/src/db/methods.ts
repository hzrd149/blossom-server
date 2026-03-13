import dayjs from "dayjs";
import db from "./db.js";

export async function updateBlobAccess(blob: string, accessed = dayjs().unix()) {
  db.prepare(`INSERT or replace INTO accessed (blob, timestamp) VALUES (?, ?)`).run(blob, accessed);
}
export async function forgetBlobAccessed(blob: string) {
  db.prepare(`DELETE FROM accessed WHERE blob = ?`).run(blob);
}
