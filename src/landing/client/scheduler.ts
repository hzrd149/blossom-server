/** FIFO concurrency limiter. Completion immediately hands the slot to the next job. */
export function createLimiter(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Invalid concurrency");
  }
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else active++;
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Only authorization is batched; a multi-hash item must fit in one event. */
export function authorizationBatches<T>(
  items: T[],
  hashesFor: (item: T) => string[],
  maxHashes: number,
): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let hashes = new Set<string>();
  for (const item of items) {
    const itemHashes = hashesFor(item);
    if (new Set(itemHashes).size > maxHashes) {
      throw new Error("Too many hashes in one item");
    }
    const combined = new Set([...hashes, ...itemHashes]);
    if (combined.size > maxHashes) {
      batches.push(batch);
      batch = [];
      hashes = new Set();
    }
    batch.push(item);
    for (const hash of itemHashes) hashes.add(hash);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
