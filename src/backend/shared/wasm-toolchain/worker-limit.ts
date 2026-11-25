/**
 * How many clang workers may run at once while the toolchain is held, from the memory the platform reports as
 * available. Each worker keeps its own copy of the toolchain, so a platform that cannot tell its free memory runs one.
 */

/** Most clang workers that run at once. */
export const CLANG_MAX_WORKERS = 4

/** Memory one loaded clang worker takes, measured as the resident size of a process running it (613 MB). */
export const CLANG_WORKER_BYTES = 640 * 1024 * 1024

/** Memory left free for the rest of the editor and the system before a further worker starts. */
export const CLANG_MEMORY_RESERVE_BYTES = 1024 * 1024 * 1024

/**
 * Workers allowed with `availableBytes` free and `cores` processors: one when the memory is unknown, otherwise one
 * more per CLANG_WORKER_BYTES beyond the reserve, at most one less than the processors and CLANG_MAX_WORKERS.
 */
export function clangWorkerLimit(availableBytes: number | undefined, cores: number | undefined): number {
  if (availableBytes === undefined || !Number.isFinite(availableBytes)) return 1
  const byMemory = 1 + Math.floor((availableBytes - CLANG_MEMORY_RESERVE_BYTES) / CLANG_WORKER_BYTES)
  const byCores = cores !== undefined && cores > 1 ? cores - 1 : 1
  return Math.max(1, Math.min(CLANG_MAX_WORKERS, byCores, byMemory))
}

/**
 * Memory macOS can hand out at once, from `vm_stat`: free, inactive, purgeable and speculative pages, which the kernel
 * reclaims on demand; undefined when the output has no page size or no free count.
 */
export function darwinAvailableBytes(vmStat: string): number | undefined {
  const pageSize = /page size of (\d+) bytes/.exec(vmStat)
  const pages = (name: string): number | undefined => {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\.?$`, 'm').exec(vmStat)
    return match ? Number(match[1]) : undefined
  }
  const free = pages('Pages free')
  if (!pageSize || free === undefined) return undefined
  const reclaimable = ['Pages inactive', 'Pages purgeable', 'Pages speculative']
    .map((name) => pages(name) ?? 0)
    .reduce((a, b) => a + b, 0)
  return (free + reclaimable) * Number(pageSize[1])
}

/** `MemAvailable` of Linux's `/proc/meminfo`, in bytes; undefined when it is missing. */
export function linuxAvailableBytes(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)
  return match ? Number(match[1]) * 1024 : undefined
}

/**
 * Memory a page may count on from `navigator.deviceMemory` (GiB, coarse, Chromium only): a quarter of it, since the
 * browser and other tabs share the device; undefined where the browser does not report it (Safari, iOS).
 */
export function webAvailableBytes(deviceMemoryGiB: number | undefined): number | undefined {
  if (deviceMemoryGiB === undefined || !Number.isFinite(deviceMemoryGiB) || deviceMemoryGiB <= 0) return undefined
  return (deviceMemoryGiB * 1024 * 1024 * 1024) / 4
}
