# blossom-server

## Unreleased

### Minor Changes

- Add an independent `media.requirePubkeyInRule` setting, enabled by default, with a warned compatibility fallback for existing media configurations.
- Add opt-in strict config loading through `BLOSSOM_REQUIRE_CONFIG`, enabled by default in the Docker Compose example and NixOS module.
- Allow landing-page uploads and mirrors without signing in first by generating a persistent browser-local Nostr identity. Add controls to back up the local
  secret key, sign in with a NIP-07 or NIP-46 signer, and safely switch or sign out of identities.

### Patch Changes

- Compile and package the landing and admin Tailwind stylesheet locally instead of loading Tailwind's development CDN at runtime.
- Upgrade Applesauce dependencies to 6.2 and adapt admin Nostr profile loading to the updated profile model.
- Add deterministic Nix rebuild validation for dependencies, the landing-page bundle, and the final server package.
- Add a `deno task update:nix-hashes` command that refreshes stale fixed-output hashes and verifies the resulting Nix builds.
- Run Deno tests on pushes and pull requests, verify multi-architecture Docker builds on non-`master` branches, and limit image publishing to `master` and
  release tags.
- Bound expiry and ownerless pruning with cursor-based batches while preserving ordered first-match retention rules and allowing later blobs to progress past
  deletion failures.
- Reject mirror requests from pubkeys absent from every storage-rule allowlist before fetching the remote origin.
- Enforce configured upload and media size limits against streamed bytes, even when clients or mirror origins underreport `Content-Length`.
- Harden mirror fetching against SSRF through DNS-resolved local addresses, IPv6 address variants, and redirect destinations.

## 6.3.1

### Patch Changes

- Clamp blob range requests that end past EOF instead of returning 416.
- Update the Nix package to use the upstream deno2nix dependency hashing fix.

## 6.3.0

### Minor Changes

- Add reproducible Nix flake packaging with a development shell, package build, app wrapper, and CI flake checks.
- Add a configurable media temporary directory and make local storage commits work across filesystems.
- Clean up scanner-reported AI slop and lint findings without changing runtime behavior.

## 6.2.1

### Patch Changes

- Drain request bodies on `/upload` dedup hits instead of cancelling them so large re-uploads can receive the successful 200 response reliably.

## 6.2.0

### Minor Changes

- Add NIP-94 file metadata tags to blob descriptors returned by `/upload`, `/mirror`, `/media`, and `/list/:pubkey`, including `url`, `m`, `x`, `size`, optional
  `dim`, and transformed-media `ox` tags.
- Persist NIP-94 metadata with blob records so descriptors can preserve derived metadata across deduped uploads and list responses.
- Add best-effort media thumbnail generation for `/media` uploads. Thumbnails are generated for images and videos when possible, returned as NIP-94 `thumb`
  tags, stored as ownerless blobs, and kept tied to their parent media blob for prune/delete cleanup.

## 6.1.5

### Patch Changes

- `HEAD /upload` now returns **200** when the upload would be accepted (was 204). The 204 status code is no longer used on the HEAD endpoint.

## 6.1.4

### Patch Changes

- Honor `X-Forwarded-Proto` (and RFC 7239 `Forwarded`) when building blob descriptor URLs so `url` fields use `https://` when the original client request was
  HTTPS through a TLS-terminating reverse proxy

## 6.1.3

### Patch Changes

- Replace landing-page WebCrypto hashing with `@noble/hashes` and remove `crypto.randomUUID()` usage so the client works better on insecure origins
- Add `window.nostr.js` to the landing bundle to provide a NIP-46 fallback when no NIP-07 browser extension is installed
- Stop runtime client bundling, document the prebuilt `public/client.js` requirement, and serve the entire `public/` directory through Hono static middleware

## 6.1.1

### Patch Changes

- Fix bug with auth event validation errors not being passed through to the client

## 6.1.0

### Minor Changes

- More specific HTTP status codes across endpoints:
  - `PUT /upload` returns **201** for newly created blobs
  - `HEAD /upload` return **204** when the upload would be accepted **200** when the blob already exists
  - `DELETE /:sha256` returns **204** on success
  - Upload and media endpoints return **409** on SHA-256 hash mismatch (was 400)
  - `/media` optimization failures return **422** (was 500)
