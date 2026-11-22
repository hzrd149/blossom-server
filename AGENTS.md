# Blossom Server — agent guidance

## Commands and verification

- Use Deno 2; `deno.json` owns tasks, permissions, and server imports. There is no npm workspace.
- `deno task dev` / `deno task start` load `.env`; configuration is YAML with `${VAR}` interpolation, not environment-only config. Copy `config.example.yml`
  when setting up; pass a custom path with `deno task start /path/config.yml`.
- CI runs `deno task build` **before** `deno task test`. The test task runs server unit/E2E tests, landing client tests, then the admin typecheck.
- Focused server tests: `deno test -P --env-file=.env tests/unit/auth.test.ts` (or a file under `tests/e2e/`). `-P` selects the root permission set, including
  subprocess and FFI access.
- For self-contained tests, add `--filter "name substring"`. Some E2E files (notably `upload.test.ts`) initialize shared state in a separate setup test: run the
  whole file or include setup/cleanup in the filter.
- Landing-only checks: `deno task test:client`; admin changes: `deno task check:admin` and `deno task build:admin`.
- Run `deno lint` and format changed files with `deno fmt <paths>` before committing; verify with `deno fmt --check <paths>`. Deno's configured line width is
  **160**, not the older prose/Prettier convention.
- Root config excludes both browser client directories; root-only checks do not cover them. Each client and each styles directory has its own `deno.json` and
  lockfile. Builds use frozen locks; update the lock belonging to the changed dependency.
- `deno task build` generates ignored `public/client.js`, `public/styles.css`, and `public/admin/`; edit source, not these outputs. Missing assets warn at
  startup while blob APIs remain available. `build:admin:styles` rebuilds only admin CSS.
- Video processing invokes host `ffmpeg` and `ffprobe` directly and needs subprocess permission. `nix develop` provides the binaries; see
  `docs/media-security.md` before changing media admission or processing limits.

## Server boundaries and traps

- `main.ts` owns startup and background work; tests normally use `buildApp()` from `src/server.ts` with `app.fetch()`, without a listening port. Existing E2E
  files demonstrate temporary storage, real signed Nostr events, and DB/pool setup.
- Upload tests share a pool singleton and disable `sanitizeOps`/`sanitizeResources` because MessagePorts outlive individual tests. `createServerRuntime()`
  creates stopped schedulers; use `stopServerRuntime()` when cleaning up runtime-owned work.
- Local SQLite worker access goes through the main-thread MessageChannel DB bridge; remote libSQL workers open direct connections. Admin-only SQL belongs in
  `src/db/` and `src/admin/services/database.ts`, not the upload-worker RPC interface.
- Keep `/admin` mounted before public static files and Blossom middleware in `src/server.ts`. In `src/routes/blossom-router.ts`, named protocol routes must
  precede the blob catch-all.
- Blossom errors are `text/plain` with `X-Reason`, scoped to the Blossom sub-app. Preserve admin JSON errors and HTTP Basic Auth challenge headers; do not apply
  Blossom error formatting globally.
- Nostr auth middleware rejects invalid supplied credentials but lets missing credentials through. Protected handlers must still call `requireAuth()` and
  enforce hash scope with `requireXTag()` where applicable; `optionalAuth()` only reads parsed credentials.
- Cancel streaming request bodies before rejecting them; never buffer rejected uploads. The upload pool has no queue: `dispatch()` returning `null` means
  immediate 503. S3 uploads stage locally and commit only hash-verified blobs.
- Live rules come from `runtime.rules.current()`, not `config.storage.rules` (which includes disabled rules and is not the live snapshot). Rule changes reset
  prune cursors. NIP-05 fetched members are in-memory additions, not persisted pubkeys.
- Storage rules live in YAML, not the DB. `src/config/editor.ts` edits raw YAML, preserving comments and `${VAR}` placeholders, with atomic writes and
  hash-based conflict detection; read-only configurations support copying rendered output.
