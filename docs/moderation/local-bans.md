# Local bans

- **Status:** Draft
- **Implemented in:** —

## Summary

Administrators can ban **pubkeys** and **blob hashes** on their own server. Bans are stored in the server database, enforced on every route that accepts content
or reports, and never leave the server.

Local bans are always enabled. They require no configuration, no Nostr relays, and no server key.

## Terms

- **Banned pubkey:** an uploader key that the server refuses to accept content or reports from.
- **Banned blob:** a hash the server refuses to store. The file is deleted when the ban is created.

## Pubkey bans

A pubkey ban records:

| Field     | Description                                               |
| --------- | --------------------------------------------------------- |
| `pubkey`  | Banned key (64 hex characters).                           |
| `reason`  | Optional category (NIP-56 report type or `other`).        |
| `note`    | Optional free-text note for administrators. Never shared. |
| `created` | Unix timestamp of the ban.                                |

When creating a pubkey ban, the administrator chooses what happens to existing content:

- `keep` (default): existing blobs are not changed.
- `remove`: the pubkey's ownership is removed from every blob it owns. Blobs left without owners are deleted, except blobs that are still the thumbnail of
  another stored blob. Thumbnails of deleted blobs are deleted unless they have owners or belong to another stored blob. Blobs also owned by other pubkeys
  remain for them. This is ownership-only removal, unlike the legacy "delete user content" action, which force-deletes shared blobs.

Removing a pubkey ban restores the ability to upload. It does not restore removed content.

### Enforcement

A request authenticated (BUD-11) by a banned pubkey is rejected with HTTP **403** and an `X-Reason` header on:

| Route                         | Notes                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `PUT /upload`, `HEAD /upload` | Before any body bytes are read; the body is cancelled. |
| `PUT /mirror`                 | Before the remote fetch starts.                        |
| `PUT /media`, `HEAD /media`   | Before any body bytes are read; the body is cancelled. |
| `PUT /report`                 | Reports filed by banned pubkeys are not stored.        |

The rejection reason is `X-Reason: pubkey is banned`. `PUT /report` is also rejected when the kind 1984 report event itself is signed by a banned pubkey, with
or without BUD-11 auth.

`DELETE /:sha256` by a banned pubkey remains allowed, so users can still remove their own content. `GET /list/:pubkey` is not affected by the ban itself.

Anonymous uploads (when `upload.requireAuth` is false) cannot be attributed to a pubkey and are not affected by pubkey bans.

## Blob bans

A blob ban records:

| Field      | Description                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `sha256`   | Banned blob hash.                                                                                   |
| `category` | NIP-56 report type (`nudity`, `malware`, `profanity`, `illegal`, `spam`, `impersonation`, `other`). |
| `note`     | Optional free-text note for administrators. Never shared.                                           |
| `created`  | Unix timestamp of the ban.                                                                          |

The raw `sha256` is stored so that the server can check incoming hashes with one indexed lookup and so the administrator can find and undo a ban.

Creating a blob ban:

1. Deletes the stored file and its database record (all owners), if present.
2. Applies the same ban to related derived blobs recorded by the server: the optimized derivative of the blob, the original the blob was derived from, and their
   thumbnails. Each related blob gets its own ban row with the same category.
3. Retains all reports for the banned hashes, without changing their dismissal state.

Banning an already banned hash updates its category, and its note when a new one is given. Removing a blob ban allows the hash to be uploaded again. It does not
restore deleted files.

### Enforcement

| Route                         | Behavior                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HEAD /upload`, `HEAD /media` | If `X-SHA-256` is a banned hash, respond **403**.                                                                                                           |
| `PUT /upload`                 | If the `X-SHA-256` header names a banned hash, reject before reading the body. Otherwise, after hashing, reject a banned hash and discard the written data. |
| `PUT /mirror`                 | If the requested hash is banned, reject before fetching. Check the downloaded hash again.                                                                   |
| `PUT /media`                  | Reject when the input hash or the optimized output hash is banned. A banned `X-SHA-256` is rejected before reading the body.                                |
| `GET`, `HEAD /:sha256`        | Banned blobs are deleted when the ban is created, so they return 404 like any other missing blob.                                                           |
| `GET /list/:pubkey`           | Banned blobs are deleted, so they are not listed.                                                                                                           |

Upload rejections use HTTP **403** with `X-Reason: blob is blocked`.

Details:

- `PUT /mirror`: the requested hash is the hash at the end of the URL path (Blossom blob URLs), otherwise the single `x` tag of the auth event. When neither
  identifies a hash, only the downloaded hash is checked.
- `PUT /media`: a generated thumbnail that is itself banned is not stored; the upload still succeeds without it.
- With S3 storage and `storage.s3.publicURL`, a ban deletes the object from the bucket, so it is no longer reachable at its public bucket URL either.
- Each check is a single primary-key lookup in `banned_blobs`; pubkey checks are in memory.

## Data model

| Table            | Columns                                    |
| ---------------- | ------------------------------------------ |
| `banned_pubkeys` | `pubkey` PK, `reason`, `note`, `created`   |
| `banned_blobs`   | `sha256` PK, `category`, `note`, `created` |

Moderation SQL lives in `src/db/moderation/` (accessed through `ModerationDatabase`); the main-thread `ModerationService` (`src/moderation/service.ts`,
`runtime.moderation`) owns the operations and keeps banned pubkeys in memory.

## Admin API

Mounted under `/admin/api`, protected by the console's HTTP Basic Auth.

| Method and path                | Description                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET /bans/pubkeys`            | Paginated list of pubkey bans. `q` searches pubkey (hex or npub), reason, and note.                       |
| `POST /bans/pubkeys`           | Body `{ pubkey, reason?, note?, content: "keep" \| "remove" }`. `pubkey` is hex or npub.                  |
| `GET /bans/pubkeys/:pubkey`    | Ban status of a pubkey (`ban` is null when not banned).                                                   |
| `DELETE /bans/pubkeys/:pubkey` | Lift a pubkey ban.                                                                                        |
| `GET /bans/blobs`              | Paginated list of blob bans. `q` searches hash and note; `category` filters.                              |
| `POST /bans/blobs`             | Body `{ sha256, category, note? }`. `sha256` may be a blob URL. Deletes the blob and related derivatives. |
| `DELETE /bans/blobs/:sha256`   | Lift a blob ban.                                                                                          |
| `GET /moderation/blobs/:ref`   | Ban status of a hash or blob URL: `{ sha256, stored, ban }`.                                              |

Report moderation gains a `ban-blob` action (`POST /reports/:id/ban-blob`, optional body `{ category?, note? }`) alongside `dismiss` and `delete-blob`. The
category defaults to the report type when it is a ban category, otherwise `other`. The blob and user pages gain ban actions.

Reports survive content deletion, bans, and pruning. Dismissal marks a report as dismissed instead of deleting it. The Reports page shows all reports by
default, with independent status (`all`, `active`, `dismissed`) and blob availability (`all`, `stored`, `missing`) filters.

Administrators can explicitly delete reports using `POST /reports/cleanup` with `{ target: "missing" | "dismissed" }`. This action applies server-wide,
independently of list filters or selection, and returns `{ success: true, deleted }`. Missing-blob cleanup checks for absence from the blob database at deletion
time; dismissed cleanup deletes only dismissed reports. Neither action deletes blobs. Previously deleted reports cannot be recovered.

## Open questions

- Whether `illegal` bans should offer a legal-hold option that keeps the file inaccessible instead of deleting it, for operators with reporting and preservation
  obligations.
- Whether banning a pubkey with `remove` should stop serving shared blobs until another owner re-uploads, instead of leaving them served.
