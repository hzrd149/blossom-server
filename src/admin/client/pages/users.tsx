import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/toasts.tsx";
import { castUser } from "applesauce-common/casts";
import { normalizeToPubkey } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { useEffect, useState } from "react";
import type { UsersQuery } from "../../contracts/users.ts";
import { UserKeySchema, UsersQuerySchema } from "../../contracts/users.ts";
import { adminApi } from "../api/client.ts";
import { adminQueries, adminQueryKeys } from "../api/queries.ts";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorAlert,
  Loading,
  PageToolbar,
  Paginator,
  StatTile,
} from "../components/ui.tsx";
import { safeNpub, UserBadge } from "../components/user.tsx";
import { BanUserButton } from "../components/moderation.tsx";
import { formatBytes, formatDate, formatNumber } from "../lib/format.ts";
import { eventStore } from "../nostr/event-store.ts";
import { Link, setSearch, useLocation } from "../router.tsx";

const date = (value: number | null) => value === null ? "—" : formatDate(value);

export function UsersPage() {
  const { search } = useLocation();
  const parsed = UsersQuerySchema.safeParse(Object.fromEntries(search));
  const params = parsed.success ? parsed.data : UsersQuerySchema.parse({});
  const [input, setInput] = useState(params.q);
  useEffect(() => setInput(params.q), [params.q]);
  const { data, error, isPending } = useQuery(adminQueries.users(params));
  return (
    <>
      <form
        className="flex flex-wrap gap-2 mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          let q = input.trim();
          try {
            q = normalizeToPubkey(q) ?? q;
          } catch { /* Allow partial hex and anonymous searches. */ }
          setSearch({ q, page: 1 });
        }}
      >
        <input
          aria-label="Search users"
          className="input flex-1 min-w-48"
          placeholder="npub, hex key, or anonymous"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn" type="submit">Search</button>
        <select
          aria-label="User role"
          className="select w-auto"
          value={params.role}
          onChange={(e) => setSearch({ role: e.target.value, page: 1 })}
        >
          <option value="all">All users</option>
          <option value="owners">Blob owners</option>
          <option value="reporters">Reporters</option>
        </select>
        <select
          aria-label="Sort users"
          className="select w-auto"
          value={params.sort}
          onChange={(e) => setSearch({ sort: e.target.value, page: 1 })}
        >
          {([
            ["totalSize", "Storage"],
            ["blobCount", "Blob count"],
            ["lastUpload", "Latest ownership"],
            ["reportCount", "Reports filed"],
            ["pubkey", "Public key"],
          ] satisfies [UsersQuery["sort"], string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setSearch({ dir: params.dir === "desc" ? "asc" : "desc", page: 1 })}
        >
          {params.dir === "desc" ? "Descending" : "Ascending"}
        </button>
      </form>
      <ErrorAlert error={error} />
      {isPending ? <Loading /> : data && (
        <>
          <div className="overflow-x-auto rounded-box border border-base-300">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Blobs</th>
                  <th>Storage</th>
                  <th>Reports filed</th>
                  <th>Reports on blobs</th>
                  <th>Latest ownership</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.pubkey}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/users/${user.pubkey}`}
                          className="link link-hover min-w-0"
                        >
                          <UserBadge pubkey={user.pubkey} />
                        </Link>
                        {user.banned && (
                          <span className="badge badge-error badge-sm">
                            Banned
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{formatNumber(user.blobCount)}</td>
                    <td>{formatBytes(user.totalSize)}</td>
                    <td>{formatNumber(user.reportCount)}</td>
                    <td>{formatNumber(user.receivedReportCount)}</td>
                    <td>{date(user.lastUpload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <EmptyState>No matching users.</EmptyState>}
          </div>
          <Paginator
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => setSearch({ page })}
          />
          <p className="text-xs text-base-content/60">
            Based on current ownership and retained reports. Shared blobs count
            toward each owner's storage. Names are loaded from Nostr; search
            uses public keys.
          </p>
        </>
      )}
    </>
  );
}

function NostrProfile({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <div className="space-y-2">
      <UserBadge pubkey={pubkey} size="md" />
      {profile?.about && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {profile.about}
        </p>
      )}
      {profile?.website && /^https?:\/\//i.test(profile.website) && (
        <a
          className="link text-sm break-all"
          href={profile.website}
          target="_blank"
          rel="noopener noreferrer"
        >
          {profile.website}
        </a>
      )}
      <p className="text-xs text-base-content/60">
        Public profile metadata from Nostr.
      </p>
    </div>
  );
}

function UserDetail({ pubkey }: { pubkey: string }) {
  const { data: user, error, isPending } = useQuery(adminQueries.user(pubkey));
  const notify = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => adminApi.deleteUserContent(pubkey),
    onSuccess: (result) => notify(`Deleted ${result.deleted} blob(s).`),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  const npub = safeNpub(pubkey);
  const isAnonymous = pubkey === "anonymous";
  const ban = useQuery({
    ...adminQueries.pubkeyBan(pubkey),
    enabled: !isAnonymous,
  });
  const unban = useMutation({
    mutationFn: () => adminApi.unbanPubkey(pubkey),
    onSuccess: () => notify("User unbanned. Removed content is not restored."),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.all }),
  });
  const banned = ban.data?.ban ?? null;
  return (
    <>
      <PageToolbar
        actions={
          <>
            {!isAnonymous && ban.data && !banned && (
              <BanUserButton pubkey={pubkey} />
            )}
            {banned && (
              <ConfirmButton
                className="btn"
                title="Unban user?"
                description="The user can upload, mirror, and report again. Content removed by the ban is not restored."
                confirmLabel="Unban"
                onConfirm={() => unban.mutateAsync()}
              >
                Unban
              </ConfirmButton>
            )}
            {!isAnonymous && user && user.blobCount > 0 && (
              <ConfirmButton
                className="btn btn-error btn-outline"
                title="Delete this user's content?"
                description="Force-deletes up to 10,000 owned blobs per run, including shared blobs for ALL owners. This does not ban the user or prevent future uploads."
                confirmLabel="Delete content"
                onConfirm={() => remove.mutateAsync()}
              >
                Delete user content
              </ConfirmButton>
            )}
            <Link to="/users" className="btn btn-ghost">All users</Link>
          </>
        }
      >
        {banned && (
          <span className="badge badge-error">
            Banned{banned.reason ? `: ${banned.reason}` : ""}
          </span>
        )}
      </PageToolbar>
      {banned && (
        <div role="note" className="alert alert-error alert-soft mb-3 text-sm">
          <span>
            Banned{" "}
            {formatDate(banned.created)}. This user cannot upload, mirror, or
            file reports.
            {banned.note && <>{" "}Note: {banned.note}</>}
          </span>
        </div>
      )}
      <ErrorAlert error={error ?? remove.error ?? unban.error} />
      {isPending ? <Loading /> : user && (
        <>
          <section className="rounded-box border border-base-300 p-3 mb-3">
            {pubkey === "anonymous"
              ? (
                <p>
                  Anonymous uploads — a shared group, not an individual
                  identity.
                </p>
              )
              : <NostrProfile pubkey={pubkey} />}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all text-xs">{npub ?? pubkey}</code>
              <CopyButton value={npub ?? pubkey} label="Copy identity" />
              {npub && <CopyButton value={pubkey} label="Copy hex" />}
            </div>
          </section>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <StatTile
              label="Owned blobs"
              value={formatNumber(user.blobCount)}
              hint={`${user.sharedBlobCount} shared with others`}
              to={`/content?owner=${pubkey}`}
            />
            <StatTile
              label="Owned storage"
              value={formatBytes(user.totalSize)}
              to={`/content?owner=${pubkey}`}
            />
            <StatTile
              label="Reports filed"
              value={formatNumber(user.reportCount)}
              to={`/reports?reporter=${pubkey}`}
            />
            <StatTile
              label="Reports on owned blobs"
              value={formatNumber(user.receivedReportCount)}
              to={`/reports?owner=${pubkey}`}
            />
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
            <div>
              <dt className="inline text-base-content/60">
                First ownership:
              </dt>
              <dd className="inline">{date(user.firstUpload)}</dd>
            </div>
            <div>
              <dt className="inline text-base-content/60">
                Latest ownership:
              </dt>
              <dd className="inline">{date(user.lastUpload)}</dd>
            </div>
            <div>
              <dt className="inline text-base-content/60">
                First retained report:
              </dt>
              <dd className="inline">{date(user.firstReport)}</dd>
            </div>
            <div>
              <dt className="inline text-base-content/60">
                Latest retained report:
              </dt>
              <dd className="inline">{date(user.lastReport)}</dd>
            </div>
          </dl>
          <p className="text-xs text-base-content/60 mb-3">
            Current records only, not a complete activity history. Ownership
            dates for older records may be backfilled from the blob's original
            upload date. Report dates are supplied by the reporter.
          </p>
        </>
      )}
    </>
  );
}

export function UserPage({ pubkey }: { pubkey: string }) {
  const parsed = UserKeySchema.safeParse(pubkey);
  return parsed.success
    ? <UserDetail key={parsed.data} pubkey={parsed.data} />
    : <ErrorAlert error={new Error("Invalid user public key")} />;
}
