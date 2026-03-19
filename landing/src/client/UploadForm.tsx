// ---------------------------------------------------------------------------
// UploadForm — file-picker, upload queue, and concurrent upload orchestration.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "hono/jsx/dom";
import type { FileStatus, UploadFile } from "./types.ts";
import { xhrUpload } from "./api.ts";
import { hashBatch, MAX_X_TAGS_PER_EVENT, signBatch } from "./auth.ts";
import { formatBytes, isMediaFile } from "./helpers.ts";
import { FileRow } from "./FileRow.tsx";

export function UploadForm({
  requireAuth,
  mediaEnabled,
  mediaRequireAuth,
  onQueueChange,
}: {
  requireAuth: boolean;
  mediaEnabled: boolean;
  mediaRequireAuth: boolean;
  onQueueChange: (hasItems: boolean) => void;
}) {
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
    setQueue((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      const newItems: UploadFile[] = arr.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "pending" as FileStatus,
        progress: 0,
        optimize: globalOptimize && mediaEnabled && isMediaFile(file),
      }));
      setQueue((prev) => [...prev, ...newItems]);
    },
    [globalOptimize, mediaEnabled],
  );

  // Sync the optimize flag on pending files whenever the toggle changes.
  // Files added before the checkbox was checked would otherwise keep optimize:false
  // and route to /upload instead of /media.
  useEffect(() => {
    setQueue((prev) =>
      prev.map((f) =>
        f.status === "pending"
          ? {
            ...f,
            optimize: globalOptimize && mediaEnabled && isMediaFile(f.file),
          }
          : f
      )
    );
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

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleInputChange = useCallback(
    (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) {
        addFiles(files);
        (e.target as HTMLInputElement).value = "";
      }
    },
    [addFiles],
  );

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
    const pending = currentQueue?.filter((f) => f.status === "pending") ?? [];
    if (pending.length === 0) return;

    const needsAuth = pending.some((
      f,
    ) => (f.optimize ? mediaRequireAuth : requireAuth));

    if (!needsAuth) {
      const semSlots = Math.max(0, concurrency - (activeCount.current ?? 0));
      const toStart = pending.slice(0, semSlots);
      for (const uf of toStart) {
        activeCount.current = (activeCount.current ?? 0) + 1;
        uploadOne(uf, undefined).finally(() => {
          activeCount.current = (activeCount.current ?? 0) - 1;
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
          while ((activeCount.current ?? 0) >= concurrency) {
            await new Promise<void>((res) => setTimeout(res, 50));
          }
          activeCount.current = (activeCount.current ?? 0) + 1;
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
  const doneUrls = queue.filter((f) => f.status === "done" && f.result).map((
    f,
  ) => f.result!.url);

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
