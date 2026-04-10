export type FileStatus =
  | "pending"
  | "hashing"
  | "checking"
  | "signing"
  | "uploading"
  | "done"
  | "exists"
  | "skipped"
  | "retrying"
  | "error";

export type MirrorStatus =
  | "pending"
  | "signing"
  | "mirroring"
  | "done"
  | "exists"
  | "retrying"
  | "error";

export type Tab = "upload" | "mirror";

export interface BlobDescriptor {
  sha256: string;
  size: number;
  type: string;
  url: string;
}

export interface UploadResult {
  descriptor: BlobDescriptor;
  /** HTTP status: 200 = already existed, 201 = newly created */
  status: number;
}

export interface UploadFile {
  id: string;
  file: File;
  status: FileStatus;
  /** Upload byte progress 0–100 */
  progress: number;
  result?: BlobDescriptor;
  error?: string;
  /** Whether to route this file through /media */
  optimize: boolean;
}

export interface MirrorItem {
  id: string;
  /** Original string the user pasted — shown in the UI */
  displayUrl: string;
  /** HTTP/S URL sent to PUT /mirror body (resolved from xs hint for blossom: URIs) */
  mirrorUrl: string;
  /** Primary 64-char sha256 hex (last hash found in the URL path) */
  sha256: string;
  /** All unique hashes found in the URL — used in auth event x-tags */
  allHashes: string[];
  status: MirrorStatus;
  result?: BlobDescriptor;
  error?: string;
}
