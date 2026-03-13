/** @jsxImportSource hono/jsx/dom */
/** @jsxRuntime automatic */
/**
 * Client-side upload form — runs in the browser.
 *
 * Bundled with `deno task bundle` into client.bundle.js.
 * Hydrates the #upload-root div rendered by upload-island.tsx (SSR).
 *
 * Nostr signing uses NIP-07 window.nostr (browser extension).
 * SHA-256 is computed via WebCrypto (available in all modern browsers).
 */
import { useState, useCallback } from "hono/jsx/dom";
import { render } from "hono/jsx/dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadStatus = "idle" | "hashing" | "signing" | "uploading" | "done" | "error";

interface UploadResult {
  sha256: string;
  size: number;
  type: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// UploadForm component
// ---------------------------------------------------------------------------

function UploadForm({ requireAuth }: { requireAuth: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const reset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer?.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleInputChange = useCallback((e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const upload = useCallback(async () => {
    if (!file) return;
    setError(null);

    try {
      let authHeader: string | undefined;

      if (requireAuth) {
        // Compute SHA-256 so we can sign it in the BUD-11 auth event
        setStatus("hashing");
        const hash = await sha256Hex(file);

        setStatus("signing");
        // deno-lint-ignore no-explicit-any
        const nostr = (globalThis as any).nostr;
        if (!nostr) {
          throw new Error(
            "No Nostr extension detected. Install Alby or nos2x to sign uploads.",
          );
        }

        const expiration = Math.floor(Date.now() / 1000) + 300; // 5 min
        const authEvent = await nostr.signEvent({
          kind: 24242,
          content: "Upload file",
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "upload"],
            ["x", hash],
            ["expiration", String(expiration)],
          ],
        });
        authHeader = "Nostr " + btoa(JSON.stringify(authEvent));
      }

      setStatus("uploading");
      const res = await fetch("/upload", {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: file,
      });

      if (!res.ok) {
        const reason = res.headers.get("X-Reason") ?? res.statusText;
        throw new Error(`Upload failed (${res.status}): ${reason}`);
      }

      const data: UploadResult = await res.json();
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [file, requireAuth]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (status === "done" && result) {
    return (
      <div class="space-y-4">
        <div class="bg-green-950 border border-green-800 rounded-xl p-6 space-y-3">
          <p class="text-green-400 font-semibold">Upload complete</p>
          <div class="space-y-1 text-sm text-gray-300">
            <p>
              <span class="text-gray-500">Size: </span>
              {formatBytes(result.size)}
            </p>
            <p>
              <span class="text-gray-500">Type: </span>
              {result.type || "unknown"}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <input
              class="flex-1 bg-gray-900 text-gray-200 text-xs font-mono px-3 py-2 rounded border border-gray-700 truncate"
              value={result.url}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              class="shrink-0 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs px-3 py-2 rounded border border-gray-700"
              onClick={() => navigator.clipboard.writeText(result.url)}
            >
              Copy
            </button>
          </div>
        </div>
        <button
          class="text-sm text-gray-400 underline hover:text-gray-200"
          onClick={reset}
        >
          Upload another
        </button>
      </div>
    );
  }

  const isWorking = status === "hashing" || status === "signing" ||
    status === "uploading";

  const statusLabel: Record<UploadStatus, string> = {
    idle: "",
    hashing: "Computing hash...",
    signing: "Waiting for Nostr signature...",
    uploading: "Uploading...",
    done: "",
    error: "",
  };

  return (
    <div class="space-y-4">
      {/* Drop zone */}
      <label
        class={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
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
          class="sr-only"
          onChange={handleInputChange}
        />
        {file
          ? (
            <div class="space-y-1">
              <p class="font-medium text-white">{file.name}</p>
              <p class="text-sm text-gray-400">
                {formatBytes(file.size)}
                {file.type ? ` · ${file.type}` : ""}
              </p>
              <p class="text-xs text-gray-500 mt-2">Click or drop to replace</p>
            </div>
          )
          : (
            <div class="space-y-2">
              <p class="text-gray-300">Drop a file here or click to select</p>
              <p class="text-xs text-gray-500">
                {requireAuth ? "Nostr extension required to sign uploads" : "No auth required"}
              </p>
            </div>
          )}
      </label>

      {/* Status / error */}
      {isWorking && (
        <p class="text-sm text-blue-400 text-center">{statusLabel[status]}</p>
      )}
      {status === "error" && error && (
        <p class="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Upload button */}
      <button
        class={`w-full py-3 rounded-xl font-semibold transition-colors ${
          file && !isWorking
            ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
            : "bg-gray-800 text-gray-500 cursor-not-allowed"
        }`}
        onClick={upload}
        disabled={!file || isWorking}
      >
        {isWorking ? statusLabel[status] : "Upload"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const root = document.getElementById("upload-root");
if (root) {
  const requireAuth = root.dataset.requireAuth === "true";
  render(<UploadForm requireAuth={requireAuth} />, root);
}
