/**
 * Mechanisms behind the targeted vPLC's package loader.
 *
 * The loader's behaviour (timers, state, retry, cancel, caching) is shared
 * (`backend/shared/utils/vpp/vpp-target-loader.ts`). A platform supplies only
 * the archive download and the archive verifier, which make no decisions.
 */

/** Bytes of the archive received so far. */
export interface ArchiveDownloadProgress {
  loaded: number
  /** null when the host sends no Content-Length. */
  total: number | null
}

/** Load state of the targeted vPLC's package. */
export type VppTargetLoadState =
  | { status: 'idle' }
  | { status: 'downloading'; loaded: number; total: number | null }
  | { status: 'verifying' }
  | { status: 'ready' }
  | { status: 'error'; reason: 'stalled' | 'timeout' | 'transfer' | 'verification' | 'canceled'; message: string }

/** Outcome of verifying a downloaded archive. */
export type VppVerifyResult<TVerified> = { ok: true; package: TVerified } | { ok: false; error: string }

export interface VppTargetMechanisms<TVerified extends { contentHash: string }> {
  /** Downloads the archive. Rejects on HTTP or network failure and when `signal` aborts. */
  fetchArchive(
    archivePath: string,
    options: { signal: AbortSignal; onProgress: (progress: ArchiveDownloadProgress) => void },
  ): Promise<Uint8Array>
  /** Verifies the archive in the browser against the content hash the host named. */
  verify(bytes: Uint8Array, expectedContentHash: string): Promise<VppVerifyResult<TVerified>>
}
