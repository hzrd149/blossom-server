#!/usr/bin/env bash

set -euo pipefail

targets=(
  ".#denoDeps"
  ".#clientBundle"
  ".#blossom-server"
)

# Realize new derivations first: --rebuild cannot check an output that has
# never been built or substituted on this machine.
nix build "${targets[@]}" --no-link --print-build-logs

# Rebuild explicit fixed-output dependencies and the final package so existing
# store paths cannot hide stale hashes or non-reproducible output.
nix build "${targets[@]}" --no-link --rebuild --print-build-logs

nix flake check --print-build-logs
