import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { fetchMirrorOrigin, MirrorFetchError, type MirrorNetwork } from "../../src/routes/mirror.ts";

function literalNetwork(
  fetchImpl: MirrorNetwork["fetch"],
): MirrorNetwork {
  return {
    lookup: () => Promise.reject(new Error("literal addresses must not be resolved")),
    fetch: fetchImpl,
  };
}

async function expectMirrorError(
  promise: Promise<Response>,
  status: 400 | 502,
  message: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("expected mirror fetch to fail");
  } catch (err) {
    assertInstanceOf(err, MirrorFetchError);
    assertEquals(err.status, status);
    assertStringIncludes(err.message, message);
  }
}

Deno.test("fetchMirrorOrigin rejects and does not fetch a private redirect target", async () => {
  let fetches = 0;
  let cancelled = false;
  const network = literalNetwork(() => {
    fetches++;
    return Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 302, headers: { location: "http://127.0.0.1/admin" } },
      ),
    );
  });

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://1.1.1.1/blob"), 0, network),
    400,
    "non-public address",
  );
  assertEquals(fetches, 1);
  assert(cancelled);
});

Deno.test("fetchMirrorOrigin follows relative redirects", async () => {
  const urls: string[] = [];
  const network = literalNetwork((input) => {
    urls.push(input);
    if (urls.length === 1) {
      return Promise.resolve(
        new Response(null, { status: 307, headers: { location: "/next" } }),
      );
    }
    return Promise.resolve(new Response("blob"));
  });

  const response = await fetchMirrorOrigin(
    new URL("https://1.1.1.1/start"),
    0,
    network,
  );
  assertEquals(response.status, 200);
  assertEquals(urls, ["https://1.1.1.1/start", "https://1.1.1.1/next"]);
  await response.body?.cancel();
});

Deno.test("fetchMirrorOrigin rejects unsupported redirect schemes", async () => {
  const network = literalNetwork(() =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "file:///etc/passwd" },
      }),
    )
  );

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://1.1.1.1/blob"), 0, network),
    400,
    "unsupported URL scheme",
  );
});

Deno.test("fetchMirrorOrigin rejects redirects without a location", async () => {
  const network = literalNetwork(() => Promise.resolve(new Response(null, { status: 302 })));

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://1.1.1.1/blob"), 0, network),
    502,
    "without a Location header",
  );
});

Deno.test("fetchMirrorOrigin limits redirect chains", async () => {
  let fetches = 0;
  const network = literalNetwork(() => {
    fetches++;
    return Promise.resolve(
      new Response(null, { status: 308, headers: { location: `/hop-${fetches}` } }),
    );
  });

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://1.1.1.1/start"), 0, network),
    502,
    "exceeded 3 hops",
  );
  assertEquals(fetches, 4);
});

Deno.test("fetchMirrorOrigin does not treat non-redirect 3xx responses as redirects", async () => {
  let fetches = 0;
  const network = literalNetwork(() => {
    fetches++;
    return Promise.resolve(new Response(null, { status: 304 }));
  });

  const response = await fetchMirrorOrigin(
    new URL("https://1.1.1.1/blob"),
    0,
    network,
  );
  assertEquals(response.status, 304);
  assertEquals(fetches, 1);
});

Deno.test("fetchMirrorOrigin rejects private DNS results before fetch", async () => {
  let fetched = false;
  const network: MirrorNetwork = {
    lookup: () =>
      Promise.resolve([
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    fetch: () => {
      fetched = true;
      return Promise.resolve(new Response("unexpected"));
    },
  };

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://example.com/blob"), 0, network),
    400,
    "resolves to IPv4 loopback",
  );
  assertEquals(fetched, false);
});

Deno.test("fetchMirrorOrigin fails closed when DNS lookup fails", async () => {
  let fetched = false;
  const network: MirrorNetwork = {
    lookup: () => Promise.reject(new Error("DNS unavailable")),
    fetch: () => {
      fetched = true;
      return Promise.resolve(new Response("unexpected"));
    },
  };

  try {
    await fetchMirrorOrigin(new URL("https://example.com/blob"), 0, network);
    throw new Error("expected DNS failure");
  } catch (err) {
    assertInstanceOf(err, Error);
    assertStringIncludes(err.message, "DNS unavailable");
  }
  assertEquals(fetched, false);
});

Deno.test("fetchMirrorOrigin applies connect timeout to DNS lookup", async () => {
  let fetched = false;
  const network: MirrorNetwork = {
    lookup: () => new Promise(() => {}),
    fetch: () => {
      fetched = true;
      return Promise.resolve(new Response("unexpected"));
    },
  };

  await expectMirrorError(
    fetchMirrorOrigin(new URL("https://example.com/blob"), 5, network),
    502,
    "within 5ms",
  );
  assertEquals(fetched, false);
});