- `HEAD /media` now checks `X-Content-Length` (413) and `X-Content-Type` (415) before accepting the upload stream
- Landing page upload and mirror UI now preflights, retries on 429/503, and shows user-friendly status messages

## 6.0.3

### Patch Changes

- Return full blob URLs using the incoming request protocol when `publicDomain` is configured
- Add end-to-end coverage that validates returned blob descriptor URLs are absolute valid URLs

## 6.0.2

### Patch Changes

- Correct image rotation in optimization method

## 6.0.0

Complete rewrite of the server in Deno.

### Major Changes

- Removed upstream discovery mechanism
- List endpoint disabled by default
- Added worker pool for uploads
- Replaced React Admin SPA with Hono JSX server-rendered dashboard
- Added auto-migration from legacy Node.js blossom-server database
- Implement BUD-09 blob reports with admin UI

## 5.2.0

### Minor Changes

- 194d4a4: Allow auth tokens to be used multiple times
- 3db7d86: Add variable interpolation in config

## 5.1.2

### Patch Changes

- 029f80a: Fix bug in upload UI

## 5.1.1

### Patch Changes

- 91919ce: Fix broken media upload on home page

## 5.1.0

### Minor Changes

- ed1904d: Update cleanup cron to remove blobs without owners if enabled

### Patch Changes

- 53a9099: Fix typo in /mirror endpoint
- ed1904d: Throw 404 when blob is not found on DELETE /<sha256>

## 5.0.0

### Major Changes

- 7045928: Require "media" auth event on /media endpoint

### Patch Changes

- c9d905b: Fix s3 storage implementation not listing all objects

## 4.7.0

### Minor Changes

- b02c83e: Add /media endpoint

### Patch Changes

- 42ac907: Fix occasional upload failures

## 4.6.0

### Minor Changes

- 19fc126: Support range requests

### Patch Changes

- 6b6d953: Fix bug with upload size being set to 0

## 4.5.0

### Minor Changes

- 575ceaa: Use node 22
- c267585: Remove old database.json migration
- ad7341c: Return X-Reason header for all errors

### Patch Changes

- c267585: Support reverse proxy headers

## 4.4.1

### Patch Changes

- 12d21c1: Add BLOSSOM_CONFIG env variable
- da68352: Fix crash from upload race condition

## 4.4.0

### Minor Changes

- af5d4c6: Add support for BUD-06 HEAD /upload endpoint
- af5d4c6: Support auth events with multiple `x` tags

### Patch Changes

- 7908d09: Bump dependencies

## 4.3.2

### Patch Changes

- 4f6080a: Fix uncaught error when fetching blob from HTTP

## 4.3.1

### Patch Changes

- Fix bug with some browsers setting incorrect mime type for .m3u8
- 8096b37: Expand S3 Storage options

## 4.3.0

### Minor Changes

- 6749892: Add `useSSL` and `region` options for s3 storage

## 4.2.0

### Minor Changes

- Add `removeWhenNoOwners` option to config
- Add window.nostr.js to landing page

## 4.1.1

### Patch Changes

- Fix typo in /upload endpoint

## 4.1.0

### Minor Changes

- Add /mirror endpoint
- Add mirror page to UI

## 4.0.1

### Patch Changes

- Replace websocket-polyfill package

## 4.0.0

### Major Changes

- Require "x" tag with sha256 hash on uploads

### Minor Changes

- Rebuild landing page with tailwind and lit

## 3.0.0

### Major Changes

- Rename "created" field to "uploaded" on blobs

### Minor Changes

- Support "since" and "until" on /list endpoint

## 2.1.2

### Patch Changes

- 7520055: Add default for publicDomain option
- 7520055: Change default local blob directory
- 7520055: Fix bug with unowned blobs in dashboard

## 2.1.1

### Patch Changes

- Create data directory if it does not exist

## 2.1.0

### Minor Changes

- Add blob details page with preview

## 2.0.0

### Major Changes

- Add simple admin dashboard

### Patch Changes

- Fix bug with app crashing when config fields missing

## 1.1.1

### Patch Changes

- Fix docker image
- Fix expiration in auth events for index.html
