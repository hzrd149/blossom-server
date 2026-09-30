# Coding Conventions

**Analysis Date:** 2026-09-30

## Naming Patterns

**Files:**

- Use `kebab-case.ts` for modules and `kebab-case.test.ts` for tests, e.g. `src/workers/upload-worker.ts` and `tests/unit/local-storage.test.ts`.
- JSX modules use `.tsx`, e.g. `src/admin/blob-detail-page.tsx`.

**Functions:**

- Use `camelCase` for exported and local functions. Router factories are named `build<Name>Router`, such as `buildDeleteRouter` in `src/routes/delete.ts`.
- Async operations use `async`/`await`; `.catch()` is reserved for deliberate fire-and-forget or best-effort cleanup.

**Variables:**

- Use `camelCase` for local variables and parameters.
- Use `SCREAMING_SNAKE_CASE` for module constants and regular expressions, e.g. `SHA256_RE` in `src/routes/delete.ts`.
- Prefix module-level singleton state with `_`, e.g. `_client` / `_pool` per `AGENTS.md`.

**Types:**

- Use `PascalCase` for interfaces, types, and classes. Prefer interfaces for domain shapes such as `BlobRecord` and `WriteSession`.
- Prefix storage interfaces with `I` (`IBlobStorage`). Use `PascalCase` + `Schema` for Zod schemas, and derive config types with `z.infer` from
  `src/config/schema.ts`.
- Use discriminated unions for MessageChannel payloads (`src/db/bridge.ts`) and `satisfies` when posting typed payloads.

## Code Style

**Formatting:**

- Format with Deno (`deno fmt`); `deno.json` sets `fmt.lineWidth` to 160. `.prettierrc` records 120 columns and two spaces but Deno formatting is the repo
  command used for changed files.
- Use two spaces, no tabs, and double quotes. Follow Deno's formatter output where the local Prettier config differs.
- TypeScript runs in Deno's strict mode. Keep ESM imports explicit with `.ts` / `.tsx` extensions.

**Linting:**

- Use `deno lint` (Deno built-in). No ESLint/Biome configuration is present.
- Import dependencies through aliases in `deno.json`; use `import type` for type-only imports.

## Import Organization

**Order:**

1. External/bare-specifier imports (Hono, Deno std, npm/JSR dependencies).
2. Relative imports from project modules, including adjacent type imports.

The repository does not enforce a separate import sorter; preserve nearby file organization and group related imports.

**Path Aliases:**

- Use import-map aliases from `deno.json`, e.g. `@hono/hono`, `@std/assert`, `@std/path`, `zod`, and `nostr-tools/pure`.
- Relative imports always include their extension.

## Error Handling

**Patterns:**

- For expected HTTP failures in route handlers, return `errorResponse(ctx, status, reason)` from `src/middleware/errors.ts`; this includes the protocol
  `X-Reason` header.
- Throw `HTTPException` for middleware or helper failures that are handled by Hono's error handler; see `src/middleware/auth.ts` and `src/middleware/errors.ts`.
- Auth parsing middleware populates context only; every route must explicitly invoke `requireAuth()` or `optionalAuth()` as appropriate.
- Cancel a potentially active streaming request body before returning a rejection. Keep uploads on Web Streams instead of buffering full bodies.
- Catch best-effort cleanup and non-critical side effects explicitly; normalize unknown worker errors with `err instanceof Error ? err.message : String(err)`.
- Make discriminated union switches exhaustive with a `never` assignment, as in `src/db/bridge.ts`.

## Logging

**Framework:** `console` with the `debug()` helper in `src/middleware/debug.ts`.

**Patterns:**

- Use `debug()` for opt-in diagnostic details; use `console.warn` for recoverable cleanup failures and `console.error` for unhandled errors.
- Avoid logging secrets or full credential-bearing configuration.

## Comments

**When to Comment:**

- Document protocol requirements, security boundaries, non-obvious resource lifecycle, and intentional compatibility behavior.
- Prefer comments that explain why an invariant exists. Route and helper modules commonly start with a short protocol/context block.

**JSDoc/TSDoc:**

- Add concise JSDoc to exported helpers and non-obvious public contracts; include parameter semantics where useful.

## Function Design

**Size:** Keep route handlers readable by validating inputs early and extracting reusable pure helpers when behavior can be tested independently.

**Parameters:** Use named options objects for multi-option helpers; use interfaces for injected service boundaries.

**Return Values:** Use explicit result types and `null`/`undefined` where absence is part of the contract. Route branches return `Response` values; streaming
helpers preserve streams.

## Module Design

**Exports:** Export focused functions, classes, and interfaces from their owning module. Keep implementation details private unless another module or test needs
them.

**Barrel Files:** No general barrel-file convention is present; import from the defining module.

**JSX:** Keep `.tsx` for JSX. Use the `hono/jsx` import source pragma where required, and type function components with `FC` from Hono JSX (`src/admin/` and
`src/landing/`).

---

_Convention analysis: 2026-09-30_
