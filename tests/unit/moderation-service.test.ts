import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { type Client, createClient } from "@libsql/client";
import { runMigrations } from "../../src/db/client.ts";
import { insertBlob, insertBlobRecord, insertMediaDerivative, insertMediaThumbnail } from "../../src/db/blobs.ts";
import { insertReport } from "../../src/db/reports.ts";
import { LocalStorage } from "../../src/storage/local.ts";
import { ModerationInputError, ModerationService } from "../../src/moderation/service.ts";

const P1 = "1".repeat(64);
const P2 = "2".repeat(64);

const h = (n: number) => n.toString(16).padStart(64, "0");

interface Ctx {
  db: Client;
  storage: LocalStorage;
  dir: string;
  service: ModerationService;
}

async function withService(fn: (ctx: Ctx) => Promise<void>) {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  const dir = await Deno.makeTempDir({ prefix: "blossom-moderation-" });
  const storage = new LocalStorage(dir);
  await storage.setup();
  const service = new ModerationService(db, storage);
  try {
    await service.init();
    await fn({ db, storage, dir, service });
  } finally {
    db.close();
    await Deno.remove(dir, { recursive: true });
  }
}

async function store(ctx: Ctx, sha256: string, owners: string[]) {
  const record = { sha256, size: 4, type: "image/png", uploaded: 1000, nip94: null };
  if (owners.length === 0) await insertBlobRecord(ctx.db, record);
  for (const owner of owners) await insertBlob(ctx.db, record, owner);
  await Deno.writeTextFile(join(ctx.dir, `${sha256}.png`), "blob");
}

async function exists(ctx: Ctx, sha256: string): Promise<{ row: boolean; file: boolean }> {
  const rs = await ctx.db.execute({ sql: "SELECT 1 FROM blobs WHERE sha256 = ?", args: [sha256] });
  return { row: rs.rows.length > 0, file: await ctx.storage.has(sha256, "png") };
}

const page = { page: 1, pageSize: 50 };

Deno.test("pubkey ban with keep leaves content and persists across init", async () => {
  await withService(async (ctx) => {
    await store(ctx, h(1), [P1]);
    const result = await ctx.service.banPubkey({ pubkey: P1, reason: "spam", note: " noisy ", content: "keep" });
    assertEquals(result, { pubkey: P1, removedOwnership: 0, deleted: [] });
    assert(ctx.service.isPubkeyBanned(P1));
    assertEquals(await exists(ctx, h(1)), { row: true, file: true });
    assertEquals((await ctx.service.getBannedPubkey(P1))?.note, "noisy");

    const fresh = new ModerationService(ctx.db, ctx.storage);
    await fresh.init();
    assert(fresh.isPubkeyBanned(P1));

    assertEquals((await ctx.service.listBannedPubkeys(page)).total, 1);
    assert(await ctx.service.unbanPubkey(P1));
    assert(!ctx.service.isPubkeyBanned(P1));
    await assertRejects(() => ctx.service.banPubkey({ pubkey: "nope" }), ModerationInputError);
  });
});

Deno.test("pubkey ban with remove drops ownership and deletes only orphaned blobs", async () => {
  await withService(async (ctx) => {
    await store(ctx, h(1), [P1]);
    await store(ctx, h(2), [P1, P2]);
    await store(ctx, h(3), []);
    await insertMediaThumbnail(ctx.db, h(1), h(3));
    const result = await ctx.service.banPubkey({ pubkey: P1, content: "remove" });
    assertEquals(result.removedOwnership, 2);
    assertEquals(result.deleted.sort(), [h(1), h(3)]);
    assertEquals(await exists(ctx, h(1)), { row: false, file: false });
    assertEquals(await exists(ctx, h(3)), { row: false, file: false });
    assertEquals(await exists(ctx, h(2)), { row: true, file: true });
    const owners = (await ctx.db.execute({ sql: "SELECT pubkey FROM owners WHERE blob = ?", args: [h(2)] })).rows.map((r) => r[0]);
    assertEquals(owners, [P2]);
  });
});

