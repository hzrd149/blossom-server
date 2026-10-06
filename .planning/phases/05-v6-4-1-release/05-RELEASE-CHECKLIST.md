# v6.4.1 Release Checklist

This checklist is a SHA-bound state machine. Run each stage from the exact source state named by the evidence ledger. A changed commit, changed release date, repaired Nix hash, failed or omitted command, dirty gate worktree, changed PR head, or result copied from another SHA invalidates every later receipt that depends on it.

## Safety and scope

- Work on `v6.4.1`; require `git merge-base --is-ancestor master HEAD`.
- Preserve the shared checkout. Never use `git reset --hard`, `git clean`, `git stash`, blanket restore, force push, `git push --tags`, `--allow-dirty`, or `--set-version` to make a release gate pass.
- Run release gates in a clean detached worktree created from the exact committed preparation SHA.
- `deno.json` is the only authoritative version edit. Nix reads that version through `flake.nix`; the historical `## 6.4.0` changelog section must remain unchanged.
- Record only reproducible public receipts. Never record credentials, browser/device codes, cookies, or tokens.
- A failure stops the release. Do not combine successful commands from different SHAs.

## 1. Prepare and seal the candidate

From the shared `v6.4.1` checkout:

```sh
test "$(git branch --show-current)" = "v6.4.1"
git merge-base --is-ancestor master HEAD
deno fmt
deno fmt --check CHANGELOG.md deno.json
git diff --check -- CHANGELOG.md deno.json \
  .planning/phases/05-v6-4-1-release/05-RELEASE-CHECKLIST.md \
  .planning/phases/05-v6-4-1-release/05-RELEASE-EVIDENCE.md
```

Commit the preparation files normally. Then capture the immutable input:

```sh
release_head=$(git rev-parse refs/heads/v6.4.1)
test "$release_head" = "$(git rev-parse HEAD)"
gate_dir="/tmp/blossom-server-v6.4.1-gate-$release_head"
test ! -e "$gate_dir"
git worktree add --detach "$gate_dir" "$release_head"
test "$release_head" = "$(git -C "$gate_dir" rev-parse HEAD)"
test -z "$(git -C "$gate_dir" status --porcelain --untracked-files=all)"
```

Expected: the branch and detached worktree resolve to one full SHA, the deterministic path was unused, and the gate worktree is clean.

## 2. Structural release assertions

Run in the gate worktree:

```sh
deno eval 'const c=await Deno.readTextFile("CHANGELOG.md"); const m=JSON.parse(await Deno.readTextFile("deno.json")); if(m.name!=="@hzrd149/blossom-server"||m.version!=="6.4.1") throw new Error("manifest tuple"); const u=c.indexOf("## Unreleased"), r=c.search(/## 6\.4\.1 - \d{4}-\d{2}-\d{2}/), h=c.indexOf("## 6.4.0"); if(!(u>=0&&r>u&&h>r)) throw new Error("release heading order"); const unreleased=c.slice(u,r); if(/^-/m.test(unreleased)) throw new Error("Unreleased is not empty"); const section=c.slice(r,h); if((section.match(/^-/gm)||[]).length!==6) throw new Error("release bullet count"); for(const n of [53,54,62,63,64]) if(!section.includes(`/pull/${n}`)) throw new Error(`missing PR ${n}`);'
```

Expected: package identity is `@hzrd149/blossom-server@6.4.1`; `Unreleased` has no bullets; the dated `6.4.1` section contains exactly six bullets and all five contribution links; historical `6.4.0` follows unchanged.

## 3. Deno quality gate

```sh
deno fmt --check
deno lint
deno check --frozen main.ts
deno task test
```

Expected: all four commands exit zero, including the complete server and client test task.

## 4. Deterministic generated assets

```sh
timeout 15m deno eval 'const outputs=["public/client.js","public/styles.css"]; const cleanBuild=async()=>{for(const p of outputs) await Deno.remove(p).catch((e)=>{if(!(e instanceof Deno.errors.NotFound)) throw e;}); const status=await new Deno.Command(Deno.execPath(),{args:["task","build"],stdout:"inherit",stderr:"inherit"}).spawn().status; if(!status.success) throw new Error("asset build failed");}; const digest=async(p:string)=>{const bytes=await Deno.readFile(p); if(bytes.length===0) throw new Error(`empty ${p}`); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map((b)=>b.toString(16).padStart(2,"0")).join("");}; await cleanBuild(); const first=await Promise.all(outputs.map(digest)); await cleanBuild(); const second=await Promise.all(outputs.map(digest)); for(let i=0;i<outputs.length;i++){console.log(`${outputs[i]} ${first[i]} ${second[i]}`); if(first[i]!==second[i]) throw new Error(`nondeterministic ${outputs[i]}`);}'
```

