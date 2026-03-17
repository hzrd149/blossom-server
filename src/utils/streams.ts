/**
 * Stream utilities for byte-level manipulation.
 */

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
