// ---------------------------------------------------------------------------
// MirrorForm — URL input + mirror queue for BUD-04 PUT /mirror.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "@hono/hono/jsx/dom";
import type { MirrorItem } from "./types.ts";
import { mirrorPut } from "./api.ts";
import { MAX_X_TAGS_PER_EVENT, signBatch } from "./auth.ts";
import { parseBlossomRef } from "./helpers.ts";
import { MirrorRow } from "./MirrorRow.tsx";

type MirrorPhase = "input" | "list";

export function MirrorForm({
  requireAuth,
  onQueueChange,
}: {
  requireAuth: boolean;
  onQueueChange: (hasItems: boolean) => void;
}) {
  const [phase, setPhase] = useState<MirrorPhase>("input");
  const [inputText, setInputText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [items, setItems] = useState<MirrorItem[]>([]);
  const itemsRef = useRef<MirrorItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    onQueueChange(phase === "list" && items.length > 0);
  }, [phase, items.length, onQueueChange]);

  const patchItem = useCallback((id: string, patch: Partial<MirrorItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

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
      setParseError("No valid Blossom URLs or blossom:// URIs found. Each must contain a 64-character hex hash.");
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

  const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), []);

  const copyUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
  }, []);

  const clearDone = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== "done" && it.status !== "error"));
  }, []);

  const runMirror = useCallback(async () => {
    const current = itemsRef.current;
    const pending = current?.filter((it) => it.status === "pending") ?? [];
    if (pending.length === 0) return;

    if (!requireAuth) {
      // No auth — fire all concurrently (server handles its own limit)
      await Promise.all(
        pending.map(async (item) => {
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
        }),
      );
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

      await Promise.all(
        batch.map(async (item) => {
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
        }),
      );
    }
  }, [requireAuth, patchItem]);

  const isWorking = items.some((it) => it.status === "signing" || it.status === "mirroring");
  const hasPending = items.some((it) => it.status === "pending");
  const hasDoneOrError = items.some((it) => it.status === "done" || it.status === "error");
  const allDone = items.length > 0 && items.every((it) => it.status === "done" || it.status === "error");
  const canMirror = hasPending && !isWorking;
  const doneUrls = items.filter((it) => it.status === "done" && it.result).map((it) => it.result!.url);

  const copyAllUrls = useCallback(() => {
    navigator.clipboard.writeText(doneUrls.join("\n")).catch(() => {});
  }, [doneUrls]);

  // ---- Phase: input --------------------------------------------------------
  if (phase === "input") {
    return (
      <div class="p-6 space-y-4">
        <p class="text-sm text-gray-400">
          Paste Blossom URLs or <code class="text-gray-300 bg-gray-800 px-1 rounded">blossom://</code> URIs below, one
          per line (or comma-separated).
        </p>
        <textarea
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm font-mono rounded-lg px-3 py-2 resize-y min-h-32 focus:outline-none focus:border-gray-500 placeholder-gray-600"
          placeholder={`https://cdn.example.com/abc123...def456.jpg\nblossom://abc123...def456\nabc123...def456`}
          value={inputText}
          onInput={(e) => setInputText((e.target as HTMLTextAreaElement).value)}
        />
        {parseError && (
          <p class="text-xs text-red-400 bg-red-950 border border-red-800 rounded-lg px-3 py-2">{parseError}</p>
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
          {requireAuth && <span class="ml-2 text-xs text-gray-500">· auth required</span>}
        </p>
        {!isWorking && (
          <button type="button" class="text-xs text-gray-500 hover:text-gray-300 underline" onClick={handleBack}>
            ← Edit URLs
          </button>
        )}
      </div>

      {hasDoneOrError && !isWorking && (
        <div class="flex justify-end">
          <button type="button" class="text-xs text-gray-500 hover:text-gray-300 underline" onClick={clearDone}>
            Clear finished
          </button>
        </div>
      )}

      <div class="space-y-2">
        {items.map((item) => (
          <MirrorRow key={item.id} item={item} onRemove={removeItem} onCopy={copyUrl} />
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
            ? `Mirror ${items.filter((it) => it.status === "pending").length} blob${
                items.filter((it) => it.status === "pending").length === 1 ? "" : "s"
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
