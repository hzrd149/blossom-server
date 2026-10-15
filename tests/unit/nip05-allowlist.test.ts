import { assertEquals, assertRejects } from "@std/assert";
import type { StorageRule } from "../../src/config/schema.ts";
import { createNip05Allowlist, fetchNip05Pubkeys, type Nip05Allowlist, startNip05Refresh } from "../../src/allowlist/nip05.ts";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const STATIC = "d".repeat(64);

type FetchImpl = typeof fetch;

/** A fetchImpl that serves a fixed JSON body (or status) and counts calls per URL. */
function jsonFetch(body: unknown, status = 200): FetchImpl & { calls: string[] } {
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
  }) as FetchImpl & { calls: string[] };
  impl.calls = calls;
  return impl;
}

function rawFetch(text: string, status = 200): FetchImpl {
  return (() => Promise.resolve(new Response(text, { status }))) as FetchImpl;
}

/** A fetchImpl that never resolves until the request signal aborts. */
function hangingFetch(): FetchImpl {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    })) as FetchImpl;
}

function sorted(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

// ---------------------------------------------------------------------------
// fetchNip05Pubkeys
// ---------------------------------------------------------------------------

Deno.test("fetchNip05Pubkeys: requests the well-known URL with a JSON accept header", async () => {
  let seenUrl = "";
  let seenAccept: string | null = null;
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seenAccept = new Headers(init?.headers).get("accept");
    return Promise.resolve(new Response(JSON.stringify({ names: { alice: ALICE } })));
  }) as FetchImpl;

  const pubkeys = await fetchNip05Pubkeys("Example.ORG", { fetchImpl, timeoutMs: 1000 });

  assertEquals(seenUrl, "https://example.org/.well-known/nostr.json");
  assertEquals(seenAccept, "application/json");
  assertEquals([...pubkeys], [ALICE]);
});

Deno.test("fetchNip05Pubkeys: skips invalid values and lowercases uppercase hex", async () => {
  const fetchImpl = jsonFetch({
    names: {
      alice: ALICE.toUpperCase(),
      bob: BOB,
      short: "abc",
      notHex: "g".repeat(64),
      npub: "npub1" + "q".repeat(58),
      number: 42,
      nothing: null,
    },
  });

  const pubkeys = await fetchNip05Pubkeys("example.org", { fetchImpl, timeoutMs: 1000 });

  assertEquals([...pubkeys].sort(), [ALICE, BOB]);
});

Deno.test("fetchNip05Pubkeys: missing names map yields an empty set", async () => {
  const pubkeys = await fetchNip05Pubkeys("example.org", { fetchImpl: jsonFetch({ relays: {} }), timeoutMs: 1000 });
  assertEquals(pubkeys.size, 0);
});

Deno.test("fetchNip05Pubkeys: non-2xx response throws", async () => {
  await assertRejects(
    () => fetchNip05Pubkeys("example.org", { fetchImpl: jsonFetch({ names: {} }, 500), timeoutMs: 1000 }),
    Error,
    "HTTP 500",
  );
});

Deno.test("fetchNip05Pubkeys: non-JSON and non-object bodies throw", async () => {
  await assertRejects(
    () => fetchNip05Pubkeys("example.org", { fetchImpl: rawFetch("<html>nope</html>"), timeoutMs: 1000 }),
    Error,
    "not valid JSON",
  );
  await assertRejects(
    () => fetchNip05Pubkeys("example.org", { fetchImpl: rawFetch("[1,2,3]"), timeoutMs: 1000 }),
    Error,
    "not a JSON object",
  );
});

Deno.test("fetchNip05Pubkeys: times out via the request signal", async () => {
  await assertRejects(() => fetchNip05Pubkeys("example.org", { fetchImpl: hangingFetch(), timeoutMs: 20 }));
});

Deno.test("fetchNip05Pubkeys: rejects domains that smuggle a path or query", async () => {
  const fetchImpl = jsonFetch({ names: { alice: ALICE } });
  await assertRejects(() => fetchNip05Pubkeys("example.org/evil?x=", { fetchImpl, timeoutMs: 1000 }), Error, "Invalid NIP-05 domain");
  await assertRejects(() => fetchNip05Pubkeys("user:pw@example.org", { fetchImpl, timeoutMs: 1000 }), Error, "Invalid NIP-05 domain");
  assertEquals(fetchImpl.calls.length, 0);
});

