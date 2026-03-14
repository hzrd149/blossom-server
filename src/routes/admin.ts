/**
 * Admin API — HTTP Basic Auth protected.
 *
 * Implements the ra-data-simple-rest wire protocol consumed by the
 * pre-built React Admin SPA served at /admin.
 *
 * Endpoints:
 *   POST   /api/auth          — credential probe (login)
 *   GET    /api/blobs         — paginated blob list with owners
 *   GET    /api/blobs/:id     — single blob with owners
 *   DELETE /api/blobs/:id     — force-delete (no BUD-11 auth required)
 *   GET    /api/users         — list pubkeys with blob lists
 *   GET    /api/rules         — list storage rules from config
 *   GET    /api/rules/:id     — single storage rule
 *
 * Query parameter encoding (ra-data-simple-rest protocol):
 *   sort   = JSON([field, "ASC"|"DESC"])
 *   range  = JSON([startInclusive, endInclusive])  — 0-indexed, both inclusive
 *   filter = JSON({ q?, type?, pubkey?, ... })
 *
 * Response headers on list endpoints:
 *   Content-Range: <resource> <start>-<end>/<total>
 *   Content-Range: <resource> * /<total>  (when no range query param)
 *
 * Content-Range is listed in Access-Control-Expose-Headers (cors.ts) so
 * browser clients can read it.
 */

import { Hono } from "@hono/hono";
import { basicAuth } from "@hono/hono/basic-auth";
import type { Client } from "@libsql/client";
import type { IBlobStorage } from "../storage/interface.ts";
import type { Config } from "../config/schema.ts";
import {
  countBlobs,
  countUsers,
  deleteBlob,
  getBlob,
  listAllBlobs,
  listAllUsers,
} from "../db/blobs.ts";
import { mimeToExt } from "../utils/mime.ts";

// ── Wire-protocol helpers ────────────────────────────────────────────────────

/**
 * Parse the three ra-data-simple-rest query parameters.
 * All are JSON-encoded strings in the query string.
 */
function parseListQuery(query: Record<string, string>): {
  filter: Record<string, unknown>;
  sort: [string, string] | undefined;
  range: [number, number] | undefined;
} {
  let filter: Record<string, unknown> = {};
  let sort: [string, string] | undefined;
  let range: [number, number] | undefined;

  try {
    if (query.filter) filter = JSON.parse(query.filter);
  } catch { /* ignore malformed filter */ }

  try {
    if (query.sort) {
      const parsed = JSON.parse(query.sort);
      if (Array.isArray(parsed) && parsed.length === 2) {
        sort = [String(parsed[0]), String(parsed[1])];
      }
    }
  } catch { /* ignore malformed sort */ }

  try {
    if (query.range) {
      const parsed = JSON.parse(query.range);
      if (Array.isArray(parsed) && parsed.length === 2) {
        range = [Number(parsed[0]), Number(parsed[1])];
      }
    }
  } catch { /* ignore malformed range */ }

  return { filter, sort, range };
}

/**
 * Compute LIMIT and OFFSET from an inclusive [start, end] range pair.
 * ra-data-simple-rest uses 0-indexed, both-inclusive ranges.
 * LIMIT = end - start + 1  (fixes legacy off-by-one: legacy used end - start)
 */
function rangeToLimitOffset(range: [number, number]): { limit: number; offset: number } {
  return {
    limit: range[1] - range[0] + 1,
    offset: range[0],
  };
}

/**
 * Build the Content-Range response header value.
 *   with range:    "<resource> <start>-<end>/<total>"
 *   without range: "<resource> * /<total>"
 */
function contentRange(resource: string, range: [number, number] | undefined, total: number): string {
  if (range) {
    return `${resource} ${range[0]}-${range[1]}/${total}`;
  }
  return `${resource} */${total}`;
}

/**
 * Construct a public blob URL from hash + MIME type.
 * Prefers config.publicDomain; falls back to request Host header.
 */
function buildBlobUrl(
  hash: string,
  type: string | null,
  publicDomain: string,
  hostHeader: string,
): string {
  const ext = mimeToExt(type);
  const base = (publicDomain || `http://${hostHeader}`).replace(/\/$/, "");
  return `${base}/${hash}${ext ? "." + ext : ""}`;
}

// ── Router factory ───────────────────────────────────────────────────────────

