import type { MirrorItem } from "./types.ts";
import { MIRROR_STATUS_LABEL, STATUS_COLOR } from "./status.ts";

export function MirrorRow({
  item,
  onRemove,
  onCopy,
}: {
  key?: string;
  item: MirrorItem;
  onRemove: (id: string) => void;
  onCopy: (url: string) => void;
}) {
  const hasResultUrl = (item.status === "done" || item.status === "exists") &&
    item.result;

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
            &#x2715;
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
          {hasResultUrl && (
            <>
              <span class="flex-1 text-xs text-gray-500 font-mono truncate min-w-0">
                {item.result!.url}
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