Expected: both bounded fresh builds finish within 15 minutes; both named outputs are non-empty; each output's first and second SHA-256 digest is identical. Record sizes and both digests.

Generated assets are tracked. After the second build, require the gate worktree to remain clean; any changed generated output invalidates the seal and must be committed on `v6.4.1` before restarting the complete chain at a new SHA.

## 5. Fresh Docker image

```sh
short_sha=$(git rev-parse --short=12 HEAD)
image="blossom-server:v6.4.1-rc-$short_sha"
timeout 30m docker build --pull --no-cache --progress=plain -t "$image" .
image_id=$(docker image inspect "$image" --format '{{.Id}}')
test -n "$image_id"
printf '%s %s\n' "$image" "$image_id"
```

Expected: a pull-enabled, normal-layer-cache-bypassing build completes within 30 minutes, and the SHA-named image has a non-empty inspectable image ID. Record the tag, resolved base identity when shown, and image ID.

## 6. Deterministic Nix and derived versions

```sh
deno task check:nix
test "$(nix eval --raw --no-write-lock-file .#packages.x86_64-linux.default.version)" = "6.4.1"
test "$(nix eval --raw --no-write-lock-file .#packages.x86_64-linux.clientBundle.version)" = "6.4.1"
```

Expected: all four declared outputs realize and force-rebuild, `nix flake check` passes, and both derived versions are `6.4.1`.

If and only if the Nix output diagnoses a fixed-output hash mismatch:

1. Invalidate every earlier local result.
2. Run `deno task update:nix-hashes` in a writable clean worktree at the same commit.
3. Inspect `git diff -- nix/package.nix` and carry only the diagnosed `denoDepsHash` and/or client `hash` assignment to `v6.4.1`.
4. Run `deno fmt`, commit that narrow repair separately, capture the new full SHA, require the new deterministic gate path to be absent, and restart at section 1.

Any other Nix failure stops the release and is not permission to edit hashes.

## 7. Deno publication dry run

```sh
deno publish --dry-run --check=all
```

Expected: exit zero and package identity `@hzrd149/blossom-server@6.4.1`; no upload occurs.

## 8. Seal the local evidence

```sh
test "$release_head" = "$(git rev-parse HEAD)"
test -z "$(git status --porcelain --untracked-files=all)"
```

Expected: the detached gate worktree still identifies the sealed preparation SHA and is clean. Retain command results, timestamps, asset digests, Docker image ID, Nix results, and dry-run identity outside the release commit for later ledger backfill. Do not add a receipt commit after the gate and pretend the prior gate covered it.

## 9. Push the exact branch and open the release PR

```sh
git push gh refs/heads/v6.4.1:refs/heads/v6.4.1
remote_line=$(git ls-remote gh refs/heads/v6.4.1)
remote_head=${remote_line%%$'\t'*}
test "$remote_head" = "$release_head"

gh pr create --repo hzrd149/blossom-server \
  --head v6.4.1 --base master \
  --title 'Release v6.4.1' \
  --body-file /tmp/blossom-server-v6.4.1-pr-body.md
```

If one open non-draft `v6.4.1` to `master` PR already exists, reuse it instead of creating another. Verify exactly one:

```sh
repo=hzrd149/blossom-server
pr=$(gh pr list --repo "$repo" --head v6.4.1 --base master --state open --json number,isDraft --jq '[.[]|select(.isDraft==false)]|if length==1 then .[0].number else empty end')
test -n "$pr"
test "$(gh pr view "$pr" --repo "$repo" --json headRefOid -q .headRefOid)" = "$release_head"
test "$(gh pr view "$pr" --repo "$repo" --json baseRefName -q .baseRefName)" = master
```

Expected: the explicit GitHub branch ref and release PR head both equal the sealed SHA. Opening the PR does not authorize merging it.