Deno.test("fetchNip05Pubkeys: asks fetch to fail on redirects and treats a redirect response as a failure", async () => {
  let seenRedirect: RequestRedirect | undefined;
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
    seenRedirect = init?.redirect;
    return Promise.resolve(new Response(null, { status: 301, headers: { location: "https://elsewhere.example/nostr.json" } }));
  }) as FetchImpl;

  await assertRejects(() => fetchNip05Pubkeys("example.org", { fetchImpl, timeoutMs: 1000 }), Error, "HTTP 301");
  assertEquals(seenRedirect, "error");
});

Deno.test("createNip05Allowlist: a redirecting domain keeps the previously fetched set", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["example.org"] };
  let current: FetchImpl = jsonFetch({ names: { alice: ALICE } });
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => current(input, init)) as FetchImpl;
  const allowlist = createNip05Allowlist([rule], { fetchImpl, timeoutMs: 1000 });

  await allowlist.refresh();
  current = (() => Promise.resolve(Response.redirect("https://elsewhere.example/nostr.json", 301))) as FetchImpl;
  const { domains } = await allowlist.refresh();

  assertEquals(domains, [{ domain: "example.org", count: 1, error: "HTTP 301", changed: false }]);
  assertEquals(rule.pubkeys, [ALICE]);
});

Deno.test("createNip05Allowlist: IDN domains are normalized to punycode and fetched once", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["Bücher.example", "xn--bcher-kva.example"] };
  const fetchImpl = jsonFetch({ names: { alice: ALICE } });
  const allowlist = createNip05Allowlist([rule], { fetchImpl, timeoutMs: 1000 });

  assertEquals(allowlist.domains, ["xn--bcher-kva.example"]);
  await allowlist.refresh();
  assertEquals(fetchImpl.calls, ["https://xn--bcher-kva.example/.well-known/nostr.json"]);
  assertEquals(rule.pubkeys, [ALICE]);
});

// ---------------------------------------------------------------------------
// createNip05Allowlist
// ---------------------------------------------------------------------------

Deno.test("createNip05Allowlist: merges static and fetched pubkeys, deduped", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", pubkeys: [STATIC, ALICE], nip05Domains: ["example.org"] };
  const allowlist = createNip05Allowlist([rule], { fetchImpl: jsonFetch({ names: { alice: ALICE, bob: BOB } }), timeoutMs: 1000 });

  const { domains } = await allowlist.refresh();

  assertEquals(domains, [{ domain: "example.org", count: 2, changed: true }]);
  assertEquals(sorted(rule.pubkeys), [ALICE, BOB, STATIC]);
});

Deno.test("createNip05Allowlist: rules without nip05Domains are untouched", async () => {
  const plain: StorageRule = { type: "image/*", expiration: "1 month", pubkeys: [STATIC] };
  const unscoped: StorageRule = { type: "*", expiration: "1 week" };
  const scoped: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["example.org"] };
  const allowlist = createNip05Allowlist([plain, unscoped, scoped], { fetchImpl: jsonFetch({ names: { alice: ALICE } }), timeoutMs: 1000 });

  await allowlist.refresh();

  assertEquals(plain.pubkeys, [STATIC]);
  assertEquals(unscoped.pubkeys, undefined);
  assertEquals(scoped.pubkeys, [ALICE]);
});

Deno.test("createNip05Allowlist: first-ever failure leaves only the static pubkeys (fail closed)", async () => {
  const withStatic: StorageRule = { type: "*", expiration: "1 year", pubkeys: [STATIC], nip05Domains: ["example.org"] };
  const withoutStatic: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["example.org"] };
  const allowlist = createNip05Allowlist([withStatic, withoutStatic], { fetchImpl: jsonFetch({}, 500), timeoutMs: 1000 });

  const { domains } = await allowlist.refresh();

  assertEquals(domains, [{ domain: "example.org", count: 0, error: "HTTP 500", changed: false }]);
  assertEquals(withStatic.pubkeys, [STATIC]);
  assertEquals(withoutStatic.pubkeys, []);
});

