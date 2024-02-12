import NDK, { NDKKind } from "@nostr-dev-kit/ndk";
import debug from "debug";

const RELAYS = process.env.RELAYS?.split(",") || [
  "wss://nostrue.com",
  "wss://relay.damus.io",
  "wss://nostr.wine",
  "wss://nos.lol",
];

const ndk = new NDK({
  explicitRelayUrls: RELAYS,
});
await ndk.connect();

const log = debug("cdn:discover:nostr");

/**
 * find content by sha256 hash
 * @param {string} hash
 * @param {string|undefined} ext
 */
export async function findByHash(hash, ext) {
  log("Looking for", hash + ext);
  const events = Array.from(
    await ndk.fetchEvents({
      kinds: [NDKKind.Media],
      "#x": [hash],
    }),
  );

  if (events.length === 0) return null;
  if (events.length === 1) log("Found event", events[0].id);
  else log(`Found ${events.length} events`);

  const urls = new Set();
  const mimeTypes = new Set();
  const infoHashes = new Set();
  const magnets = new Set();

  for (const event of events) {
    const url = event.tags.find((t) => t[0] === "url")?.[1];
    const mimeType = event.tags.find((t) => t[0] === "m")?.[1];
    const infohash = event.tags.find((t) => t[0] === "i")?.[1];
    const magnet = event.tags.find((t) => t[0] === "magnet")?.[1];

    if (url) {
      try {
        urls.add(new URL(url).toString());
      } catch (e) {}
    }

    if (mimeType) mimeTypes.add(mimeType);
    if (infohash) infoHashes.add(infohash);
    if (magnet) magnets.add(magnet);
  }

  return {
    hash,
    /** @deprecated */
    url: Array.from(urls)[0],
    urls: Array.from(urls),
    /** @deprecated */
    mimeType: Array.from(mimeTypes)[0],
    mimeTypes: Array.from(mimeTypes),
    infohashes: Array.from(infoHashes),
    magnets: Array.from(magnets),
  };
}

export async function getUserCDNs(pubkeys) {
  const events = await ndk.fetchEvents({ kinds: [10016], authors: pubkeys });

  const cdns = new Set();
  for (const event of events) {
    for (const t of event.tags) {
      if ((t) => t[0] === "r" && t[1]) {
        try {
          const url = new URL(t[1]);
          cdns.add(url.toString());
        } catch (e) {}
      }
    }
  }
  return Array.from(cdns);
}
