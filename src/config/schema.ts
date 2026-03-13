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
    .default(100 * 1024 * 1024), // 100MB
  // Number of hash worker threads. 0 = navigator.hardwareConcurrency.
  // No queue: pool full → 503 immediately.
  hashWorkers: z.number().int().min(0).default(0),
  // Allowed MIME types. Empty array = all types allowed.
  allowedTypes: z.array(z.string()).default([]),
});

const ListSchema = z.object({
  // BUD-02 list is unrecommended; off by default
  enabled: z.boolean().default(false),
  requireAuth: z.boolean().default(false),
  allowListOthers: z.boolean().default(true),
});

const DeleteSchema = z.object({
  requireAuth: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  // Override the domain used in blob URLs.
  // Defaults to the Host header of the incoming request.
  publicDomain: z.string().default(""),
  databasePath: z.string().default("data/sqlite.db"),
  port: z.number().int().min(1).max(65535).default(3000),
  storage: StorageSchema.optional().transform((v) =>
    v ?? StorageSchema.parse({})
  ),
  upload: UploadSchema.optional().transform((v) => v ?? UploadSchema.parse({})),
  list: ListSchema.optional().transform((v) => v ?? ListSchema.parse({})),
  delete: DeleteSchema.optional().transform((v) => v ?? DeleteSchema.parse({})),
});

export type Config = z.infer<typeof ConfigSchema>;
export type StorageRule = z.infer<typeof StorageRuleSchema>;
