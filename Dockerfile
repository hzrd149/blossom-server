# syntax=docker/dockerfile:1
FROM denoland/deno:alpine

WORKDIR /app

# Copy dependency manifests first so Docker layer caching skips the slow
# "download deps" step when only source files change.
# deno.lock MUST be included so the cache resolves identical module versions.
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/

# Two-step cache warm-up:
#
# 1. deno cache — downloads all JSR/npm module sources and type info.
#    This covers the vast majority of dependencies.
#
# 2. deno run --allow-ffi --allow-env --allow-read -- ... — forces @libsql/client
#    to download and extract its platform-specific native binary (.so) into the
#    Deno npm cache. The native binary is fetched lazily on first FFI load, so
#    deno cache alone does not capture it. We run a minimal inline script that
#    imports the client (triggering the binary fetch) then exits immediately.
#    --frozen ensures the lockfile is never updated during build.
RUN deno cache --frozen main.ts && \
    deno run --allow-ffi --allow-env --allow-read --allow-sys \
      "data:application/typescript,import 'npm:@libsql/client';"

# Data volume — SQLite DB and blob files live here
VOLUME ["/app/data"]

EXPOSE 3000

# @libsql/client uses FFI (native SQLite bindings) — requires --allow-ffi and
# --allow-sys. All required permissions are captured in deno task start.
ENTRYPOINT ["deno", "task", "start"]