Deno.test("createNip05Allowlist: a failed refresh keeps the previously fetched set and reports the error", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["example.org"] };
  let current: FetchImpl = jsonFetch({ names: { alice: ALICE, bob: BOB } });
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => current(input, init)) as FetchImpl;
  const allowlist = createNip05Allowlist([rule], { fetchImpl, timeoutMs: 20 });

  await allowlist.refresh();
  assertEquals(sorted(rule.pubkeys), [ALICE, BOB]);

  for (const failing of [jsonFetch({}, 500), rawFetch("not json"), hangingFetch()]) {
    current = failing;
    const { domains } = await allowlist.refresh();
    assertEquals(domains[0].count, 2);
    assertEquals(domains[0].changed, false);
    assertEquals(typeof domains[0].error, "string");
    assertEquals(sorted(rule.pubkeys), [ALICE, BOB]);
  }
});

Deno.test("createNip05Allowlist: a pubkey removed from nostr.json disappears after refresh", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", pubkeys: [STATIC], nip05Domains: ["example.org"] };
  let names: Record<string, string> = { alice: ALICE, bob: BOB };
  const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ names })))) as FetchImpl;
  const allowlist = createNip05Allowlist([rule], { fetchImpl, timeoutMs: 1000 });

  await allowlist.refresh();
  assertEquals(sorted(rule.pubkeys), [ALICE, BOB, STATIC]);

  names = { alice: ALICE };
  const second = await allowlist.refresh();
  assertEquals(second.domains[0], { domain: "example.org", count: 1, changed: true });
  assertEquals(sorted(rule.pubkeys), [ALICE, STATIC]);

  const third = await allowlist.refresh();
  assertEquals(third.domains[0].changed, false);
});

Deno.test("createNip05Allowlist: two rules sharing a domain cause one fetch per refresh", async () => {
  const images: StorageRule = { type: "image/*", expiration: "1 year", nip05Domains: ["example.org", "Example.org "] };
  const rest: StorageRule = { type: "*", expiration: "1 month", pubkeys: [STATIC], nip05Domains: ["example.org", "other.net"] };
  const fetchImpl = jsonFetch({ names: { alice: ALICE } });
  const allowlist = createNip05Allowlist([images, rest], { fetchImpl, timeoutMs: 1000 });

  assertEquals(allowlist.domains, ["example.org", "other.net"]);

  await allowlist.refresh();
  assertEquals(fetchImpl.calls.sort(), [
    "https://example.org/.well-known/nostr.json",
    "https://other.net/.well-known/nostr.json",
  ]);
  assertEquals(images.pubkeys, [ALICE]);
  assertEquals(sorted(rest.pubkeys), [ALICE, STATIC]);

  await allowlist.refresh();
  assertEquals(fetchImpl.calls.length, 4);
});

Deno.test("createNip05Allowlist: pubkeys from several domains are unioned into one rule", async () => {
  const rule: StorageRule = { type: "*", expiration: "1 year", nip05Domains: ["a.example", "b.example"] };
  const fetchImpl = ((input: string | URL | Request) => {
    const names = String(input).startsWith("https://a.example/") ? { alice: ALICE } : { bob: BOB, carol: CAROL };
    return Promise.resolve(new Response(JSON.stringify({ names })));
  }) as FetchImpl;
  const allowlist = createNip05Allowlist([rule], { fetchImpl, timeoutMs: 1000 });

  await allowlist.refresh();

  assertEquals(sorted(rule.pubkeys), [ALICE, BOB, CAROL]);
});

