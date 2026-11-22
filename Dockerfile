# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Runtime image
#
# Uses the Debian (glibc) image because several native npm packages (sharp,
# @libsql/client) ship glibc-linked binaries that require libc.so, which is
# absent on Alpine/musl.
#
# The landing and admin client JS and CSS are pre-built into public/ during
# image build so the runtime container serves known-good assets instead of
# relying on startup-time bundling.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:debian

WORKDIR /app

# Debian's ffmpeg package provides both ffmpeg and ffprobe for video optimization.
# Verify both executables are available before continuing the image build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && ffmpeg -version \
    && ffprobe -version \
    && rm -rf /var/lib/apt/lists/*

# Copy Deno server source + static assets.
COPY deno.json deno.lock ./
COPY tailwind.config.js ./
COPY main.ts ./
COPY public/ ./public/
COPY src/ ./src/

# Warm the Deno module cache and pre-build the landing and admin assets.
#
# Step 1: deno cache downloads all JSR/npm module sources declared in deno.json.
#
# Note: @libsql/client's native binary is NOT pre-fetched here — attempting to
# load FFI bindings under QEMU emulation (ARM64 builds on amd64 runners) causes
# illegal instruction crashes. The .so binary will be fetched automatically on
# first use at container runtime, which runs natively on the target architecture.
# Serialize asset tasks to avoid concurrent esbuild installation into a cold cache.
RUN deno cache main.ts && deno task --jobs 1 build

# Data volume — SQLite DB and blob storage. Mounted at runtime.
VOLUME ["/app/data"]

EXPOSE 3000
EXPOSE 3001

ENTRYPOINT ["deno", "task", "start"]
