import { RelayPool } from "applesauce-relay";
import { relaySet } from "applesauce-core/helpers";

export const pool = new RelayPool({ keepAlive: 10_000 });
export const lookupRelays = relaySet([
  "wss://purplepag.es",
  "wss://index.hzrd149.com",
]);
export const fallbackRelays = relaySet([
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.ditto.pub",
]);
