// ---------------------------------------------------------------------------
// Network calls — XHR upload and PUT /mirror.
// ---------------------------------------------------------------------------

import type { BlobDescriptor } from "./types.ts";

/** XHR-based PUT upload with real upload progress. */
export function xhrUpload(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<BlobDescriptor> {
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
          resolve(JSON.parse(xhr.responseText) as BlobDescriptor);
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        const reason = xhr.getResponseHeader("X-Reason") ?? xhr.statusText;
        reject(new Error(`Failed (${xhr.status}): ${reason}`));
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
): Promise<BlobDescriptor> {
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
    const reason = res.headers.get("X-Reason") ?? res.statusText;
    throw new Error(`Failed (${res.status}): ${reason}`);
  }
  return res.json() as Promise<BlobDescriptor>;
}
