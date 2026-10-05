---
phase: 04-integrated-candidate-verification
plan: 02
verified_at: 2026-10-05T17:52:21Z
status: pass
source_candidate: 331dabdd4189d3a90226650387341fb8aeae3ea6
---

# Phase 04 Integrated Candidate Verification Evidence

## Candidate identity

- **Candidate SHA:** `331dabdd4189d3a90226650387341fb8aeae3ea6` (`331dabdd4189`)
- **Branch:** `v6.4.1`
- **Evidence restart:** `2026-10-05T17:48:44Z`
- **Final source assertion:** `2026-10-05T17:52:21Z`
- `git merge-base --is-ancestor master HEAD`: pass
- `git status --porcelain --untracked-files=no -- main.ts src tests deno.json deno.lock Dockerfile flake.nix nix scripts tailwind.config.js CHANGELOG.md`: empty before and after the authoritative run
- Toolchain: Deno 2.9.5 / V8 15.0.245.2-rusty / TypeScript 6.0.3; Git 2.53.0; Docker client/server 29.8.0; Nix 2.34.7

This ledger is an evidence-only follow-up commit to the source candidate above. It does not modify any runtime, test, lock, asset-source, Docker, or Nix input, so every result below remains bound to the recorded Candidate SHA rather than the ledger commit.

This is the complete post-review rerun after fix commits `9f892ec` (reject mixed wildcard validators) and `331dabd` (prove conditional responses short-circuit storage reads). All results from the earlier evidence seal are superseded; no prior-candidate result is used in the conclusions below.

## Focused contribution matrix

Every listed integration commit exists in the candidate ancestry and retains its matching `Contribution-PR` trailer. All five rows used this exact whole-file command, identified below as **C1**, so shared fixtures were included:

```sh
deno test -P --env-file=.env tests/unit/envelope.test.ts tests/unit/blob-path.test.ts tests/unit/url.test.ts tests/unit/auth.test.ts tests/unit/mime.test.ts tests/unit/logger.test.ts tests/e2e/upload.test.ts tests/e2e/media.test.ts tests/e2e/blobs.test.ts tests/e2e/delete.test.ts tests/e2e/list.test.ts tests/e2e/active-content.test.ts
```

**C1 result:** pass, 234 passed and 0 failed.

| Contribution | Immutable integration SHA | Original boundary exercised | Exact command and result |
| --- | --- | --- | --- |
| PR #53 | `3c1045f68a7e0b7e30f6f478ea2bddf60d2a5801` | Multipart and URL-encoded envelopes return 415 before auth/body processing; rejected streams are cancelled with zero pulls; raw bodies remain compatible. | C1 verbatim above — pass, 234/0. |
| PR #54 | `0f6b99ab36fbe600190f80de7c1ad56a708640b0` | Malformed blob/static paths fall through safely while accepted hashes, suffixes, and static boundaries remain compatible. | C1 verbatim above — pass, 234/0. |
| PR #62 | `3f68b6aebc87738a79d63181c06ce90b743ee229` | BUD-11 expiration and exact `x` scope are enforced across upload/delete/list, including cancellation and staged-write cleanup on denial. | C1 verbatim above — pass, 234/0. |
| PR #63 | `a114fcebcefd0794799993c79a44ba0ade1fcdd7` | Stored-MIME active-content isolation covers GET, HEAD, range, and 304 responses while ordinary streaming and range behavior remain intact. | C1 verbatim above — pass, 234/0. |
| PR #64 | `2615f6f8ed98dfc65531dadff7180502dde32232` | Paired request log lines retain method/status/timing/reason but use the encoded pathname and omit query names and values. | C1 verbatim above — pass, 234/0. |

Contribution evidence is keyed by PR number and immutable SHA rather than presentation order; no row is inferred from another row's passing status.

## Deno quality and protocol gates

The following chain ran on the recorded source candidate and passed without changing HEAD:

```sh
deno check --frozen main.ts
deno fmt --check
deno lint
deno task test
```

- Frozen production import graph: pass.
- Root format: pass, 103 files checked.
- Repository lint: pass, 84 files checked.
- Complete test task: pass, 395 server tests and 2 landing-client tests, 0 failed.
- Real route/storage coverage uses the production Hono app, in-memory LibSQL, and temporary `LocalStorage`. It proves response/header/conditional/range behavior, stored-byte hash integrity, and cleanup through actual application seams.
- Focused upload/media tests instrument request streams: rejected multipart, URL-encoded, and unauthorized requests increment cancellation exactly once while pull count remains zero, proving rejection does not buffer the body or enter worker/storage processing.

### Advisory dispositions