Deno.test("blob ban cascades to original, derivative, and thumbnails, and resolves reports", async () => {
  await withService(async (ctx) => {
    const [original, optimized, thumb] = [h(10), h(11), h(12)];
    await store(ctx, optimized, [P1]);
    await store(ctx, thumb, []);
    await insertMediaDerivative(ctx.db, original, optimized);
    await insertMediaThumbnail(ctx.db, optimized, thumb);
    await insertReport(ctx.db, { event_id: "e".repeat(64), reporter: P2, blob: optimized, type: "illegal", content: "", created: 1 });

    const result = await ctx.service.banBlob({ sha256: optimized, category: "illegal", note: "csam report" });
    assertEquals(result.banned.sort(), [original, optimized, thumb].sort());
    assertEquals(result.deleted.sort(), [optimized, thumb].sort());
    assertEquals(result.reportsResolved, 1);
    assertEquals(await exists(ctx, optimized), { row: false, file: false });
    assertEquals(await exists(ctx, thumb), { row: false, file: false });

    for (const hash of [original, optimized, thumb]) {
      assert(await ctx.service.isHashBanned(hash));
      const ban = await ctx.service.getBannedBlob(hash);
      assertEquals([ban?.category, ban?.note], ["illegal", "csam report"]);
    }
    assert(!(await ctx.service.isHashBanned(h(13))));

    // Re-banning updates the category and keeps the note unless a new one is given.
    await ctx.service.banBlob({ sha256: original, category: "malware" });
    const reban = await ctx.service.getBannedBlob(original);
    assertEquals([reban?.category, reban?.note], ["malware", "csam report"]);
    assertEquals((await ctx.service.listBannedBlobs({ ...page, category: "malware" })).items.map((b) => b.sha256), [original]);
    assertEquals((await ctx.service.listBannedBlobs({ ...page, q: "csam" })).total, 3);

    assert(await ctx.service.unbanBlob(optimized));
    assert(!(await ctx.service.unbanBlob(optimized)));
    assert(!(await ctx.service.isHashBanned(optimized)));
    assertEquals((await ctx.service.listBannedBlobs(page)).total, 2);
    await assertRejects(() => ctx.service.banBlob({ sha256: h(1), category: "bogus" as "spam" }), ModerationInputError);
  });
});

Deno.test("pubkey ban with remove keeps thumbnails still used by another stored blob or owner", async () => {
  await withService(async (ctx) => {
    // One thumbnail per parent. P1 owns X, Z, W; P2 owns Y and V.
    const [parentX, parentY, parentZ, parentW, parentV] = [h(80), h(81), h(82), h(83), h(84)];
    const [sharedThumb, ownThumb, ownedThumb, vThumb] = [h(85), h(86), h(87), h(88)];
    for (const parent of [parentX, parentZ, parentW]) await store(ctx, parent, [P1]);
    for (const parent of [parentY, parentV]) await store(ctx, parent, [P2]);
    await store(ctx, sharedThumb, []);
    await store(ctx, ownThumb, []);
    await store(ctx, ownedThumb, [P2]);
    // P1 also uploaded the bytes of V's thumbnail directly: not an orphan while V uses it.
    await store(ctx, vThumb, [P1]);
    await insertMediaThumbnail(ctx.db, parentX, sharedThumb);
    await insertMediaThumbnail(ctx.db, parentY, sharedThumb);
    await insertMediaThumbnail(ctx.db, parentZ, ownThumb);
    await insertMediaThumbnail(ctx.db, parentW, ownedThumb);
    await insertMediaThumbnail(ctx.db, parentV, vThumb);

    const result = await ctx.service.banPubkey({ pubkey: P1, content: "remove" });
    assertEquals(result.deleted.sort(), [parentX, parentZ, parentW, ownThumb].sort());
    for (const kept of [sharedThumb, ownedThumb, vThumb, parentY, parentV]) assertEquals(await exists(ctx, kept), { row: true, file: true });
    assertEquals(await exists(ctx, ownThumb), { row: false, file: false });
  });
});
