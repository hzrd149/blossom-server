# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Runtime image
#
# Uses the Debian (glibc) image because several native npm packages (sharp,
# @libsql/client) ship glibc-linked binaries that require libc.so, which is
# absent on Alpine/musl.
#
# The landing page client JS is pre-built into public/client.js during image
# build so the runtime container serves a known-good bundle instead of relying
# on startup-time bundling.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:debian

WORKDIR /app

# Install ffmpeg for video optimization / transcoding
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy Deno server source + static assets.
COPY deno.json deno.lock ./
COPY main.ts ./
COPY public/ ./public/
COPY src/ ./src/

# Warm the Deno module cache and pre-build the landing client bundle.
#
# Step 1: deno cache downloads all JSR/npm module sources declared in deno.json.
#
# Note: @libsql/client's native binary is NOT pre-fetched here — attempting to
# load FFI bindings under QEMU emulation (ARM64 builds on amd64 runners) causes
# illegal instruction crashes. The .so binary will be fetched automatically on
# first use at container runtime, which runs natively on the target architecture.
RUN deno cache main.ts && deno task build

# Data volume — SQLite DB and blob storage. Mounted at runtime.
VOLUME ["/app/data"]

EXPOSE 3000

ENTRYPOINT ["deno", "task", "start"]
