import type { UploadFile } from "./types.ts";
import { FILE_STATUS_LABEL, STATUS_COLOR } from "./status.ts";
import { formatBytes } from "./helpers.ts";

export function FileRow({
  uf,
  onRemove,
  onCopy,
}: {
  key?: string;
  uf: UploadFile;
  onRemove: (id: string) => void;
  onCopy: (url: string) => void;
}) {
  const showProgress = uf.status === "uploading" || uf.status === "done";
  const pct = uf.status === "done" ? 100 : uf.progress;

  return (
    <div class="bg-gray-800 rounded-lg px-4 py-3 space-y-2 min-w-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="flex-1 text-sm text-white truncate font-medium min-w-0" title={uf.file.name}>
          {uf.file.name}
        </span>
        <span class="shrink-0 text-xs text-gray-400 tabular-nums whitespace-nowrap">{formatBytes(uf.file.size)}</span>
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
          <span class={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[uf.status]}`}>
            {FILE_STATUS_LABEL[uf.status]}
            {uf.status === "uploading" && ` ${pct}%`}
          </span>
          {uf.status === "done" && uf.result && (
            <>
              <span class="flex-1 text-xs text-gray-500 font-mono truncate min-w-0">{uf.result.url}</span>
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
            <span class="flex-1 text-xs text-red-400 min-w-0 break-words">{uf.error}</span>
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
