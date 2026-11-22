/**
 * Remove a stored blob for every owner: its database record, its storage file, and its
 * generated thumbnails (records and files). Mirrors DELETE /:sha256 once the last owner is
 * gone. A thumbnail is kept when it still has owners (the same bytes uploaded directly) or is
 * also the thumbnail of another stored blob. Independent of src/admin so moderation works
 * without the console.
 */

import type { ModerationDatabase } from "../db/moderation/index.ts";
import type { IBlobStorage } from "../storage/interface.ts";
import { mimeToExt } from "../utils/mime.ts";

/** Returns the hashes whose records were removed (the blob and its thumbnails). Storage failures are logged, not thrown. */
export async function removeStoredBlob(db: ModerationDatabase, storage: IBlobStorage, sha256: string): Promise<string[]> {
  const blob = await db.getBlob(sha256);
  if (!blob) return [];
  // Decide which thumbnails go before the parent row (and its thumbnail links) is deleted.
  const thumbnails = [];
  for (const thumbnail of await db.getMediaThumbnailsForParent(sha256)) {
    if (!(await db.isThumbnailStillUsed(thumbnail.sha256, sha256))) thumbnails.push(thumbnail);
  }
  const removed: string[] = [];
  if (await db.deleteBlob(sha256)) removed.push(sha256);
  await storage.remove(sha256, mimeToExt(blob.type)).catch((err) => console.warn(`[moderation] Failed to remove blob ${sha256} from storage:`, err));
  for (const thumbnail of thumbnails) {
    if (await db.deleteBlob(thumbnail.sha256)) removed.push(thumbnail.sha256);
    await storage.remove(thumbnail.sha256, mimeToExt(thumbnail.type)).catch((err) =>
      console.warn(`[moderation] Failed to remove thumbnail ${thumbnail.sha256} from storage:`, err)
    );
  }
  return removed;
}
