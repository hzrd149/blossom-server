# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
#
# Installs frontend dependencies and runs both Vite builds so the runtime
# image contains pre-built dist/ directories and never needs Node at runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:alpine AS builder

WORKDIR /app

# Install Node.js + pnpm for the admin Vite build.
# The landing build uses `deno run npm:vite` so it only needs Deno (already present).
RUN apk add --no-cache nodejs npm && npm install -g pnpm

# ── Landing page client ───────────────────────────────────────────────────────
# Copy manifest + lockfile first so Docker cache skips npm install when only
# source files change.
COPY landing/package.json landing/deno.lock ./landing/
# Install landing deps via deno (creates landing/node_modules/)
RUN cd landing && deno install

# Copy landing source and build
COPY landing/src/ ./landing/src/
COPY landing/index.html landing/vite.config.ts ./landing/
RUN cd landing && deno run --allow-all npm:vite build

# ── Admin dashboard ───────────────────────────────────────────────────────────
# Copy manifest + lockfile first
COPY admin/package.json admin/pnpm-lock.yaml ./admin/
# Install admin deps via pnpm (frozen lockfile = reproducible, CI=true suppresses TTY prompts)
RUN cd admin && CI=true pnpm install --frozen-lockfile

# Copy admin source and build
COPY admin/src/ ./admin/src/
COPY admin/index.html admin/vite.config.ts ./admin/
RUN cd admin && deno run --allow-all npm:vite build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime
#
# Pure Deno image. Copies only:
#   - Deno server source (src/, main.ts, deno.json, deno.lock)
#   - Pre-built frontend dist/ directories from the builder stage
#   - scripts/ for deno task clean etc.
# No Node, no pnpm, no node_modules in the final image.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:alpine

WORKDIR /app

# Copy Deno server source
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Copy pre-built frontend assets from builder stage
COPY --from=builder /app/landing/dist/ ./landing/dist/
COPY --from=builder /app/admin/dist/ ./admin/dist/

# Warm the Deno module cache so first startup is fast.
#
# Step 1: deno cache resolves all JSR/npm module sources declared in deno.json.
# Step 2: A minimal inline import of @libsql/client triggers the lazy download
#         of its platform-specific native binary (.so). This must be a real
#         `deno run` (not just `deno cache`) because the binary is fetched on
#         first FFI load, not at resolution time.
# --frozen ensures the lockfile is never modified during the image build.
RUN deno cache --frozen main.ts && \
    deno run --allow-ffi --allow-env --allow-read --allow-sys \
      "data:application/typescript,import 'npm:@libsql/client';"

# Data volume — SQLite DB and blob storage. Mounted at runtime.
VOLUME ["/app/data"]

EXPOSE 3000

# deno task start includes all required --allow-* flags.
# --allow-run is included for the stale-check build path (skipped when dist/ exists).
ENTRYPOINT ["deno", "task", "start"]
