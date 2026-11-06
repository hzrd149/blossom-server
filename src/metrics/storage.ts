import type { IBlobStorage } from "../storage/interface.ts";
import type { OperationMetrics } from "./operations.ts";

const OPERATIONS = new Set(["has", "read", "readRange", "size", "type", "beginWrite", "commitWrite", "abortWrite", "commitFile", "remove"]);

/** Preserve optional adapter methods and their receiver; measure API calls, not individual S3 requests. */
export function instrumentStorage(storage: IBlobStorage, metrics: OperationMetrics, backend: "local" | "s3"): IBlobStorage {
  return new Proxy(storage, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !OPERATIONS.has(property) || typeof method !== "function") return method;
      return async (...args: unknown[]) => {
        const labels = `backend="${backend}",operation="${property}"`;
        const start = performance.now();
        let outcome = "returned";
        try {
          const result = await Reflect.apply(method, target, args);
          if ((property === "read" || property === "readRange") && result instanceof ReadableStream) {
            return metrics.stream(result, "storage_read", labels);
          }
          if (result === null || result === false) outcome = "empty";
          return result;
        } catch (error) {
          outcome = "error";
          throw error;
        } finally {
          metrics.add(
            "blossom_storage_operations_total",
            `${labels},outcome="${outcome}"`,
            1,
            "Storage API calls; empty results may include adapter-suppressed errors.",
          );
          metrics.duration("blossom_storage_operation_duration_seconds", labels, (performance.now() - start) / 1000);
        }
      };
    },
  });
}
