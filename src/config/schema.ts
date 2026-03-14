import { z } from "zod";

export const StorageRuleSchema = z.object({
  type: z.string().describe(
    'MIME type pattern to match. Supports glob wildcards: "image/*" matches all image types, "*" matches everything.',
  ),
  expiration: z.string().describe(
    'How long a blob may go unaccessed before being pruned. Human-readable duration: "7 days", "1 month", "24 hours".',
  ),
  pubkeys: z.array(z.string()).optional().describe(
    "Optional list of Nostr pubkeys (hex) this rule applies to. When set, only blobs uploaded by one of these pubkeys are matched.",
  ),
});

const LocalStorageSchema = z.object({
  dir: z.string().default("./data/blobs").describe(
    "Directory where blob files are stored. Created automatically if it does not exist.",
  ),
});

const S3StorageSchema = z.object({
  endpoint: z.string().describe(
    'S3-compatible endpoint URL, e.g. "https://s3.amazonaws.com" or "https://nyc3.digitaloceanspaces.com".',
  ),
  bucket: z.string().describe("Name of the S3 bucket to store blobs in."),
  accessKey: z.string().describe(
    "S3 access key ID. Use ${ENV_VAR} syntax to read from an environment variable.",
  ),
  secretKey: z.string().describe(
    "S3 secret access key. Use ${ENV_VAR} syntax to read from an environment variable.",
  ),
  region: z.string().optional().describe(
    'S3 region, e.g. "us-east-1". Optional for some providers.',
  ),
  publicURL: z.string().optional().describe(
    "If set, GET /:sha256 redirects to this URL prefix instead of proxying the object. The blob hash and extension are appended automatically.",
  ),
  tmpDir: z.string().default("./data/s3-tmp").describe(
    "Local directory used to buffer upload data before committing to S3. Must be on a filesystem with enough free space for the largest expected upload.",
  ),
});

const StorageSchema = z.object({
  backend: z.enum(["local", "s3"]).default("local").describe(
    'Storage backend: "local" writes blobs to the local filesystem; "s3" uses an S3-compatible object store.',
  ),
  local: LocalStorageSchema.optional().describe(
    'Local filesystem storage settings. Only used when backend is "local".',
  ),
  s3: S3StorageSchema.optional().describe(
    'S3-compatible object storage settings. Only used when backend is "s3".',
  ),
  rules: z.array(StorageRuleSchema).default([
    { type: "image/*", expiration: "1 month" },
    { type: "video/*", expiration: "1 week" },
    { type: "*", expiration: "1 week" },
  ]).describe(
    "Ordered list of retention rules. Rules are evaluated in order; the first matching rule governs a blob's expiry. " +
      "Rules also act as an upload allowlist: blobs whose MIME type matches no rule are rejected with 415.",
  ),
  removeWhenNoOwners: z.boolean().default(false).describe(
    "When true, blobs with no owners are deleted during each prune cycle, regardless of expiry rules.",
  ),
});

const UploadSchema = z.object({
  enabled: z.boolean().default(true).describe(
    "Enable the PUT /upload endpoint (BUD-02). Set to false to make the server read-only.",
  ),
  requireAuth: z.boolean().default(true).describe(
    "Require a valid BUD-11 Nostr auth event for uploads. When false, anonymous uploads are accepted.",
  ),
  maxSize: z
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024)
    .describe(
      "Maximum blob size in bytes. Enforced from the Content-Length header before any body bytes are read. Requests without Content-Length receive 411. Default: 2 GB.",
    ),
  workers: z.number().int().min(0).default(0).describe(
    "Number of upload worker threads. 0 = one per CPU core (navigator.hardwareConcurrency). When all workers are at capacity, uploads receive 503 — there is no queue.",
  ),
  maxJobsPerWorker: z.number().int().min(1).default(4).describe(
    "Maximum concurrent upload jobs per worker. Workers interleave jobs during I/O, so a single slow upload does not block others. Raise for many small/slow uploads; lower for large CPU-bound uploads.",
  ),
  throughputWindowMs: z.number().int().min(100).default(1_000).describe(
    "How often (ms) each worker reports its throughput to the pool. The pool uses this to route new uploads to the least-loaded worker. Lower = more responsive; higher = less overhead.",
  ),
  allowedTypes: z.array(z.string()).default([]).describe(
    'Simple MIME type allowlist. Empty = all types accepted. Supports wildcards: "image/*". ' +
      "NOTE: when storage.rules is non-empty, rules act as the upload gate and allowedTypes is ignored.",
  ),
  requirePubkeyInRule: z.boolean().default(false).describe(
    "When true, uploads are rejected unless the uploader's pubkey appears in at least one storage rule's pubkeys list. Enables closed/invite-only servers.",
  ),
});

