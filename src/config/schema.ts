import { z } from "zod";

export const StorageRuleSchema = z.object({
  type: z.string(), // e.g. "image/*", "*"
  expiration: z.string(), // e.g. "1 month", "7 days"
  pubkeys: z.array(z.string()).optional(),
});

const LocalStorageSchema = z.object({
  dir: z.string().default("./data/blobs"),
});

const S3StorageSchema = z.object({
  endpoint: z.string(),
  bucket: z.string(),
  accessKey: z.string(),
  secretKey: z.string(),
  region: z.string().optional(),
  // If set, GET /:sha256 redirects here instead of proxying
  publicURL: z.string().optional(),
  // Local directory used to buffer uploads before they are committed to S3.
  // Uploads are written here first; only verified blobs are transferred to S3.
  // Must have enough free space for the largest expected upload.
  // Default: "./data/s3-tmp"
  tmpDir: z.string().default("./data/s3-tmp"),
});

const StorageSchema = z.object({
  backend: z.enum(["local", "s3"]).default("local"),
  local: LocalStorageSchema.optional(),
  s3: S3StorageSchema.optional(),
  rules: z.array(StorageRuleSchema).default([
    { type: "image/*", expiration: "1 month" },
    { type: "video/*", expiration: "1 week" },
    { type: "*", expiration: "1 week" },
  ]),
  removeWhenNoOwners: z.boolean().default(false),
});

const UploadSchema = z.object({
  enabled: z.boolean().default(true),
  requireAuth: z.boolean().default(true),
  // Maximum blob size in bytes. Enforced from Content-Length header before body is read.
  maxSize: z
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024), // 2GB
  // Number of upload worker threads. 0 = navigator.hardwareConcurrency.
  // No queue: pool full → 503 immediately.
  workers: z.number().int().min(0).default(0),
  // Maximum number of concurrent upload jobs a single worker will accept.
  // Workers handle jobs concurrently (event loop is free during I/O), so
  // this prevents a single slow upload from monopolising a worker slot.
  maxJobsPerWorker: z.number().int().min(1).default(4),
  // How often (in ms) each worker reports its aggregate throughput to the pool.
  // The pool uses this to route new jobs to the least-loaded worker.
  // Lower values = more responsive routing; higher values = less message overhead.
  throughputWindowMs: z.number().int().min(100).default(1_000),
  // Allowed MIME types. Empty array = all types allowed.
  allowedTypes: z.array(z.string()).default([]),
});

const ImageOptimizeSchema = z.object({
  quality: z.number().int().min(0).max(100).default(90),
  // Produce progressive JPEG or PNG (interlaced) for large images.
  progressive: z.boolean().default(true),
  maxWidth: z.number().int().positive().default(1920),
  maxHeight: z.number().int().positive().default(1080),
  outputFormat: z.enum(["webp", "jpeg", "png"]).default("webp"),
  maintainAspectRatio: z.boolean().default(true),
  keepExif: z.boolean().default(false),
  // Max frame rate for animated GIF output (frames capped to this value).
  fps: z.number().int().positive().default(30),
});

const VideoOptimizeSchema = z.object({
  quality: z.number().int().min(0).max(100).default(90),
  maxHeight: z.number().int().positive().default(1080),
  maxFps: z.number().int().positive().default(30),
  format: z.enum(["mp4", "webm", "mkv"]).default("mp4"),
  // Audio codec. Must be compatible with the chosen format.
  // mp4/mkv: aac (default), mp3; webm: opus (default), vorbis
  audioCodec: z.enum(["aac", "mp3", "vorbis", "opus"]).default("aac"),
  // Video codec. Must be compatible with the chosen format.
  // mp4/mkv: libx264 (default), libx265; webm: vp9 (default), vp8
  videoCodec: z.enum(["libx264", "libx265", "vp8", "vp9"]).default("libx264"),
});

const MediaSchema = z.object({
  // Enable the PUT /media endpoint (BUD-05).
  enabled: z.boolean().default(false),
  requireAuth: z.boolean().default(true),
  // Maximum input file size in bytes. Default: 1GB.
  maxSize: z.number().int().positive().default(1024 * 1024 * 1024),
  image: ImageOptimizeSchema.optional().transform((v) =>
    v ?? ImageOptimizeSchema.parse({})
  ),
  video: VideoOptimizeSchema.optional().transform((v) =>
    v ?? VideoOptimizeSchema.parse({})
  ),
});

const MirrorSchema = z.object({
  // Enable the PUT /mirror endpoint (BUD-04).
  enabled: z.boolean().default(true),
  requireAuth: z.boolean().default(true),
  // Timeout in milliseconds for the outbound fetch to the origin server.
  // 0 = no timeout (not recommended in production).
  fetchTimeout: z.number().int().min(0).default(30_000),
});

const DeleteSchema = z.object({
  requireAuth: z.boolean().default(true),
});

const LandingSchema = z.object({
  // Enable the SSR landing page at GET /
  enabled: z.boolean().default(false),
  // Page title shown in <title> and <h1>
  title: z.string().default("Blossom Server"),
});

export const DatabaseSchema = z.object({
  // Local SQLite file path. Used when url is not set. Default: "data/sqlite.db".
  path: z.string().default("data/sqlite.db"),
  // Remote libSQL / Turso URL, e.g. "libsql://your-db.turso.io" or
  // "http://localhost:8080" for a local sqld container.
  // When set, path is ignored and each upload worker opens its own direct
  // connection (no MessageChannel bridge needed).
  url: z.string().optional(),
  // Auth token for remote libSQL / Turso. Not required for a local sqld container.
  authToken: z.string().optional(),
});

export type DatabaseConfig = z.infer<typeof DatabaseSchema>;

export const ConfigSchema = z
  .object({
    // Override the domain used in blob URLs.
    // Defaults to the Host header of the incoming request.
    publicDomain: z.string().default(""),
    // Deprecated: use the "database" section instead.
    // If "database" is absent this value seeds database.path.
    databasePath: z.string().optional(),
    database: DatabaseSchema.optional(),
    // Interface/hostname to bind the HTTP server to.
    // Use "0.0.0.0" to listen on all IPv4 interfaces.
    host: z.string().default("0.0.0.0"),
    port: z.number().int().min(1).max(65535).default(3000),
    storage: StorageSchema.optional().transform((v) =>
      v ?? StorageSchema.parse({})
    ),
    upload: UploadSchema.optional().transform((v) =>
      v ?? UploadSchema.parse({})
    ),
    mirror: MirrorSchema.optional().transform((v) =>
      v ?? MirrorSchema.parse({})
    ),
    delete: DeleteSchema.optional().transform((v) =>
      v ?? DeleteSchema.parse({})
    ),
    landing: LandingSchema.optional().transform((v) =>
      v ?? LandingSchema.parse({})
    ),
    media: MediaSchema.optional().transform((v) => v ?? MediaSchema.parse({})),
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
