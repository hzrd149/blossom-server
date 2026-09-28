import { assertEquals } from "@std/assert";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { eventStore, fetchUserProfile, fetchUserProfiles, pool } from "../../src/admin/nostr-profile.ts";

Deno.test("Nostr profile helpers resolve cached kind 0 metadata", async () => {
  const profile = {
    name: "alice",
    display_name: "Alice",
    picture: "https://example.com/alice.png",
  };
  const event = finalizeEvent(
    {
      kind: 0,
      created_at: 1,
      tags: [],
      content: JSON.stringify(profile),
    },
    generateSecretKey(),
  );

  try {
    eventStore.add(event);

    assertEquals(await fetchUserProfile(event.pubkey), profile);
    assertEquals(
      await fetchUserProfiles([event.pubkey]),
      new Map([[event.pubkey, profile]]),
    );
  } finally {
    eventStore.dispose();
    pool.close();
  }
});
