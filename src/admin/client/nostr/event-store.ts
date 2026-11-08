import { EventStore } from "applesauce-core/event-store";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { verifyEvent } from "nostr-tools/pure";
import { fallbackRelays, lookupRelays, pool } from "./relays.ts";

export const eventStore = new EventStore({ verifyEvent });
export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  lookupRelays,
  extraRelays: fallbackRelays,
  followRelayHints: true,
  bufferTime: 100,
  stageTimeout: 5_000,
});