Deno.test("createNip05Allowlist: no rules with nip05Domains is a no-op", async () => {
  const fetchImpl = jsonFetch({ names: { alice: ALICE } });
  const allowlist = createNip05Allowlist([{ type: "*", expiration: "1 week" }], { fetchImpl, timeoutMs: 1000 });

  const { domains } = await allowlist.refresh();

  assertEquals(domains, []);
  assertEquals(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------
// startNip05Refresh
// ---------------------------------------------------------------------------

/** Manual timer queue so the loop can be driven deterministically. */
function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id: unknown) => {
      pending.delete(id as number);
    },
    /** Fire the oldest pending timer and wait for its async work to settle. */
    async tick() {
      const [id, entry] = [...pending.entries()][0];
      pending.delete(id);
      entry.fn();
      // The run callback is async; let its awaits resolve before returning.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function fakeLog() {
  const lines: string[] = [];
  return { lines, log: (msg: string) => lines.push(msg), warn: (msg: string) => lines.push(msg) };
}

Deno.test("startNip05Refresh: schedules the first refresh after intervalMs, re-schedules after each run, logs on change and error", async () => {
  const results: Array<{ domain: string; count: number; error?: string; changed: boolean }> = [];
  let refreshes = 0;
  const allowlist: Nip05Allowlist = {
    domains: ["example.org"],
    refresh: () => {
      refreshes++;
      return Promise.resolve({ domains: results });
    },
  };
  const timers = fakeTimers();
  const log = fakeLog();

  const stop = startNip05Refresh(allowlist, 60_000, { log, timers });
  assertEquals(refreshes, 0);
  assertEquals([...timers.pending.values()][0].ms, 60_000);

  results.splice(0, results.length, { domain: "example.org", count: 3, changed: true });
  await timers.tick();
  assertEquals(refreshes, 1);
  assertEquals(log.lines, ["[nip05] example.org: 3 pubkeys"]);
  assertEquals(timers.pending.size, 1, "next run is scheduled after the current one completes");

  results.splice(0, results.length, { domain: "example.org", count: 3, changed: false });
  await timers.tick();
  assertEquals(refreshes, 2);
  assertEquals(log.lines.length, 1, "unchanged results are not logged");

  results.splice(0, results.length, { domain: "example.org", count: 3, error: "HTTP 502", changed: false });
  await timers.tick();
  assertEquals(log.lines[1], "[nip05] example.org: fetch failed (HTTP 502), keeping 3 cached");

  stop();
  assertEquals(timers.pending.size, 0, "stop() cancels the pending timer");
});

Deno.test("startNip05Refresh: initialDelayMs shortens only the first wait", async () => {
  let refreshes = 0;
  const allowlist: Nip05Allowlist = {
    domains: ["example.org"],
    refresh: () => {
      refreshes++;
      return Promise.resolve({ domains: [] });
    },
  };
  const timers = fakeTimers();

  const stop = startNip05Refresh(allowlist, 600_000, { initialDelayMs: 30_000, log: fakeLog(), timers });
  assertEquals([...timers.pending.values()][0].ms, 30_000);

  await timers.tick();
  assertEquals(refreshes, 1);
  assertEquals([...timers.pending.values()][0].ms, 600_000, "subsequent runs use the full interval");
  stop();
});

Deno.test("startNip05Refresh: stop() during a running refresh prevents re-scheduling", async () => {
  let release: () => void = () => {};
  const allowlist: Nip05Allowlist = {
    domains: [],
    refresh: () =>
      new Promise((resolve) => {
        release = () => resolve({ domains: [] });
      }),
  };
  const timers = fakeTimers();

  const stop = startNip05Refresh(allowlist, 60_000, { log: fakeLog(), timers });
  const [, entry] = [...timers.pending.entries()][0];
  timers.pending.clear();
  entry.fn(); // refresh now in flight
  stop();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(timers.pending.size, 0);
});

Deno.test("startNip05Refresh: a throwing refresh is logged and the loop continues", async () => {
  const allowlist: Nip05Allowlist = {
    domains: [],
    refresh: () => Promise.reject(new Error("boom")),
  };
  const timers = fakeTimers();
  const log = fakeLog();

  const stop = startNip05Refresh(allowlist, 60_000, { log, timers });
  await timers.tick();

  assertEquals(log.lines, ["[nip05] Unexpected error in refresh loop: boom"]);
  assertEquals(timers.pending.size, 1);
  stop();
});