## 10. Review all PR checks

```sh
gh pr checks "$pr" --repo "$repo" --watch
gh pr view "$pr" --repo "$repo" \
  --json number,url,headRefName,headRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,statusCheckRollup
```

Expected: the current head remains the reviewed SHA; `Deno Tests` and `Flake Check` are present and successful; every additional observed check is completed successfully. Pending, failing, cancelled, skipped, neutral, action-required, missing, or stale rows block the release even if GitHub branch protection does not.

## 11. Gate 1 — merge release PR

`gate="blocking-human"` — never auto-approve.

Immediately before asking, display the PR URL/number, base `master`, current `headRefOid`, remote branch tip, merge strategy, and complete successful check table. Re-fetch all values and require the reviewed head to remain unchanged.

Protected command:

```sh
gh pr merge "$pr" --repo "$repo" --merge --match-head-commit "$reviewed_head"
```

Consequence: mutates `master` and triggers the `master` Docker image publication workflow. Do not use `--admin`, `--auto`, or `--squash`.

## 12. Verify merged master and prepare the exact tag

After the authorized merge:

```sh
merge_sha=$(gh pr view "$pr" --repo "$repo" --json mergeCommit -q .mergeCommit.oid)
git fetch gh master
test "$(git rev-parse refs/remotes/gh/master)" = "$merge_sha"
git merge-base --is-ancestor "$reviewed_head" "$merge_sha"
test "$(git show "$merge_sha:deno.json" | jq -r .version)" = "6.4.1"
git tag v6.4.1 "$merge_sha"
test "$(git rev-parse 'v6.4.1^{commit}')" = "$merge_sha"
test -z "$(git ls-remote --tags gh refs/tags/v6.4.1)"
```

Expected: the merge commit is GitHub `master`, contains the reviewed head, carries version `6.4.1`, the local lightweight tag peels to that exact commit, and the remote tag does not exist.

## 13. Gate 2 — push the exact tag

`gate="blocking-human"` — never auto-approve.

Immediately before asking, display the merge SHA, fetched `master` SHA, peeled local tag SHA, exact refspec, remote-tag absence, and the GHCR side effect.

Protected command:

```sh
git push gh refs/tags/v6.4.1:refs/tags/v6.4.1
```

Consequence: creates the public release ref and triggers GHCR publication of SemVer image tags. Never use `git push --tags` or force.

Verify the remote tag peels to the recorded merge SHA and retain the tag-triggered GitHub Actions run URL, conclusion, and published image digests.

## 14. Clean tagged publication gate

Create a separate clean worktree at the exact merged-master/tag commit. Require clean status, and assert `HEAD == fetched master == v6.4.1^{commit} == merge_sha`, manifest name/version, and remote tag equality. Re-run:

```sh
deno check --frozen main.ts
deno publish --dry-run --check=all
```

Expected: the tagged clean source passes validation and dry run as `@hzrd149/blossom-server@6.4.1`.

## 15. Gate 3 — publish the Deno package

`gate="blocking-human"` — never auto-approve.

Immediately before asking, display the clean-worktree status, branch/tag/HEAD/master equality, manifest tuple, tag receipt, and fresh dry-run result.

Protected command:

```sh
deno publish --check=all
```

Consequence: creates immutable JSR version `@hzrd149/blossom-server@6.4.1`; interactive authentication may open. Do not record authentication material. If JSR rejects local publication as CI-only, stop for direction; do not redesign publication during this patch release.

## 16. Public receipts and documentation follow-up

Verify and record, without moving `v6.4.1`:

- release PR URL/number, reviewed head, check names/outcomes/URLs, merge commit, and fetched `master` SHA;
- remote tag ref and peeled commit;
- `master`-push and tag-push GHCR Actions run URLs, conclusions, image tags, and digests;
- `https://jsr.io/@hzrd149/blossom-server/6.4.1_meta.json` and the public package page;
- all local release-gate commands, timestamps, digests, and identities.

Backfill actual receipts in `05-RELEASE-EVIDENCE.md` through a one-file documentation-only follow-up branch and PR. The follow-up must not modify or recreate the release tag and must not claim pending facts as complete.

Remove temporary worktrees only after their verification stage succeeds:

```sh
git worktree remove "$gate_dir"
```
