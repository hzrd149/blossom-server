/** @jsxImportSource hono/jsx/dom */
/** @jsxRuntime automatic */
/**
 * Client-side upload + mirror form — runs in the browser.
 *
 * Bundled with `deno task bundle` into client.bundle.js.
 * Hydrates the #upload-root div rendered by upload-island.tsx (SSR).
 *
 * Nostr signing uses NIP-07 window.nostr (browser extension).
 * SHA-256 is computed via WebCrypto (available in all modern browsers).
 */
import { useCallback, useEffect, useRef, useState } from "hono/jsx/dom";
import { render } from "hono/jsx/dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileStatus =
  | "pending"
  | "hashing"
  | "signing"
  | "uploading"
  | "done"
  | "error";

type MirrorStatus = "pending" | "signing" | "mirroring" | "done" | "error";

interface UploadFile {
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

interface MirrorItem {
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

interface BlobDescriptor {
  sha256: string;
  size: number;
  type: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHA256_RE = /\b([0-9a-f]{64})\b/i;

/**
 * Parse a line of text as a Blossom URL or BUD-10 blossom: URI.
 *
 * Supported formats:
 *   - BUD-10:  blossom:<sha256>.<ext>[?xs=server&...]   (no "//" after scheme)
 *   - HTTP/S:  https://cdn.example.com/<sha256>[.ext]
 *   - Bare:    <64-char hex>
 *
 * Returns { displayUrl, mirrorUrl, sha256 }:
 *   - displayUrl  — shown in the UI (the original pasted string)
 *   - mirrorUrl   — HTTP/S URL sent to PUT /mirror body (resolved from xs param
 *                   for blossom: URIs, or the original for http/https)
 *   - sha256      — 64-char hex hash for the auth event x tag
 *
 * Returns null if no valid hash can be found.
 */
function parseBlossomRef(
  raw: string,
): { displayUrl: string; mirrorUrl: string; sha256: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // BUD-10: blossom:<sha256>.<ext>[?params]
  // Scheme is "blossom:" followed immediately by the hash — no "//".
  if (/^blossom:/i.test(trimmed)) {
    const rest = trimmed.slice("blossom:".length);
    // Hash is everything before the first "." or "?"
    const hashPart = rest.split(/[.?]/)[0];
    const match = SHA256_RE.exec(hashPart);
    if (!match) return null;
    const sha256 = match[1].toLowerCase();

    // Extract extension and xs (server hint) from the URI
    const dotIdx = rest.indexOf(".");
    const extAndQuery = dotIdx >= 0 ? rest.slice(dotIdx) : "";
    const qIdx = extAndQuery.indexOf("?");
    const ext = qIdx >= 0 ? extAndQuery.slice(0, qIdx) : extAndQuery; // e.g. ".pdf"
    const query = qIdx >= 0 ? extAndQuery.slice(qIdx + 1) : "";

    // Resolve to an HTTP URL using the first xs hint, or fall back to bare hash path
    let mirrorUrl: string;
    const params = new URLSearchParams(query);
    const xs = params.get("xs");
    if (xs) {
      // xs may include a scheme or just a domain
      const base = /^https?:\/\//i.test(xs) ? xs : `https://${xs}`;
      mirrorUrl = `${base.replace(/\/$/, "")}/${sha256}${ext || ""}`;
    } else {
      // No server hint — we can't resolve it to HTTP; store the blossom: URI
      // and the server will reject it with a useful error
      mirrorUrl = trimmed;
    }

    return { displayUrl: trimmed, mirrorUrl, sha256 };
  }

  // HTTP/HTTPS URL — hash must appear somewhere in the path
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") {
      const match = SHA256_RE.exec(u.pathname);
      if (match) {
        return {
          displayUrl: trimmed,
          mirrorUrl: trimmed,
          sha256: match[1].toLowerCase(),
        };
      }
    }
  } catch {
    // Not a URL — try bare 64-char hex hash
    const bare = trimmed.split(/[?#]/)[0];
    if (/^[0-9a-f]{64}$/i.test(bare)) {
      return {
        displayUrl: trimmed,
        mirrorUrl: trimmed,
        sha256: bare.toLowerCase(),
      };
    }
  }

  return null;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(2)} ${units[i]}`;
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

/** XHR-based PUT upload with real upload progress. */
function xhrUpload(
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
async function mirrorPut(
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

async function hashBatch(
  files: UploadFile[],
  onFileStatus: (id: string, status: FileStatus) => void,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (const uf of files) {
    onFileStatus(uf.id, "hashing");
    const hash = await sha256Hex(uf.file);
    results.set(uf.id, hash);
  }
  return results;
}

const MAX_X_TAGS_PER_EVENT = 60;

/** Build a BUD-11 kind 24242 auth event covering a batch of hashes. */
async function signBatch(
  // deno-lint-ignore no-explicit-any
  nostr: any,
  hashes: string[],
  authVerb: string,
  content: string,
): Promise<string> {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const authEvent = await nostr.signEvent({
    kind: 24242,
    content,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", authVerb],
      ...hashes.map((h) => ["x", h]),
      ["expiration", String(expiration)],
    ],
  });
  return "Nostr " + btoa(JSON.stringify(authEvent));
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  pending: "Pending",
  hashing: "Hashing...",
  signing: "Signing...",
  uploading: "Uploading",
  done: "Done",
  error: "Error",
};

const MIRROR_STATUS_LABEL: Record<MirrorStatus, string> = {
  pending: "Pending",
  signing: "Signing...",
  mirroring: "Mirroring...",
  done: "Done",
  error: "Error",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  hashing: "bg-blue-900 text-blue-300",
  signing: "bg-purple-900 text-purple-300",
  uploading: "bg-blue-900 text-blue-300",
  mirroring: "bg-blue-900 text-blue-300",
  done: "bg-green-900 text-green-300",
  error: "bg-red-900 text-red-300",
};

function FileRow(
  { uf, onRemove, onCopy }: {
    key?: string;
    uf: UploadFile;
    onRemove: (id: string) => void;
    onCopy: (url: string) => void;
  },
) {
  const showProgress = uf.status === "uploading" || uf.status === "done";
  const pct = uf.status === "done" ? 100 : uf.progress;

  return (
    <div class="bg-gray-800 rounded-lg px-4 py-3 space-y-2 min-w-0">
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="flex-1 text-sm text-white truncate font-medium min-w-0"
          title={uf.file.name}
        >
          {uf.file.name}
        </span>
        <span class="shrink-0 text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {formatBytes(uf.file.size)}
        </span>
        {uf.status === "pending" && (
          <button
            type="button"
            class="shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-700"
            onClick={() => onRemove(uf.id)}
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>

      {uf.status !== "pending" && (
        <div class="flex items-center gap-2 min-w-0">
          <span
            class={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
              STATUS_COLOR[uf.status]
            }`}
          >
            {FILE_STATUS_LABEL[uf.status]}
            {uf.status === "uploading" && ` ${pct}%`}
          </span>
          {uf.status === "done" && uf.result && (
            <>
              <span class="flex-1 text-xs text-gray-500 font-mono truncate min-w-0">
                {uf.result.url}
              </span>
              <button
                type="button"
                class="shrink-0 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-0.5 rounded whitespace-nowrap"
                onClick={() => onCopy(uf.result!.url)}
              >
                Copy
              </button>
            </>
          )}
          {uf.status === "error" && uf.error && (
            <span class="flex-1 text-xs text-red-400 min-w-0 break-words">
              {uf.error}
            </span>
          )}
        </div>
      )}

      {showProgress && (
        <div class="w-full bg-gray-700 rounded-full h-1.5">
          <div
            class={`h-1.5 rounded-full transition-all duration-200 ${
              uf.status === "done" ? "bg-green-500" : "bg-blue-500"
            }`}
            style={`width:${pct}%`}
          />
        </div>
      )}
    </div>
  );
}

