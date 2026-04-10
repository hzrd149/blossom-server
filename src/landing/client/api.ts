import type { UploadResult } from "./types.ts";
import { friendlyErrorMessage } from "./helpers.ts";

export interface PreflightResult {
  status: number;
  reason?: string;
}

/** Error subclass that preserves the HTTP status code for retry logic. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * HEAD /upload or HEAD /media preflight — checks whether the server will
 * accept the blob before sending bytes. Returns raw status + X-Reason.
 *
 *   200 → blob already exists on server (skip upload)
 *   204 → upload would be accepted (proceed)
 *   4xx → pre-rejection with reason
 */
export async function preflightUpload(
  endpoint: "/upload" | "/media",
  sha256: string,
  contentType: string,
  contentLength: number,
  authHeader?: string,
): Promise<PreflightResult> {
  const headers: Record<string, string> = {
    "X-SHA-256": sha256,
    "X-Content-Type": contentType,
    "X-Content-Length": String(contentLength),
  };
  if (authHeader) headers["Authorization"] = authHeader;

  const res = await fetch(endpoint, { method: "HEAD", headers });
  return {
    status: res.status,
    reason: res.headers.get("X-Reason") ?? undefined,
  };
}

/** XHR-based PUT upload with real upload progress. Returns status + descriptor. */
export function xhrUpload(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({
            descriptor: JSON.parse(xhr.responseText),
            status: xhr.status,
          });
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        const xReason = xhr.getResponseHeader("X-Reason") ?? undefined;
        const retryAfter = parseRetryAfter(
          xhr.getResponseHeader("Retry-After"),
        );
        reject(
          new HttpError(
            xhr.status,
            friendlyErrorMessage(xhr.status, xReason),
            retryAfter,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.send(file);
  });
}

/**
 * BUD-04 PUT /mirror — sends the blob URL as a JSON body per spec:
 *   { "url": "<blob-url>" }
 * The server fetches the blob itself; we just tell it where to find it.
 */
export async function mirrorPut(
  blobUrl: string,
  authHeader?: string,
): Promise<UploadResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers["Authorization"] = authHeader;

  const res = await fetch("/mirror", {
    method: "PUT",
    headers,
    body: JSON.stringify({ url: blobUrl }),
  });
  if (!res.ok) {
    const xReason = res.headers.get("X-Reason") ?? undefined;
    const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
    throw new HttpError(
      res.status,
      friendlyErrorMessage(res.status, xReason),
      retryAfter,
    );
  }
  const descriptor = await res.json();
  return { descriptor, status: res.status };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
