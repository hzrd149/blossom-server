import { assertEquals } from "@std/assert";
import { createClient } from "@libsql/client";
import { getMediaDerivative, insertMediaDerivative } from "../../src/db/blobs.ts";

Deno.test("insertMediaDerivative replaces a stale mapping", async () => {
  const db = createClient({ url: ":memory:" });
  const original = "a".repeat(64);
  const staleOptimized = "b".repeat(64);
  const replacementOptimized = "c".repeat(64);

  try {
    await db.execute(`
      CREATE TABLE media_derivatives (
        original_sha256 TEXT PRIMARY KEY,
        optimized_sha256 TEXT NOT NULL
      )
    `);

    await insertMediaDerivative(db, original, staleOptimized);
    await insertMediaDerivative(db, original, replacementOptimized);

    assertEquals(
      await getMediaDerivative(db, original),
      replacementOptimized,
    );
  } finally {
    db.close();
  }
});
