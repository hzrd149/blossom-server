import { Rule } from "../config.js";
import dayjs from "dayjs";
import logger from "../logger.js";
import { nip19 } from "nostr-tools";

const log = logger.extend("rules");

export type RuleSearchInput = {
  pubkey?: string;
  type?: string;
};
export function getFileRule({ pubkey, type }: RuleSearchInput, ruleset: Rule[], requirePubkey: boolean = false) {
  log("Looking for match", type, pubkey && nip19.npubEncode(pubkey));

  return (
    ruleset.find((r) => {
      if (requirePubkey && !r.pubkeys) return false;
      if (r.pubkeys && (!pubkey || !r.pubkeys.includes(pubkey))) return false;

      if (r.type === "*") {
        log("Found rule for", r.expiration);
        return true;
      }
      if (r.type) {
        if (!type) return false;
        if (type === r.type) return true;
        if (r.type.endsWith("*") && type.startsWith(r.type.replace(/\*$/, ""))) {
          log("Found rule for", r.expiration);
          return true;
        }

        return false;
      }
      log("Found rule for", r.expiration);
      return true;
    }) || null
  );
}

export function getExpirationTime(rule: Rule, start: number): number {
  const match = rule.expiration.match(/(\d+)\s*(\w+)/);
  if (!match) throw new Error("Failed to parse expiration");
  const count = parseInt(match[1]);
  const unit = match[2] as dayjs.ManipulateType;

  return dayjs.unix(start).subtract(count, unit).unix();
}
