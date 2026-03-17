# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
#
# Installs all frontend npm deps once at the project root and runs both Vite
# builds. The runtime image gets only the compiled dist/ outputs — no
# node_modules, no Node.js, no pnpm.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:alpine AS builder

WORKDIR /app

# Copy root dependency manifests first so Docker layer caching skips the slow
# `deno install` step when only source files change.
COPY package.json deno.lock ./

# Install all npm deps (admin + landing) into a single root node_modules/.
# deno install reads package.json and creates node_modules/ using Deno's npm resolver.
RUN deno install

# Copy Vite configs (at root — shared by both projects)
COPY vite.config.admin.ts vite.config.landing.ts ./

# ── Landing page client ───────────────────────────────────────────────────────
COPY landing/src/ ./landing/src/
COPY landing/index.html ./landing/
RUN deno run --allow-all npm:vite build --config vite.config.landing.ts

# ── Admin dashboard ───────────────────────────────────────────────────────────
COPY admin/src/ ./admin/src/
COPY admin/index.html ./admin/
RUN deno run --allow-all npm:vite build --config vite.config.admin.ts


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime
#
# Pure Deno image — no Node, no npm, no node_modules.
# Contains only the Deno server source and the pre-built dist/ directories.
# ─────────────────────────────────────────────────────────────────────────────
FROM denoland/deno:alpine

WORKDIR /app

# Copy Deno server source + lockfile
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Copy pre-built frontend assets from the builder stage
COPY --from=builder /app/landing/dist/ ./landing/dist/
COPY --from=builder /app/admin/dist/ ./admin/dist/

# Warm the Deno module cache so first startup is instant.
#
# Step 1: deno cache downloads all JSR/npm module sources declared in deno.json.
# Step 2: deno run forces @libsql/client to fetch its platform-specific native
#         binary (.so) — the binary is downloaded lazily on first FFI load, so
#         deno cache alone does not capture it.
# --frozen ensures the lockfile is never modified during the image build.
RUN deno cache --frozen main.ts && \
    deno run --allow-ffi --allow-env --allow-read --allow-sys \
      "data:application/typescript,import 'npm:@libsql/client';"

# Data volume — SQLite DB and blob storage. Mounted at runtime.
VOLUME ["/app/data"]

EXPOSE 3000

ENTRYPOINT ["deno", "task", "start"]
