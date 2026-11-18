import { ActionRunner } from "applesauce-actions";
import { castUser } from "applesauce-common/casts/user";
import { accounts } from "./accounts.ts";
import { eventStore } from "./event-store.ts";
import { fallbackRelays, pool } from "./relays.ts";

export const actions = new ActionRunner(
  eventStore,
  accounts.signer,
  async (event, relays) => {
    const outboxes = relays?.length
      ? relays
      : await castUser(event.pubkey, eventStore).outboxes$.$first(
        2_000,
        fallbackRelays,
      );
    const results = await pool.publish(
      outboxes.length ? outboxes : fallbackRelays,
      event,
    );
    if (!results.some((result) => result.ok)) {
      throw new Error(
        "No relay accepted the Nostr event",
      );
    }
  },
);
