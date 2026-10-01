---
id: SEED-001
status: dormant
planted: 2026-10-01
planted_during: v6.4.1 / Phase 02 — Authorization Compatibility
trigger_when: when relevant
scope: unknown
---

# SEED-001: Look into supporting a robots.txt file for crawlers

## Why This Matters

_To be filled in. Run `$gsd-capture --seed --enrich SEED-001` to add context._

## When to Surface

**Trigger:** when relevant

This seed will surface during `$gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `$gsd-capture --seed --enrich SEED-001` to estimate effort.

## Breadcrumbs

- `src/server.ts` — application middleware and route assembly where a dedicated `/robots.txt` route would need ordering consideration.
- `src/routes/landing.tsx` — existing public landing/static response boundary.
- `public/` — current server-managed public assets.
- `.planning/phases/01-request-intake-boundaries/01-CONTEXT.md` — locked static-asset screening and route-fallthrough decisions that future crawler support must preserve.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
