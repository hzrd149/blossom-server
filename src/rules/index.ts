import debug from "debug";
import { Rule } from "../config.js";
import dayjs from "dayjs";

const log = debug("cdn:cache:rules");

export type RuleSearchInput = {
  pubkey?: string;
  mimeType?: string;
};
export function getFileRule({ pubkey, mimeType }: RuleSearchInput, ruleset: Rule[]) {
  log("Looking for match", mimeType, pubkey);

  return (
    ruleset.find((r) => {
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

export function getExpirationTime(rule: Rule): number {
  const match = rule.expiration.match(/(\d+)\s*(\w+)/);
  if (!match) throw new Error("Failed to parse expiration");
  const count = parseInt(match[1]);
  const unit = match[2];

  // @ts-expect-error
  return dayjs().add(count, unit).unix();
}
