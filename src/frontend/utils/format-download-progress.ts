const BYTES_PER_MEGABYTE = 1_000_000

const toMegabytes = (bytes: number): string => (bytes / BYTES_PER_MEGABYTE).toFixed(1)

/** Bytes received so far in decimal megabytes: `4.2 of 11.1 MB`, or `4.2 MB downloaded` without a total. */
export const formatDownloadProgress = (loaded: number, total: number | null): string =>
  total === null ? `${toMegabytes(loaded)} MB downloaded` : `${toMegabytes(loaded)} of ${toMegabytes(total)} MB`

/** Floored share of `total` received, clamped to 0..100; null when the total is unknown or not positive. */
export const downloadPercent = (loaded: number, total: number | null): number | null => {
  if (total === null || total <= 0) return null
  return Math.min(100, Math.max(0, Math.floor((loaded * 100) / total)))
}
