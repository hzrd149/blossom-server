import { castUser } from "applesauce-common/casts/user";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "../nostr/event-store.ts";

/** Pseudo-owner recorded for uploads made without authentication. */
export const ANONYMOUS = "anonymous";

export function safeNpub(pubkey: string): string | null {
  try {
    return npubEncode(pubkey);
  } catch {
    return null;
  }
}

function shortNpub(pubkey: string): string {
  const npub = safeNpub(pubkey);
  return npub ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : pubkey.slice(0, 12);
}

function ProfileBadge({ pubkey, size }: { pubkey: string; size: "sm" | "md" }) {
  // The shared EventStore's loader fetches kind:0 metadata on subscription.
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  const name = profile?.displayName || profile?.name || shortNpub(pubkey);
  const avatar = size === "md" ? "w-10" : "w-6";
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={safeNpub(pubkey) ?? pubkey}
    >
      <span className="avatar avatar-placeholder shrink-0">
        <span
          className={`${avatar} rounded-full bg-base-300 text-base-content/70`}
        >
          {profile?.picture
            ? (
              <img
                src={profile.picture}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )
            : <span className="text-xs">{name.slice(0, 2).toUpperCase()}</span>}
        </span>
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Avatar + display name for a pubkey; "anonymous" and malformed owners render as text. */
export function UserBadge(
  { pubkey, size = "sm" }: { pubkey: string; size?: "sm" | "md" },
) {
  if (pubkey === ANONYMOUS) {
    return <span className="badge badge-ghost">anonymous</span>;
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return <span className="font-mono text-sm">{pubkey}</span>;
  }
  return <ProfileBadge pubkey={pubkey} size={size} />;
}