function MirrorRow(
  { item, onRemove, onCopy }: {
    key?: string;
    item: MirrorItem;
    onRemove: (id: string) => void;
    onCopy: (url: string) => void;
  },
) {
  return (
    <div class="bg-gray-800 rounded-lg px-4 py-3 space-y-2 min-w-0">
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="flex-1 text-xs text-gray-400 font-mono truncate min-w-0"
          title={item.displayUrl}
        >
          {item.displayUrl}
        </span>
        {item.status === "pending" && (
          <button
            type="button"
            class="shrink-0 text-gray-500 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-700"
            onClick={() => onRemove(item.id)}
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>

      {item.status !== "pending" && (
        <div class="flex items-center gap-2 min-w-0">
          <span
            class={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${
              STATUS_COLOR[item.status]
            }`}
          >
            {MIRROR_STATUS_LABEL[item.status]}
          </span>
          {item.status === "done" && item.result && (
            <>
              <span class="flex-1 text-xs text-gray-500 font-mono truncate min-w-0">
                {item.result.url}
              </span>
              <button
                type="button"
                class="shrink-0 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-0.5 rounded whitespace-nowrap"
                onClick={() => onCopy(item.result!.url)}
              >
                Copy
              </button>
            </>
          )}
          {item.status === "error" && item.error && (
            <span class="flex-1 text-xs text-red-400 min-w-0 break-words">
              {item.error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UploadForm
// ---------------------------------------------------------------------------

function UploadForm(
  { requireAuth, mediaEnabled, mediaRequireAuth, onQueueChange }: {
    requireAuth: boolean;
    mediaEnabled: boolean;
    mediaRequireAuth: boolean;
    onQueueChange: (hasItems: boolean) => void;
  },
) {
  const [queue, setQueue] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [globalOptimize, setGlobalOptimize] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const activeCount = useRef<number>(0);
  const queueRef = useRef<UploadFile[]>([]);
  queueRef.current = queue;

  useEffect(() => {
    onQueueChange(queue.length > 0);
  }, [queue.length, onQueueChange]);

  const patchFile = useCallback((id: string, patch: Partial<UploadFile>) => {
    setQueue((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const newItems: UploadFile[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "pending" as FileStatus,
      progress: 0,
      optimize: globalOptimize && mediaEnabled && isMediaFile(file),
    }));
    setQueue((prev) => [...prev, ...newItems]);
  }, [globalOptimize, mediaEnabled]);

  const removeFile = useCallback(
    (id: string) => setQueue((prev) => prev.filter((f) => f.id !== id)),
    [],
  );

  const clearDone = useCallback(() => {
    setQueue((prev) =>
      prev.filter((f) => f.status !== "done" && f.status !== "error")
    );
  }, []);

  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleInputChange = useCallback((e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (files?.length) {
      addFiles(files);
      (e.target as HTMLInputElement).value = "";
    }
  }, [addFiles]);

  const uploadOne = useCallback(
    async (uf: UploadFile, authHeader: string | undefined) => {
      const endpoint = uf.optimize ? "/media" : "/upload";
      try {
        patchFile(uf.id, { status: "uploading", progress: 0 });
        const headers: Record<string, string> = {
          "Content-Type": uf.file.type || "application/octet-stream",
        };
        if (authHeader) headers["Authorization"] = authHeader;
        const result = await xhrUpload(
          endpoint,
          uf.file,
          headers,
          (pct) => patchFile(uf.id, { progress: pct }),
        );
        patchFile(uf.id, { status: "done", progress: 100, result });
      } catch (err) {
        patchFile(uf.id, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [patchFile],
  );

  const runQueue = useCallback(async () => {
    const currentQueue = queueRef.current;
    const pending = currentQueue.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    const needsAuth = pending.some((f) =>
      f.optimize ? mediaRequireAuth : requireAuth
    );

    if (!needsAuth) {
      const semSlots = Math.max(0, concurrency - activeCount.current);
      const toStart = pending.slice(0, semSlots);
      for (const uf of toStart) {
        activeCount.current++;
        uploadOne(uf, undefined).finally(() => {
          activeCount.current--;
          runQueue();
        });
      }
      return;
    }

    // deno-lint-ignore no-explicit-any
    const nostr = (globalThis as any).nostr;
    if (!nostr) {
      for (const uf of pending) {
        patchFile(uf.id, {
          status: "error",
          error: "No Nostr extension detected. Install Alby or nos2x.",
        });
      }
      return;
    }

    const regularPending = pending.filter((f) => !f.optimize);
    const mediaPending = pending.filter((f) => f.optimize);

    for (
      const [group, verb, content] of [
        [regularPending, "upload", "Upload files"] as const,
        [mediaPending, "media", "Optimize and upload media"] as const,
      ]
    ) {
      if (group.length === 0) continue;

      const hashes = await hashBatch(
        group,
        (id, status) => patchFile(id, { status }),
      );

      for (let i = 0; i < group.length; i += MAX_X_TAGS_PER_EVENT) {
        const batch = group.slice(i, i + MAX_X_TAGS_PER_EVENT);
        const batchHashes = batch.map((f) => hashes.get(f.id)!);

        for (const uf of batch) patchFile(uf.id, { status: "signing" });

        let authHeader: string;
        try {
          authHeader = await signBatch(nostr, batchHashes, verb, content);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          for (const uf of batch) {
            patchFile(uf.id, { status: "error", error: msg });
          }
          continue;
        }

        const uploadWithSlot = async (uf: UploadFile) => {
          while (activeCount.current >= concurrency) {
            await new Promise<void>((res) => setTimeout(res, 50));
          }
          activeCount.current++;
          try {
            await uploadOne(uf, authHeader);
          } finally {
            activeCount.current--;
          }
        };

        await Promise.all(batch.map(uploadWithSlot));
      }
    }
  }, [requireAuth, mediaRequireAuth, concurrency, patchFile, uploadOne]);

  const handleUpload = useCallback(() => runQueue(), [runQueue]);

  const isWorking = queue.some((f) =>
    f.status === "hashing" || f.status === "signing" || f.status === "uploading"
  );
  const hasDoneOrError = queue.some((f) =>
    f.status === "done" || f.status === "error"
  );
  const hasPending = queue.some((f) => f.status === "pending");
  const showOptimizeToggle = mediaEnabled &&
    queue.some((f) => isMediaFile(f.file));
  const allDone = queue.length > 0 &&
    queue.every((f) => f.status === "done" || f.status === "error");
  const canUpload = hasPending && !isWorking;
  const doneUrls = queue
    .filter((f) => f.status === "done" && f.result)
    .map((f) => f.result!.url);

  const copyAllUrls = useCallback(() => {
    navigator.clipboard.writeText(doneUrls.join("\n")).catch(() => {});
  }, [doneUrls]);

  return (
    <div class="p-6 space-y-4">
      {queue.length > 0 && (
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-2 text-sm text-gray-400">
            <span>Concurrent uploads</span>
            <input
              type="number"
              min="1"
              max="10"
              value={concurrency}
              disabled={isWorking}
              class="w-14 bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 text-sm text-center disabled:opacity-50"
              onChange={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (v >= 1 && v <= 10) setConcurrency(v);
              }}
            />
          </label>
          {showOptimizeToggle && (
            <label class="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-400">
              <input
                type="checkbox"
                class="w-4 h-4 rounded accent-blue-500"
                checked={globalOptimize}
                disabled={isWorking}
                onChange={(e) =>
                  setGlobalOptimize((e.target as HTMLInputElement).checked)}
              />
              <span>
                Optimize media
                <span class="ml-1 text-gray-500 text-xs">(via /media)</span>
              </span>
            </label>
          )}
          {hasDoneOrError && !isWorking && (
            <button
              type="button"
              class="ml-auto text-xs text-gray-500 hover:text-gray-300 underline"
              onClick={clearDone}
            >
              Clear finished
            </button>
          )}
        </div>
      )}

      <label
        class={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-950"
            : "border-gray-700 hover:border-gray-500"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          class="sr-only"
          onChange={handleInputChange}
        />
        {queue.length > 0
          ? <p class="text-sm text-gray-400">Drop more files or click to add</p>
          : (
            <div class="space-y-2">
              <p class="text-gray-300">Drop files here or click to select</p>
              <p class="text-xs text-gray-500">
                {requireAuth
                  ? "Nostr extension required to sign uploads"
                  : "No auth required"}
              </p>
            </div>
          )}
      </label>

      {queue.length > 0 && (
        <div class="space-y-2">
          {queue.map((uf) => (
            <FileRow
              key={uf.id}
              uf={uf}
              onRemove={removeFile}
              onCopy={copyUrl}
            />
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <button
          type="button"
          class={`w-full py-3 rounded-xl font-semibold transition-colors ${
            canUpload
              ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`}
          onClick={handleUpload}
          disabled={!canUpload}
        >
          {isWorking
            ? "Uploading…"
            : canUpload
            ? `Upload ${
              queue.filter((f) => f.status === "pending").length
            } file${
              queue.filter((f) => f.status === "pending").length === 1
                ? ""
                : "s"
            }`
            : allDone
            ? "All done"
            : "Upload"}
        </button>
      )}

      {allDone && (
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-gray-500">
            {queue.filter((f) => f.status === "done").length} succeeded ·{" "}
            {queue.filter((f) => f.status === "error").length} failed
          </p>
          {doneUrls.length > 0 && (
            <button
              type="button"
              class="shrink-0 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700"
              onClick={copyAllUrls}
            >
              Copy all URLs
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MirrorForm
// ---------------------------------------------------------------------------

type MirrorPhase = "input" | "list";

function MirrorForm(
  { requireAuth, onQueueChange }: {
    requireAuth: boolean;
    onQueueChange: (hasItems: boolean) => void;
  },
) {
  const [phase, setPhase] = useState<MirrorPhase>("input");
  const [inputText, setInputText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [items, setItems] = useState<MirrorItem[]>([]);
  const itemsRef = useRef<MirrorItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    onQueueChange(phase === "list" && items.length > 0);
  }, [phase, items.length, onQueueChange]);

  const patchItem = useCallback(
    (id: string, patch: Partial<MirrorItem>) => {
      setItems((prev) =>
        prev.map((it) => it.id === id ? { ...it, ...patch } : it)
      );
    },
    [],
  );

  /** Parse the textarea and move to the list phase. */
  const handleNext = useCallback(() => {
    const lines = inputText.split(/[\n,]+/);
    const parsed: MirrorItem[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const ref = parseBlossomRef(line);
      if (!ref) continue;
      if (seen.has(ref.sha256)) continue;
      seen.add(ref.sha256);
      parsed.push({
        id: crypto.randomUUID(),
        displayUrl: ref.displayUrl,
        mirrorUrl: ref.mirrorUrl,
        sha256: ref.sha256,
        status: "pending",
      });
    }

    if (parsed.length === 0) {
      setParseError(
        "No valid Blossom URLs or blossom:// URIs found. Each must contain a 64-character hex hash.",
      );
      return;
    }

    setParseError(null);
    setItems(parsed);
    setPhase("list");
  }, [inputText]);

  const handleBack = useCallback(() => {
    setPhase("input");
    setItems([]);
  }, []);

  const removeItem = useCallback(
    (id: string) => setItems((prev) => prev.filter((it) => it.id !== id)),
    [],
  );

  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
  }, []);

  const clearDone = useCallback(() => {
    setItems((prev) =>
      prev.filter((it) => it.status !== "done" && it.status !== "error")
    );
  }, []);

  const runMirror = useCallback(async () => {
    const current = itemsRef.current;
    const pending = current.filter((it) => it.status === "pending");
    if (pending.length === 0) return;

    if (!requireAuth) {
      // No auth — fire all concurrently (server handles its own limit)
      await Promise.all(pending.map(async (item) => {
        patchItem(item.id, { status: "mirroring" });
        try {
          const result = await mirrorPut(item.mirrorUrl);
          patchItem(item.id, { status: "done", result });
        } catch (err) {
          patchItem(item.id, {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }));
      return;
    }

    // Auth required — batch sign, then mirror concurrently per batch
    // deno-lint-ignore no-explicit-any
    const nostr = (globalThis as any).nostr;
    if (!nostr) {
      for (const it of pending) {
        patchItem(it.id, {
          status: "error",
          error: "No Nostr extension detected. Install Alby or nos2x.",
        });
      }
      return;
    }

    for (let i = 0; i < pending.length; i += MAX_X_TAGS_PER_EVENT) {
      const batch = pending.slice(i, i + MAX_X_TAGS_PER_EVENT);
      const hashes = batch.map((it) => it.sha256);

      for (const it of batch) patchItem(it.id, { status: "signing" });

      let authHeader: string;
      try {
        authHeader = await signBatch(nostr, hashes, "upload", "Mirror blobs");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const it of batch) {
          patchItem(it.id, { status: "error", error: msg });
        }
        continue;
      }

      await Promise.all(batch.map(async (item) => {
        patchItem(item.id, { status: "mirroring" });
        try {
          const result = await mirrorPut(item.mirrorUrl, authHeader);
          patchItem(item.id, { status: "done", result });
        } catch (err) {
          patchItem(item.id, {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }));
    }
  }, [requireAuth, patchItem]);

  const isWorking = items.some(
    (it) => it.status === "signing" || it.status === "mirroring",
  );
  const hasPending = items.some((it) => it.status === "pending");
  const hasDoneOrError = items.some(
    (it) => it.status === "done" || it.status === "error",
  );
  const allDone = items.length > 0 &&
    items.every((it) => it.status === "done" || it.status === "error");
  const canMirror = hasPending && !isWorking;
  const doneUrls = items
    .filter((it) => it.status === "done" && it.result)
    .map((it) => it.result!.url);

  const copyAllUrls = useCallback(() => {
    navigator.clipboard.writeText(doneUrls.join("\n")).catch(() => {});
  }, [doneUrls]);

  // ---- Phase: input --------------------------------------------------------
  if (phase === "input") {
    return (
      <div class="p-6 space-y-4">
        <p class="text-sm text-gray-400">
          Paste Blossom URLs or{" "}
          <code class="text-gray-300 bg-gray-800 px-1 rounded">
            blossom://
          </code>{" "}
          URIs below, one per line (or comma-separated).
        </p>
        <textarea
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm font-mono rounded-lg px-3 py-2 resize-y min-h-32 focus:outline-none focus:border-gray-500 placeholder-gray-600"
          placeholder={`https://cdn.example.com/abc123...def456.jpg\nblossom://abc123...def456\nabc123...def456`}
          value={inputText}
          onInput={(e) => setInputText((e.target as HTMLTextAreaElement).value)}
        />
        {parseError && (
          <p class="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">
            {parseError}
          </p>
        )}
        <button
          type="button"
          class={`w-full py-3 rounded-xl font-semibold transition-colors ${
            inputText.trim()
              ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }`}
          disabled={!inputText.trim()}
          onClick={handleNext}
        >
          Next
        </button>
      </div>
    );
  }

  // ---- Phase: list ---------------------------------------------------------
  return (
    <div class="p-6 space-y-4">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-400">
          {items.length} blob{items.length === 1 ? "" : "s"} to mirror
          {requireAuth && (
            <span class="ml-2 text-xs text-gray-500">
              · auth required
            </span>
          )}
        </p>
        {!isWorking && (
          <button
            type="button"
            class="text-xs text-gray-500 hover:text-gray-300 underline"
            onClick={handleBack}
          >
            ← Edit URLs
          </button>
        )}
      </div>

      {hasDoneOrError && !isWorking && (
        <div class="flex justify-end">
          <button
            type="button"
            class="text-xs text-gray-500 hover:text-gray-300 underline"
            onClick={clearDone}
          >
            Clear finished
          </button>
        </div>
      )}

      <div class="space-y-2">
        {items.map((item) => (
          <MirrorRow
            key={item.id}
            item={item}
            onRemove={removeItem}
            onCopy={copyUrl}
          />
        ))}
      </div>

      <button
        type="button"
        class={`w-full py-3 rounded-xl font-semibold transition-colors ${
          canMirror
            ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            : "bg-gray-800 text-gray-500 cursor-not-allowed"
        }`}
        onClick={runMirror}
        disabled={!canMirror}
      >
        {isWorking
          ? "Mirroring…"
          : canMirror
          ? `Mirror ${
            items.filter((it) => it.status === "pending").length
          } blob${
            items.filter((it) => it.status === "pending").length === 1
              ? ""
              : "s"
          }`
          : allDone
          ? "All done"
          : "Mirror"}
      </button>

      {allDone && (
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-gray-500">
            {items.filter((it) => it.status === "done").length} succeeded ·{" "}
            {items.filter((it) => it.status === "error").length} failed
          </p>
          {doneUrls.length > 0 && (
            <button
              type="button"
              class="shrink-0 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700"
              onClick={copyAllUrls}
            >
              Copy all URLs
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App — tab shell
// ---------------------------------------------------------------------------

type Tab = "upload" | "mirror";

function App(
  {
    requireAuth,
    mediaEnabled,
    mediaRequireAuth,
    mirrorEnabled,
    mirrorRequireAuth,
  }: {
    requireAuth: boolean;
    mediaEnabled: boolean;
    mediaRequireAuth: boolean;
    mirrorEnabled: boolean;
    mirrorRequireAuth: boolean;
  },
) {
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  // Each tab reports whether it has active items so we can hide server-info
  const [uploadHasItems, setUploadHasItems] = useState(false);
  const [mirrorHasItems, setMirrorHasItems] = useState(false);

  const hasItems = uploadHasItems || mirrorHasItems;

  useEffect(() => {
    const el = document.getElementById("server-info");
    if (!el) return;
    el.style.display = hasItems ? "none" : "";
  }, [hasItems]);

  const tabClass = (tab: Tab) =>
    `px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
      activeTab === tab
        ? "border-blue-500 text-white"
        : "border-transparent text-gray-500 hover:text-gray-300"
    }`;

  return (
    <div>
      {/* Tab bar — only rendered when mirror is enabled */}
      {mirrorEnabled && (
        <div class="flex border-b border-gray-800 px-6 pt-4">
          <button
            type="button"
            class={tabClass("upload")}
            onClick={() => setActiveTab("upload")}
          >
            Upload
          </button>
          <button
            type="button"
            class={tabClass("mirror")}
            onClick={() => setActiveTab("mirror")}
          >
            Mirror
          </button>
        </div>
      )}

      {/* Tab panels */}
      {activeTab === "upload" && (
        <UploadForm
          requireAuth={requireAuth}
          mediaEnabled={mediaEnabled}
          mediaRequireAuth={mediaRequireAuth}
          onQueueChange={setUploadHasItems}
        />
      )}
      {activeTab === "mirror" && mirrorEnabled && (
        <MirrorForm
          requireAuth={mirrorRequireAuth}
          onQueueChange={setMirrorHasItems}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById("upload-root");
if (root) {
  render(
    <App
      requireAuth={root.dataset.requireAuth === "true"}
      mediaEnabled={root.dataset.mediaEnabled === "true"}
      mediaRequireAuth={root.dataset.mediaRequireAuth === "true"}
      mirrorEnabled={root.dataset.mirrorEnabled === "true"}
      mirrorRequireAuth={root.dataset.mirrorRequireAuth === "true"}
    />,
    root,
  );
}
