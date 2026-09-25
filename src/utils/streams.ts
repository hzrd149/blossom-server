/**
 * Stream utilities for byte-level manipulation.
 */

/**
 * Sentinel embedded in byteCapGuard errors. Detected by the upload worker
 * to classify the failure so routes can map it to HTTP 413.
 */
export const BYTE_LIMIT_ERROR = "BYTE_LIMIT_EXCEEDED";

/**
 * Returns a TransformStream that passes bytes through while the running
 * total stays within `limit`, and ERRORS the stream as soon as it exceeds
 * it.
 *
 * Unlike byteLimitTransform (which silently truncates — correct for range
 * reads), this guard is for untrusted inbound bodies: the Content-Length
 * header has already been checked, but a client can lie about it, and the
 * write path would otherwise buffer arbitrary amounts to disk. Erroring —
 * rather than truncating — matters: truncation would silently produce a
 * hash of the wrong bytes.
 *
 * Exactly `limit` bytes pass (a body that matches its declared size is
 * legitimate); the limit is only breached by the (limit+1)th byte.
 *
 * @param limit Maximum number of bytes to allow. Must be >= 0.
 */
export function byteCapGuard(
  limit: number,
): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        controller.error(
          new Error(
            `${BYTE_LIMIT_ERROR}: body exceeded the maximum allowed size of ${limit} bytes`,
          ),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Reads `body` to completion and discards it.
 *
 * Cancelling a request body the client is still streaming resets the request
 * stream. Firefox surfaces that to the caller as NS_ERROR_NET_PARTIAL_TRANSFER
 * even when the response is a success, so any path that returns 2xx while the
 * upload is still in flight must drain instead of cancel. Rejection paths
 * should keep cancelling — accepting bytes only to throw them away is worse.
 *
 * Draining costs the inbound bandwidth. Clients that want to avoid the transfer
 * altogether should preflight with HEAD /upload (BUD-06).
 *
 * When maxBytes is provided, returns false if the body exceeds the limit.
 * Other read failures are ignored because a client vanishing mid-drain is not
 * worth failing a response that has already been decided.
 */
export async function drainBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes?: number,
): Promise<boolean> {
  if (!body) return true;

  try {
    const stream = maxBytes === undefined ? body : body.pipeThrough(byteCapGuard(maxBytes));
    await stream.pipeTo(new WritableStream());
    return true;
  } catch (err) {
    return !(err instanceof Error && err.message.includes(BYTE_LIMIT_ERROR));
  }
}

/**
 * Returns a TransformStream that passes bytes through until exactly `limit`
 * bytes have been forwarded, then closes the readable side.
 *
 * Used by storage adapters to implement native range reads:
 *   file.readable.pipeThrough(byteLimitTransform(end - start + 1))
 *
 * @param limit Maximum number of bytes to forward. Must be >= 0.
 */
export function byteLimitTransform(
  limit: number,
): TransformStream<Uint8Array, Uint8Array> {
  let remaining = limit;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (remaining <= 0) {
        controller.terminate();
        return;
      }

      if (chunk.byteLength <= remaining) {
        controller.enqueue(chunk);
        remaining -= chunk.byteLength;
      } else {
        // Partial chunk — enqueue only what we still need
        controller.enqueue(chunk.subarray(0, remaining));
        remaining = 0;
      }

      if (remaining <= 0) {
        controller.terminate();
      }
    },
  });
}
