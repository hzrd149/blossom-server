import { NDKUserProfile } from "@nostr-dev-kit/ndk";
import ndk from "./ndk.js";

const profiles = new Map<string, NDKUserProfile | null>();

export function getUserProfile(pubkey: string) {
  if (profiles.has(pubkey)) return profiles.get(pubkey);

  const user = ndk.getUser({ pubkey });
  user.fetchProfile().then((profile) => profiles.set(pubkey, profile));

  return user.profile;
}
