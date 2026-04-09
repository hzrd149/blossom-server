# Conventions

## Naming

- **Functions:** camelCase (e.g., `buildApp`, `parseAuthEvent`, `extractHostname`)
- **Types/Interfaces:** PascalCase with `I` prefix for interfaces (e.g., `BlossomVariables`, `IBlobStorage`)
- **Files:** lowercase with hyphens (e.g., `auth.ts`, `blossom-router.ts`)
- **Constants:** camelCase for module-level constants

## Formatting

- **Tool:** Prettier with Deno's built-in formatter
- **Line width:** 120 characters
- **Indentation:** 2 spaces, no tabs
- **Linter:** Deno's built-in linter (no ESLint config)

## Imports

- Explicit `.ts` extensions required on all local imports
- Import order: type-only imports first, then external packages, then local modules
- No path aliases configured

## Error Handling

- `HTTPException` from `@hono/hono` for all HTTP errors with explicit status codes
- Try/finally pattern for cleanup (e.g., temp files, resources)
- Never silent failures - always throw or log

## Logging

- `console.log/warn/error/debug` used directly
- Include context tags in log messages (e.g., `[upload]`, `[prune]`)
- JSDoc mandatory for exported functions

## Functions

- camelCase naming
- Builder functions prefixed with `build` (e.g., `buildApp`, `buildBlobDescriptor`)
- Max ~40 lines per function
- Explicit types always (parameters and return types)
- Return `null` not `undefined` for absent values

## Patterns

- Factory functions over classes for constructing objects
- Middleware-based request pipeline (Hono framework)
- Configuration via environment variables with typed accessors
- Async/await throughout (no raw promises or callbacks)
