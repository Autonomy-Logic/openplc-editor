/**
 * Format helpers for the shared StatsTable cells.
 *
 * Lifted out of the per-section components so scan-cycle, EtherCAT, and
 * plugin-stats render `null` / `undefined` / numbers identically. A `null`
 * (or `undefined`) value renders as `—` rather than '0' so the user can
 * distinguish "not yet observed" from "observed and equal to zero".
 */

export const formatNumber = (value: number | null | undefined) => (value != null ? value.toLocaleString() : '—')

export const formatRange = (min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null ? `${min} / ${max}` : '—'