const ImageOptimizeSchema = z.object({
  quality: z.number().int().min(0).max(100).default(90).describe(
    "Output image quality, 0–100. Higher is better quality and larger file size.",
  ),
  progressive: z.boolean().default(true).describe(
    "Produce progressive JPEG or interlaced PNG for better streaming on slow connections. No effect when outputFormat is webp.",
  ),
  maxWidth: z.number().int().positive().default(1920).describe(
    "Maximum output width in pixels. Images wider than this are scaled down, preserving aspect ratio.",
  ),
  maxHeight: z.number().int().positive().default(1080).describe(
    "Maximum output height in pixels. Images taller than this are scaled down, preserving aspect ratio.",
  ),
  outputFormat: z.enum(["webp", "jpeg", "png"]).default("webp").describe(
    'Output image format. "webp" offers the best compression for web delivery.',
  ),
  maintainAspectRatio: z.boolean().default(true).describe(
    "Preserve aspect ratio when resizing. When false, images are stretched to exactly maxWidth×maxHeight.",
  ),
  keepExif: z.boolean().default(false).describe(
    "Keep EXIF metadata in the output file. When false (default), all EXIF data is stripped — recommended for privacy.",
  ),
  fps: z.number().int().positive().default(30).describe(
    "Maximum frame rate for animated GIF output. Frames exceeding this rate are dropped.",
  ),
});

const VideoOptimizeSchema = z.object({
  quality: z.number().int().min(0).max(100).default(90).describe(
    "Output video quality, 0–100, mapped to a CRF value. 100 = CRF 0 (lossless); 0 = CRF 51 (lowest quality).",
  ),
  maxHeight: z.number().int().positive().default(1080).describe(
    "Maximum output height in pixels. Width is scaled proportionally. Uses ffmpeg fit-inside scaling.",
  ),
  maxFps: z.number().int().positive().default(30).describe(
    "Maximum output frame rate. Frames above this threshold are dropped.",
  ),
  format: z.enum(["mp4", "webm", "mkv"]).default("mp4").describe(
    'Output container format. "mp4" is the most widely compatible; "webm" is preferred for web delivery.',
  ),
  audioCodec: z.enum(["aac", "mp3", "vorbis", "opus"]).default("aac").describe(
    'Audio codec. Must be compatible with the chosen format. mp4/mkv: "aac" (default), "mp3". webm: "opus" (default), "vorbis".',
  ),
  videoCodec: z.enum(["libx264", "libx265", "vp8", "vp9"]).default("libx264").describe(
    'Video codec. Must be compatible with the chosen format. mp4/mkv: "libx264" (default), "libx265". webm: "vp9" (default), "vp8".',
  ),
});

const MediaSchema = z.object({
  enabled: z.boolean().default(false).describe(
    "Enable the PUT /media endpoint (BUD-05). Clients upload an image or video; the server optimises it, stores the result, and returns the optimised blob's hash and URL. Requires ffmpeg on the host for video.",
  ),
  requireAuth: z.boolean().default(true).describe(
    "Require a valid BUD-11 Nostr auth event for media uploads.",
  ),
  maxSize: z.number().int().positive().default(1024 * 1024 * 1024).describe(
    "Maximum input file size in bytes before reading the body. Default: 1 GB.",
  ),
  image: ImageOptimizeSchema.optional().transform((v) =>
    v ?? ImageOptimizeSchema.parse({})
  ).describe("Image optimisation settings."),
  video: VideoOptimizeSchema.optional().transform((v) =>
    v ?? VideoOptimizeSchema.parse({})
  ).describe("Video transcoding settings."),
});

const MirrorSchema = z.object({
  enabled: z.boolean().default(true).describe(
    "Enable the PUT /mirror endpoint (BUD-04). Allows clients to request the server fetch and store a blob from a remote URL.",
  ),
  requireAuth: z.boolean().default(true).describe(
    "Require a valid BUD-11 Nostr auth event for mirror requests.",
  ),
  fetchTimeout: z.number().int().min(0).default(30_000).describe(
    "Timeout in milliseconds for the outbound fetch to the origin server. 0 = no timeout (not recommended in production).",
  ),
});

