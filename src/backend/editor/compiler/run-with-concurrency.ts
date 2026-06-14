/**
 * Bounded-concurrency `Promise.all` over an iterable.
 *
 * Runs `fn(item, index)` over every entry in `items`, with at most
 * `limit` invocations in flight simultaneously. The classic worker-
 * pool pattern: spawn `min(limit, items.length)` async workers that
 * race for the next index from a shared cursor.
 *
 * Used by the precompile pipeline to cap concurrent toolchain spawns
 * (an unbounded `sources.map(async …)` over a 30-TU strucpp program
 * was dispatching 30 parallel g++ processes — well past the host's
 * physical cores, and on Windows each process drags a cmd.exe
 * shim along, which the OS struggles to schedule fairly).
 *
 * Results are returned in input order regardless of completion order.
 * Failure semantics match `Promise.all`: the first rejection from any
 * worker rejects the whole batch (still-pending items never start,
 * already-in-flight items run to completion but their results are
 * discarded).
 *
 * `limit <= 0` is normalised to 1 (defensive against `os.cpus()`
 * returning 0 in restricted environments). Non-integer limits are
 * floored.
 */
export async function runWithConcurrencyLimit<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const cap = Math.max(1, Math.floor(limit))
  const results = new Array<R>(items.length)
  let next = 0

  const workerCount = Math.min(cap, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })

  await Promise.all(workers)
  return results
}