- Browser-safe policy schemas live in `src/policy/`; server config defaults live in `src/config/schema.ts`.
- Migrations in `src/db/migrations/` run alphabetically and are recorded by filename in `schema_migrations`. Add new migrations rather than changing applied
  ones. The runner splits on `;` without SQL parsing: no semicolons in comments or trigger bodies.
- Legacy admin user-content deletion force-deletes shared blobs for **all owners**, capped at 10,000 records. Do not accidentally turn it into ownership-only
  deletion while refactoring.

## Admin and browser code

- Server rendering uses Hono JSX; landing client uses Hono JSX DOM; `src/admin/client/` uses React with an independent JSX config. Do not mix runtimes. Admin
  uses Tailwind 4/daisyUI 5; landing styles use Tailwind 3.
- `src/admin/server/` validates HTTP input, `src/admin/services/` coordinates operations, and `src/admin/contracts/` carries browser-safe DTOs. Contracts must
  not import filesystem, worker, DB, or runtime config modules or expose resolved credentials.
- Register console pages in `src/admin/contracts/pages.ts` as well as the client router. Only registered paths receive the HTML shell; `/admin/api` misses stay
  JSON 404s. Resolve client API URLs against `location.origin` to support credentials in the console URL.
- Use standard daisyUI control sizes and semantic colors; small sizes are for dense rows/inline utilities. Success notifications are bottom-right toasts, not
  page-top banners.
- TanStack Query owns HTTP API data (`src/admin/client/api/queries.ts`). Nostr data uses the shared Applesauce instances in `src/admin/client/nostr/`; read
  relevant Applesauce examples before adding Nostr features.
- Use native Applesauce stores, loaders, account classes, providers, and hooks; use casts with `use$` directly (e.g.
  `use$(() => castUser(pubkey, eventStore).profile$, [pubkey])`). Do not add a custom runtime/profile-hook facade, backend profile fetching, or another app-wide
  EventStore/pool.
- Incoming relay events enter the shared EventStore. Accounts are session-only and independent of HTTP Basic Auth; signer requests require explicit user action.
  Do not write tests that merely retest Applesauce behavior.

## Change and release conventions

- Read `docs/moderation/local-bans.md` before changing pubkey or blob bans; keep behavior and status headers synchronized, following
  `docs/moderation/README.md`. Bans live in the database (`src/db/moderation/`, via `ModerationDatabase`) and are enforced through `runtime.moderation`; domain
  code never holds the libsql `Client`.
- For customer-facing changes, read `CHANGELOG.md`'s `Unreleased` section first. Extend an existing entry for an unreleased feature rather than adding another
  fix/polish entry. Use `Major Changes`, `Minor Changes`, or `Patch Changes`; describe operator/user impact in one short sentence, naming relevant config
  keys/endpoints. Skip internal refactors, tests, tooling, and UI polish. Add a version heading only when releasing.
- **Nix checks are pre-commit work:** after all Nix-input, dependency, or bundled-client edits are complete, run `deno task check:nix`. On a hash mismatch, run
  `deno task update:nix-hashes` to update `nix/package.nix` and recheck. Do not refresh hashes after individual edits. The check realizes and force-rebuilds
  dependencies, both client bundles, styles, and the final package.
- Develop release milestones on `v<version>` branched from current `master`; selected contribution and local PRs target that candidate branch. Retarget and
  merge original contribution PRs through GitHub, verifying **Merged** status; copying/cherry-picking does not merge a PR. If adaptation requires a separate PR,
  link the original and close it with an explanation after release.
- Use merge commits when retaining contributor SHAs/authorship is required. Release via a `v<version>` → `master` PR only after required CI passes. Then update
  local `master`, verify version/changelog, and tag/push `v<version>` from that merged state. Publish the Deno package only from tagged, merged `master`; retain
  links from contribution PRs through release PR, verification, tag, and package.
