import { assertEquals, assertRejects } from "@std/assert";
import { authorizationBatches, createLimiter } from "./scheduler.ts";
import { batchAuthorization } from "./auth.ts";
import type { SignedNostrEvent, Signer } from "./types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

Deno.test("limiter refills a free slot without waiting for a slow sibling", async () => {
  const run = createLimiter(2);
  const slow = deferred();
  const fast = deferred();
  const thirdStarted = deferred();
  const started: number[] = [];
  const first = run(async () => {
    started.push(1);
    await slow.promise;
  });
  const second = run(async () => {
    started.push(2);
    await fast.promise;
  });
  const third = run(() => {
    started.push(3);
    thirdStarted.resolve();
    return Promise.resolve();
  });
  assertEquals(started, [1, 2]);
  fast.resolve();
  await thirdStarted.promise;
  assertEquals(started, [1, 2, 3]);
  slow.resolve();
  await Promise.all([first, second, third]);
});

Deno.test("limiter releases slots after rejection and preserves FIFO order", async () => {
  const run = createLimiter(1);
  const gate = deferred();
  const order: number[] = [];
  const failed = run(async () => {
    await gate.promise;
    throw new Error("failed");
  });
  const checked = assertRejects(() => failed, Error, "failed");
  const jobs = [1, 2, 3].map((n) =>
    run(() => {
      order.push(n);
      return Promise.resolve();
    })
  );
  assertEquals(order, []);
  gate.resolve();
  await Promise.all([checked, ...jobs]);
  assertEquals(order, [1, 2, 3]);
});

Deno.test("authorization batches count unique hashes rather than mirror items", () => {
  const items = [["a", "b"], ["b", "c"], ["d"], ["d", "e"]];
  assertEquals(authorizationBatches(items, (hashes) => hashes, 3), [
    [items[0], items[1]],
    [items[2], items[3]],
  ]);
});

Deno.test("authorization reuses one signature and serializes different batches", async () => {
  const gate = deferred();
  let calls = 0;
  const signer: Signer = {
    kind: "local",
    pubkey: "test",
    npub: "test",
    signEvent: async (event) => {
      calls++;
      await gate.promise;
      return {
        ...event,
        id: "test",
        pubkey: "test",
        sig: "test",
      } as SignedNostrEvent;
    },
  };
  const first = batchAuthorization(signer, ["a", "a"], "upload", "Upload");
  const second = batchAuthorization(signer, ["b"], "upload", "Upload");
  const requests = [first(), first(), second()];
  assertEquals(calls, 1);
  gate.resolve();
  const headers = await Promise.all(requests);
  assertEquals(calls, 2);
  assertEquals(headers[0], headers[1]);
  assertEquals(await first(), headers[0]);
  assertEquals(calls, 2);
  const event = JSON.parse(atob(headers[0].slice(6)));
  assertEquals(event.tags.filter((tag: string[]) => tag[0] === "x"), [[
    "x",
    "a",
  ]]);
});
