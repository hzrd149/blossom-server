import NDK from "@nostr-dev-kit/ndk";
import { config } from "./config.js";

const ndk = new NDK({
  explicitRelayUrls: config.discovery.nostr.relays,
});

ndk.connect();

export default ndk;
