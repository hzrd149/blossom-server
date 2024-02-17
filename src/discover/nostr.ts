import NDK, { NDKKind } from "@nostr-dev-kit/ndk";
import debug from "debug";
import { BlobPointer, BlobSearch } from "../types.js";
import { config } from "../config.js";

const ndk = new NDK({
  explicitRelayUrls: config.discovery.nostr.relays,
});
await ndk.connect();

const log = debug("cdn:discover:nostr");

export async function search(search: BlobSearch) {
  log("Looking for", search.hash);
  const pointers: BlobPointer[] = [];

  const events = Array.from(
    await ndk.fetchEvents({
      kinds: [NDKKind.Media],
      "#x": [search.hash],
    }),
  );
  const cdnList = search.pubkey ? await getUserCDNList(search.pubkey) : [];

  if (events.length > 0) {
    for (const event of events) {
      log(`Found 1063 event by ${event.pubkey}`);
      const url = event.tags.find((t) => t[0] === "url")?.[1];
      const mimeType = event.tags.find((t) => t[0] === "m")?.[1];
      const infohash = event.tags.find((t) => t[0] === "i")?.[1];
      const magnet = event.tags.find((t) => t[0] === "magnet")?.[1];

      if (url) {
        try {
          pointers.push({
            type: "http",
            hash: search.hash,
            url: new URL(url).toString(),
            mimeType,
            metadata: { pubkey: event.pubkey },
          });
        } catch (e) {}
      }

      if (magnet || infohash) {
        pointers.push({
          type: "torrent",
          hash: search.hash,
          magnet,
          infohash,
          mimeType,
          metadata: { pubkey: event.pubkey },
        });
      }
    }
  }

  if (cdnList) {
    log("Found pubkey cdn list", search.pubkey, cdnList);

    for (const cdn of cdnList) {
      pointers.push({
        type: "http",
        hash: search.hash,
        url: new URL(search.hash + (search.ext || ""), cdn).toString(),
        metadata: { pubkey: search.pubkey },
      });
    }
  }

  return pointers;
}

export async function getUserCDNList(pubkey: string) {
  const events = await ndk.fetchEvents({
    kinds: [10063 as number],
    authors: [pubkey],
  });

  const cdns = new Set<string>();
  for (const event of events) {
    for (const t of event.tags) {
      if (t[0] === "r" && t[1]) {
        try {
          const url = new URL(t[1]);
          cdns.add(url.toString());
        } catch (e) {}
      }
    }
  }
  return Array.from(cdns);
}
