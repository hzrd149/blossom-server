#!/usr/bin/env bash

set -euo pipefail

package_file="nix/package.nix"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mismatch_hash=""

build_target() {
  local target=$1
  shift

  local log="$tmp_dir/${target#.#}.log"
  mismatch_hash=""

  if nix build "$target" --no-link --print-build-logs "$@" 2>&1 | tee "$log"; then
    return 0
  fi

  mismatch_hash=$(sed -nE 's/.*got:[[:space:]]+(sha256-[A-Za-z0-9+\/=]+).*/\1/p' "$log" | tail -n 1)
  if [[ -n "$mismatch_hash" ]]; then
    return 2
  fi

  echo "Failed to build $target without a fixed-output hash mismatch" >&2
  return 1
}

replace_hash() {
  local attribute=$1
  local hash=$2
  local matches

  matches=$(grep -Ec "^[[:space:]]*${attribute} = \"sha256-[^\"]+\";" "$package_file" || true)
  if [[ "$matches" -ne 1 ]]; then
    echo "Expected exactly one $attribute assignment in $package_file, found $matches" >&2
    exit 1
  fi

  sed -i -E "s|^([[:space:]]*${attribute} = )\"sha256-[^\"]+\";|\1\"${hash}\";|" "$package_file"
  echo "Updated $attribute to $hash"
}

refresh_hash() {
  local target=$1
  local attribute=$2
  local status

  echo "Checking $target"
  if build_target "$target"; then
    if build_target "$target" --rebuild; then
      echo "$target hash is current"
      return
    else
      status=$?
    fi
  else
    status=$?
  fi

  if [[ "$status" -ne 2 ]]; then
    exit "$status"
  fi

  replace_hash "$attribute" "$mismatch_hash"
}

refresh_hash "path:.#denoDeps" "denoDepsHash"
refresh_hash "path:.#clientBundle" "hash"

echo "Verifying updated Nix outputs"
bash scripts/nix-check.sh
