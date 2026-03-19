// ---------------------------------------------------------------------------
// Status display constants shared by FileRow and MirrorRow.
// ---------------------------------------------------------------------------

import type { FileStatus, MirrorStatus } from "./types.ts";

export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  pending: "Pending",
  hashing: "Hashing...",
  signing: "Signing...",
  uploading: "Uploading",
  done: "Done",
  error: "Error",
};

export const MIRROR_STATUS_LABEL: Record<MirrorStatus, string> = {
  pending: "Pending",
  signing: "Signing...",
  mirroring: "Mirroring...",
  done: "Done",
  error: "Error",
};

export const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  hashing: "bg-blue-900 text-blue-300",
  signing: "bg-purple-900 text-purple-300",
  uploading: "bg-blue-900 text-blue-300",
  mirroring: "bg-blue-900 text-blue-300",
  done: "bg-green-900 text-green-300",
  error: "bg-red-900 text-red-300",
};