- Exact normalized `multipart/x-mixed-replace` stored MIME is treated as active content and served with attachment plus `X-Content-Type-Options: nosniff`; adjacent multipart types remain inline.
- `If-None-Match` uses RFC weak comparison for quoted validators and comma-separated lists, recognizes `*` only as the complete trimmed header value, rejects mixed wildcard lists such as `*, "other"`, and continues to emit strong ETags.
- Instrumented LocalStorage coverage proves every matching strong, weak, list, and wildcard conditional request returns 304 without calling `openRead`; malformed and mixed-wildcard validators take the normal retrieval path.

## Storage compatibility boundary

The candidate passed a frozen typecheck plus a source-contract assertion for:

- `class LocalStorage implements IBlobStorage`
- `class S3Storage implements IBlobStorage`
- `let storage: IBlobStorage`
- `buildApp(db, storage, config)`

This is **S3 contract/type/build compatibility** evidence only. There was **no live or emulated S3** service, no S3 credentials, no S3 runtime request, and no new S3 harness. Runtime protocol and hash-integrity claims in this ledger come from real temporary LocalStorage flows, not from S3 execution.

## Generated assets

Only `public/client.js` and `public/styles.css` were removed with the bounded Deno program. `deno task build` then ran twice without a source change; both outputs were non-empty and hash-identical:

| Output | Size | First SHA-256 | Second SHA-256 |
| --- | ---: | --- | --- |
| `public/client.js` | 262172 bytes | `51bb44309e38cd0f282ce4ffe9860066771ca92c7dc9c2226725b3ad694ae7ad` | `51bb44309e38cd0f282ce4ffe9860066771ca92c7dc9c2226725b3ad694ae7ad` |
| `public/styles.css` | 18590 bytes | `853180a6ba8bae3b834d390fe7731714e3bc09958cc2dfeef0cb07d239777255` | `853180a6ba8bae3b834d390fe7731714e3bc09958cc2dfeef0cb07d239777255` |

The planned `deno eval -A` spelling is not accepted by Deno 2.9.5 because `deno eval` already has implicit permissions. The same bounded program was run as `deno eval`, with no scope change. HEAD remained `331dabdd4189d3a90226650387341fb8aeae3ea6` and the relevant tracked-input status remained empty.

## Docker image

```sh
candidate_sha=$(git rev-parse HEAD) && candidate_short=$(git rev-parse --short=12 "$candidate_sha") && docker build --pull --no-cache --progress=plain -t "blossom-server:v6.4.1-rc-$candidate_short" . && docker image inspect "blossom-server:v6.4.1-rc-$candidate_short" --format '{{json .Id}} {{json .RepoDigests}}'
```

- Tag: `blossom-server:v6.4.1-rc-331dabdd4189`
- Dockerfile frontend: `docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e`
- Resolved base: `denoland/deno:debian@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432`
- Image ID and repository digest: `sha256:80bd3b6f3a77e3e9416eebe4ca44a12b610112685bf44bcf48f096d52621cf66`
- Result: pass after a pull and normal-layer-cache bypass.

The resolved identities are retained for auditability. Because the Dockerfile names a mutable base tag, this result does not claim byte-for-byte reproducibility across future points in time.

## Nix deterministic gate

The authoritative `deno task check:nix` passed on Candidate SHA `331dabdd4189d3a90226650387341fb8aeae3ea6` without a hash change. The repository script realized and force-rebuilt all declared targets, then evaluated the flake:

| Target | Evaluated derivation |
| --- | --- |
| `denoDeps` | `/nix/store/9zi9s188cwj1cg700av1gc4d8frgjky3-blossom-server-deno-deps-6.4.0.drv` |
| `clientBundle` | `/nix/store/j044p1iz7d0zmpdj3ihh2ksiwb9dsyd8-blossom-server-client-deno-bundle-6.4.0.drv` |
| `styles` | `/nix/store/im6z4pcafq8a29fkmpmf74x3p5clggfm-blossom-server-styles-6.4.0.css.drv` |
| `blossom-server` | `/nix/store/5faxf1q57rp3ab9div8pxb4vrznjn9rw-blossom-server-6.4.0.drv` |

The flake package, VM, app, development shell, and package-check outputs evaluated successfully, and the command ended with `all checks passed!`. The existing fixed-output hashes were accepted, so `deno task update:nix-hashes` was not run during this refresh.

## Final assertion and flagged boundaries

- Before the ledger was written, HEAD still equaled the full recorded Candidate SHA and every relevant tracked source/build input was unchanged.
- The evidence-only ledger commit intentionally follows that candidate without altering its source-bound inputs.
- The spec-less assumptions `VERI-02-unclassified`, `VERI-03-unclassified`, and `VERI-04-unclassified` remain flagged; this ledger makes no claims beyond the commands and boundaries recorded above.
- No failed gate was suppressed, no outcome was combined across candidate states, no cached/absent generated output was presented as fresh, and no S3 runtime behavior is claimed.