const DeleteSchema = z.object({
  requireAuth: z.boolean().default(true).describe(
    "Require a valid BUD-11 Nostr auth event to delete blobs. When false, any client may delete any blob.",
  ),
});

const LandingSchema = z.object({
  enabled: z.boolean().default(false).describe(
    "Enable the server-rendered landing page at GET /. Shows server info and stats.",
  ),
  title: z.string().default("Blossom Server").describe(
    "Page title displayed in <title> and <h1> on the landing page.",
  ),
});

const PruneSchema = z.object({
  initialDelayMs: z.number().int().min(0).default(60_000).describe(
    "Delay in milliseconds before the first prune run after server startup. Default: 60 seconds.",
  ),
  intervalMs: z.number().int().min(1000).default(30_000).describe(
    "Minimum gap in milliseconds between the end of one prune run and the start of the next. Uses recursive setTimeout, so the next run begins only after the current one completes. Default: 30 seconds.",
  ),
});

export const DatabaseSchema = z.object({
  path: z.string().default("data/sqlite.db").describe(
    "Path to the local SQLite database file. Ignored when url is set.",
  ),
  url: z.string().optional().describe(
    'Remote libSQL / Turso URL, e.g. "libsql://your-db.turso.io" for Turso cloud or "http://localhost:8080" for a local sqld container. When set, path is ignored.',
  ),
  authToken: z.string().optional().describe(
    "Auth token for Turso cloud. Not required for a local sqld container.",
  ),
});

export type DatabaseConfig = z.infer<typeof DatabaseSchema>;

export const ConfigSchema = z
  .object({
    publicDomain: z.string().default("").describe(
      "Override the domain used in blob descriptor URLs. Defaults to the Host header of the incoming HTTP request. Useful behind a reverse proxy.",
    ),
    // Deprecated: use the "database" section instead.
    // If "database" is absent this value seeds database.path.
    databasePath: z.string().optional().describe(
      "Deprecated. Use the database.path field instead.",
    ),
    database: DatabaseSchema.optional().describe("Database connection settings."),
    host: z.string().default("0.0.0.0").describe(
      'Interface/hostname to bind the HTTP server to. Use "0.0.0.0" to accept connections on all IPv4 interfaces.',
    ),
    port: z.number().int().min(1).max(65535).default(3000).describe(
      "TCP port to listen on.",
    ),
    storage: StorageSchema.optional().transform((v) =>
      v ?? StorageSchema.parse({})
    ).describe("Blob storage configuration."),
    upload: UploadSchema.optional().transform((v) =>
      v ?? UploadSchema.parse({})
    ).describe("Upload endpoint settings (BUD-02 / BUD-06)."),
    mirror: MirrorSchema.optional().transform((v) =>
      v ?? MirrorSchema.parse({})
    ).describe("Mirror endpoint settings (BUD-04)."),
    delete: DeleteSchema.optional().transform((v) =>
      v ?? DeleteSchema.parse({})
    ).describe("Delete endpoint settings (BUD-02)."),
    landing: LandingSchema.optional().transform((v) =>
      v ?? LandingSchema.parse({})
    ).describe("Landing page settings."),
    media: MediaSchema.optional().transform((v) => v ?? MediaSchema.parse({})).describe(
      "Media optimisation endpoint settings (BUD-05).",
    ),
    prune: PruneSchema.optional().transform((v) => v ?? PruneSchema.parse({})).describe(
      "Prune loop timing settings. The prune loop deletes expired blobs according to storage.rules.",
    ),
  })
  .transform((raw) => {
    // Merge deprecated databasePath into the database section.
    // Priority: database.path > databasePath > default "data/sqlite.db"
    const database = DatabaseSchema.parse({
      ...raw.database,
      ...(raw.database?.path === undefined && raw.databasePath !== undefined
        ? { path: raw.databasePath }
        : {}),
    });
    const { databasePath: _dropped, ...rest } = raw;
    return { ...rest, database };
  });

export type Config = z.infer<typeof ConfigSchema>;
export type StorageRule = z.infer<typeof StorageRuleSchema>;
export type ImageOptimizeConfig = z.infer<typeof ImageOptimizeSchema>;
export type VideoOptimizeConfig = z.infer<typeof VideoOptimizeSchema>;
export type MediaConfig = z.infer<typeof MediaSchema>;
