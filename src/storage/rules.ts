import debug from "debug";
import { config } from "../config.js";

const log = debug("cdn:cache:rules");

export type RuleSearchInput = {
  hash: string;
  pubkey?: string;
  mimeType?: string;
};
export function getFileRule({ pubkey, mimeType }: RuleSearchInput) {
  log("Looking for match", mimeType, pubkey);

  return (
    config.cache.rules.find((r) => {
      if (r.pubkeys && (!pubkey || r.pubkeys.includes(pubkey) === false)) return false;

      if (r.type === "*") return true;
      if (r.type) {
        if (!mimeType) return false;
        if (mimeType === r.type) return true;
        if (r.type.endsWith("*") && mimeType.startsWith(r.type.replace(/\*$/, ""))) {
          return true;
        }

        return false;
      }
      return true;
    }) || null
  );
}
