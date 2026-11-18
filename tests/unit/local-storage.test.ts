import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { LocalStorage } from "../../src/storage/local.ts";
import type { WriteSession } from "../../src/storage/interface.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readStreamText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  return await new Response(stream).text();
}

function fakeSession(tmpPath: string): WriteSession {
  return {
    tmpPath,
    writable: new WritableStream<Uint8Array>(),
    done: Promise.resolve(),
  };
}

Deno.test("LocalStorage.commitFile stores an external temp file", async () => {
  const dir = await Deno.makeTempDir();
  const srcPath = await Deno.makeTempFile();
  const storage = new LocalStorage(join(dir, "blobs"));

  try {
    await storage.setup();
    await Deno.writeTextFile(srcPath, "optimized media");

    await storage.commitFile(srcPath, "a".repeat(64), "txt");

    assertEquals(await exists(srcPath), false);
    const stream = await storage.read("a".repeat(64), "txt");
    assertEquals(stream === null, false);
    assertEquals(await readStreamText(stream!), "optimized media");
  } finally {
    await Deno.remove(srcPath).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("LocalStorage.commitFile removes source file on dedup", async () => {
  const dir = await Deno.makeTempDir();
  const firstPath = await Deno.makeTempFile();
  const secondPath = await Deno.makeTempFile();
  const storage = new LocalStorage(join(dir, "blobs"));
  const hash = "b".repeat(64);

  try {
    await storage.setup();
    await Deno.writeTextFile(firstPath, "same blob");
    await Deno.writeTextFile(secondPath, "same blob");

    await storage.commitFile(firstPath, hash, "txt");
    await storage.commitFile(secondPath, hash, "txt");

    assertEquals(await exists(firstPath), false);
    assertEquals(await exists(secondPath), false);
    const stream = await storage.read(hash, "txt");
    assertEquals(stream === null, false);
    assertEquals(await readStreamText(stream!), "same blob");
  } finally {
    await Deno.remove(firstPath).catch(() => {});
    await Deno.remove(secondPath).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("LocalStorage.abortWrite ignores missing files but propagates other removal failures", async () => {
  const dir = await Deno.makeTempDir();
  const storage = new LocalStorage(join(dir, "blobs"));

  try {
    await storage.setup();
    await storage.abortWrite(fakeSession(join(storage.tmpDir, "already-removed")));

    const nonEmptyDir = join(storage.tmpDir, "not-a-file");
    await Deno.mkdir(nonEmptyDir);
    await Deno.writeTextFile(join(nonEmptyDir, "child"), "staged bytes");
    await assertRejects(() => storage.abortWrite(fakeSession(nonEmptyDir)));
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
