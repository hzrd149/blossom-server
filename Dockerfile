# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Runtime image
#
# Uses the Debian (glibc) image because several native npm packages (sharp,
# @libsql/client) ship glibc-linked binaries that require libc.so, which is
# absent on Alpine/musl.
#
# The landing page client JS is bundled at server startup via Deno.bundle()
# (--unstable-bundle, already present in `deno task start`). No separate build
# step or node_modules directory is required.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:debian

WORKDIR /app

# Install ffmpeg for video optimization / transcoding
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy Deno server source + lockfile
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Copy landing page source so Deno.bundle() can build it at startup.
COPY landing/src/ ./landing/src/

# Warm the Deno module cache so first startup is instant.
#
# Step 1: deno cache downloads all JSR/npm module sources declared in deno.json.
# Step 2: deno run forces @libsql/client to fetch its platform-specific native
#         binary (.so) — the binary is downloaded lazily on first FFI load, so
#         deno cache alone does not capture it.
RUN deno cache --unstable-bundle main.ts && \
    deno run --allow-ffi --allow-env --allow-read --allow-sys \
      "data:application/typescript,import 'npm:@libsql/client';"

# Data volume — SQLite DB and blob storage. Mounted at runtime.
VOLUME ["/app/data"]

EXPOSE 3000

ENTRYPOINT ["deno", "task", "start"]