export function buildAdminRouter(
  db: Client,
  storage: IBlobStorage,
  config: Config,
  password: string,
): Hono {
  const app = new Hono();

  // ── Basic Auth gate on all /api/* routes ───────────────────────────────────
  app.use(
    "/api/*",
    basicAuth({ username: config.dashboard.username, password }),
  );

  // ── POST /api/auth — credential probe ─────────────────────────────────────
  // The React Admin authProvider.login() POSTs here to verify credentials.
  // Basic Auth middleware already validated them; just return success.
  app.post("/api/auth", (c) => {
    return c.json({ success: true }, 200);
  });

  // ── GET /api/blobs — paginated blob list ───────────────────────────────────
  app.get("/api/blobs", async (c) => {
    const { filter, sort, range } = parseListQuery(c.req.query() as Record<string, string>);

    // Extract typed filter fields
    const blobFilter: { q?: string; type?: string | string[] } = {};
    if (typeof filter.q === "string") blobFilter.q = filter.q;
    if (typeof filter.type === "string") blobFilter.type = filter.type;
    if (Array.isArray(filter.type)) blobFilter.type = filter.type as string[];

    const { limit, offset } = range ? rangeToLimitOffset(range) : { limit: undefined, offset: undefined };

    const [blobs, total] = await Promise.all([
      listAllBlobs(db, { filter: blobFilter, sort, limit, offset }),
      countBlobs(db, blobFilter),
    ]);

    const host = c.req.header("host") ?? "localhost";
    const body = blobs.map((b) => ({
      ...b,
      id: b.sha256,
      url: buildBlobUrl(b.sha256, b.type, config.publicDomain, host),
    }));

    return c.json(body, 200, {
      "Content-Range": contentRange("blobs", range, total),
    });
  });

  // ── GET /api/blobs/:id — single blob ──────────────────────────────────────
  app.get("/api/blobs/:id", async (c) => {
    const hash = c.req.param("id");
    const blob = await getBlob(db, hash);
    if (!blob) {
      return c.json({ error: "Blob not found" }, 404);
    }

    // Fetch owners for this blob
    const [withOwners] = await listAllBlobs(db, {
      filter: { q: blob.sha256 },
      limit: 1,
    });
    // listAllBlobs q-filter does LIKE — confirm exact match
    const owners = withOwners?.sha256 === hash ? withOwners.owners : [];

    const host = c.req.header("host") ?? "localhost";
    return c.json({
      ...blob,
      owners,
      id: blob.sha256,
      url: buildBlobUrl(blob.sha256, blob.type, config.publicDomain, host),
    }, 200);
  });

  // ── DELETE /api/blobs/:id — admin force-delete ────────────────────────────
  // No BUD-11 auth required — admin credentials are sufficient.
  app.delete("/api/blobs/:id", async (c) => {
    const hash = c.req.param("id");
    const blob = await getBlob(db, hash);
    const ext = blob ? mimeToExt(blob.type) : "";

    // Delete from DB first (cascade removes owners + accessed rows)
    await deleteBlob(db, hash);

    // Remove physical file — best-effort, don't fail the response if missing
    await storage.remove(hash, ext).catch((err) =>
      console.warn(`[admin] Failed to remove blob ${hash} from storage:`, err)
    );

    return c.json({ success: true }, 200);
  });

  // ── GET /api/users — paginated user list ──────────────────────────────────
  app.get("/api/users", async (c) => {
    const { filter, sort, range } = parseListQuery(c.req.query() as Record<string, string>);

    const userFilter: { q?: string; pubkey?: string } = {};
    if (typeof filter.q === "string") userFilter.q = filter.q;
    if (typeof filter.pubkey === "string") userFilter.pubkey = filter.pubkey;

    const { limit, offset } = range ? rangeToLimitOffset(range) : { limit: undefined, offset: undefined };

    const [users, total] = await Promise.all([
      listAllUsers(db, { filter: userFilter, sort, limit, offset }),
      countUsers(db, userFilter),
    ]);

    // React Admin UserList reads record.profile.image / .name / .nip05
    // No Nostr profile fetching implemented — return null; component renders gracefully
    const body = users.map((u) => ({
      ...u,
      id: u.pubkey,
      profile: null,
    }));

    return c.json(body, 200, {
      "Content-Range": contentRange("users", range, total),
    });
  });

  // ── GET /api/rules — list storage rules ───────────────────────────────────
  app.get("/api/rules", (c) => {
    const { filter, sort, range } = parseListQuery(c.req.query() as Record<string, string>);

    let rules = config.storage.rules.map((r, i) => ({ ...r, id: i }));

    // Apply filter (simple field equality / array inclusion)
    if (Object.keys(filter).length > 0) {
      rules = rules.filter((rule) =>
        Object.entries(filter).every(([key, value]) => {
          const ruleVal = (rule as Record<string, unknown>)[key];
          if (Array.isArray(value)) return value.includes(ruleVal);
          return ruleVal === value;
        })
      );
    }

    const total = rules.length;

    // Apply sort — only "expiration" has special semantics; others ignored
    if (sort) {
      const [field, dir] = sort;
      if (field === "expiration") {
        // Sort lexicographically for now (good enough for display)
        rules.sort((a, b) => a.expiration.localeCompare(b.expiration));
        if (dir === "DESC") rules.reverse();
      } else if (field === "type") {
        rules.sort((a, b) => a.type.localeCompare(b.type));
        if (dir === "DESC") rules.reverse();
      }
    }

    // Apply range slice (ra-data-simple-rest: both ends inclusive)
    const sliced = range ? rules.slice(range[0], range[1] + 1) : rules;

    return c.json(sliced, 200, {
      "Content-Range": contentRange("rules", range, total),
    });
  });

  // ── GET /api/rules/:id — single rule ──────────────────────────────────────
  app.get("/api/rules/:id", (c) => {
    const idx = parseInt(c.req.param("id"), 10);
    const rule = config.storage.rules[idx];
    if (!rule || isNaN(idx)) {
      return c.json({ error: "Rule not found" }, 404);
    }
    return c.json({ ...rule, id: idx }, 200);
  });

  return app;
}

// Export type for future type-safe RPC client usage (Hono RPC pattern).
// A client can be created with: hc<AdminAppType>('/') from 'hono/client'
export type AdminAppType = ReturnType<typeof buildAdminRouter>;
