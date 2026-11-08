import { AccountManager } from "applesauce-accounts";
import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { pool } from "./relays.ts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";

NostrConnectSigner.pool = pool;

export const accounts = new AccountManager();
registerCommonAccountTypes(accounts);
