export type FileStatus =
  | "pending"
  | "hashing"
  | "signing"
  | "uploading"
  | "done"
  | "error";

export type MirrorStatus =
  | "pending"
  | "signing"
  | "mirroring"
  | "done"
  | "error";

export type Tab = "upload" | "mirror";

export interface BlobDescriptor {
  sha256: string;
  size: number;
  type: string;
  url: string;
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
  /** Extracted 64-char sha256 hex — used in the auth event x tag */
  sha256: string;
  status: MirrorStatus;
  result?: BlobDescriptor;
  error?: string;
}
