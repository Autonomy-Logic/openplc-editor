import type {
  ArchiveDownloadProgress,
  VppTargetLoadState,
  VppTargetMechanisms,
  VppVerifyResult,
} from '../../../../middleware/shared/ports/vpp-target-mechanisms'

/** The vPLC whose package is loaded, where its archive is and the content hash it runs. */
export interface VppLoaderTarget {
  deviceId: string
  archivePath: string
  contentHash: string
}

export interface VppTargetLoaderOptions {
  /** Abort a download that received no byte for this long. Default 30 s. */
  stallTimeoutMs?: number
  /** Abort a download still running this long after its start. Default 10 min. */
  maxDurationMs?: number
}

export interface VppTargetLoader<TVerified extends { contentHash: string }> {
  /** Same deviceId and contentHash: no-op. Otherwise aborts any running download and resets the state to idle (or keeps ready when the cached package has the new contentHash). */
  setTarget(target: VppLoaderTarget | null): void
  getTarget(): VppLoaderTarget | null
  /** The verified package of the target, downloading it when needed; null when there is no target or the load failed. Concurrent calls share one download. */
  load(): Promise<TVerified | null>
  /** Clears an error (transport, verification or canceled) and loads again. */
  retry(): Promise<TVerified | null>
  /** Aborts the running download; state becomes error with reason 'canceled'. No-op when nothing is downloading. */
  cancel(): void
  getState(): VppTargetLoadState
  onStateChanged(callback: (state: VppTargetLoadState) => void): () => void
}

export const DEFAULT_STALL_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_DURATION_MS = 600_000

/** Why a running download was aborted: a timer, the user, or a change of target. */
type AbortCause = 'stalled' | 'timeout' | 'canceled' | 'superseded'

interface ActiveDownload<TVerified> {
  phase: 'downloading' | 'verifying'
  promise: Promise<TVerified | null>
  stop(cause: AbortCause): void
}

/** True when both name the same vPLC running the same content. */
export function isSameVppLoaderTarget(a: VppLoaderTarget | null, b: VppLoaderTarget | null): boolean {
  return a?.deviceId === b?.deviceId && a?.contentHash === b?.contentHash
}

function sameState(a: VppTargetLoadState, b: VppTargetLoadState): boolean {
  if (a.status === 'downloading' && b.status === 'downloading') return a.loaded === b.loaded && a.total === b.total
  if (a.status === 'error' && b.status === 'error') return a.reason === b.reason && a.message === b.message
  return a.status === b.status
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDuration(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${ms / 1000} s`
}

/**
 * Loads, verifies and caches the package of one targeted vPLC at a time, over platform mechanisms.
 *
 * A download is aborted after `stallTimeoutMs` without bytes or `maxDurationMs` in total. Transport
 * failures and cancels are not cached; a verification failure is, for its content hash, until
 * `retry()` or a change of target. A superseded download never reaches the cache, the state or a caller.
 */
export function createVppTargetLoader<TVerified extends { contentHash: string }>(
  mechanisms: VppTargetMechanisms<TVerified>,
  options: VppTargetLoaderOptions = {},
): VppTargetLoader<TVerified> {
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS

  let target: VppLoaderTarget | null = null
  let cached: TVerified | null = null
  let failedVerificationHash: string | null = null
  let active: ActiveDownload<TVerified> | null = null
  let state: VppTargetLoadState = { status: 'idle' }
  const subscribers = new Set<(state: VppTargetLoadState) => void>()

  function setState(next: VppTargetLoadState): void {
    if (sameState(state, next)) return
    state = next
    for (const callback of subscribers) {
      try {
        callback(next)
      } catch (error) {
        console.error('[vpp-target-loader] state subscriber threw:', error)
      }
    }
  }

  function abortMessage(cause: 'stalled' | 'timeout' | 'canceled'): string {
    switch (cause) {
      case 'stalled':
        return `The package download received no data for ${formatDuration(stallTimeoutMs)}`
      case 'timeout':
        return `The package download did not finish within ${formatDuration(maxDurationMs)}`
      case 'canceled':
        return 'The package download was canceled'
    }
  }

  function startDownload(current: VppLoaderTarget): ActiveDownload<TVerified> {
    const controller = new AbortController()
    let settled = false
    let finish: (result: TVerified | null) => void = () => undefined
    const promise = new Promise<TVerified | null>((resolve) => {
      finish = resolve
    })
    let stallTimer = setTimeout(() => download.stop('stalled'), stallTimeoutMs)
    const capTimer = setTimeout(() => download.stop('timeout'), maxDurationMs)

    function clearTimers(): void {
      clearTimeout(stallTimer)
      clearTimeout(capTimer)
    }

    function end(result: TVerified | null, next: VppTargetLoadState | null): void {
      settled = true
      clearTimers()
      if (active === download) active = null
      if (next) setState(next)
      finish(result)
    }

    function fail(reason: 'stalled' | 'timeout' | 'transfer' | 'verification' | 'canceled', message: string): void {
      if (reason !== 'canceled') {
        console.error(`[vpp-target-loader] could not load the package of vPLC ${current.deviceId}: ${message}`)
      }
      end(null, { status: 'error', reason, message })
    }

    function onProgress(progress: ArchiveDownloadProgress): void {
      if (settled || download.phase !== 'downloading') return
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => download.stop('stalled'), stallTimeoutMs)
      setState({ status: 'downloading', loaded: progress.loaded, total: progress.total })
    }

    const download: ActiveDownload<TVerified> = {
      phase: 'downloading',
      promise,
      stop(cause: AbortCause): void {
        if (settled) return
        if (cause === 'superseded') end(null, null)
        else fail(cause, abortMessage(cause))
        controller.abort()
      },
    }

    async function run(): Promise<void> {
      let bytes: Uint8Array
      try {
        bytes = await mechanisms.fetchArchive(current.archivePath, { signal: controller.signal, onProgress })
      } catch (error) {
        if (!settled) fail('transfer', describeError(error))
        return
      }
      if (settled) return
      clearTimers()
      download.phase = 'verifying'
      setState({ status: 'verifying' })

      let verified: VppVerifyResult<TVerified>
      try {
        verified = await mechanisms.verify(bytes, current.contentHash)
      } catch (error) {
        verified = { ok: false, error: describeError(error) }
      }
      if (settled) return
      if (!verified.ok) {
        failedVerificationHash = current.contentHash
        fail('verification', verified.error)
        return
      }
      cached = verified.package
      end(verified.package, { status: 'ready' })
    }

    setState({ status: 'downloading', loaded: 0, total: null })
    void run()
    return download
  }

  function load(): Promise<TVerified | null> {
    const current = target
    if (!current) return Promise.resolve(null)
    if (cached?.contentHash === current.contentHash) return Promise.resolve(cached)
    if (failedVerificationHash === current.contentHash) return Promise.resolve(null)
    if (active) return active.promise
    active = startDownload(current)
    return active.promise
  }

  return {
    setTarget(next: VppLoaderTarget | null): void {
      if (isSameVppLoaderTarget(target, next)) return
      target = next
      active?.stop('superseded')
      failedVerificationHash = null
      if (cached?.contentHash !== next?.contentHash) cached = null
      setState(next && cached ? { status: 'ready' } : { status: 'idle' })
    },

    getTarget: () => target,

    load,

    retry(): Promise<TVerified | null> {
      failedVerificationHash = null
      return load()
    },

    cancel(): void {
      if (active?.phase === 'downloading') active.stop('canceled')
    },

    getState: () => state,

    onStateChanged(callback: (state: VppTargetLoadState) => void): () => void {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
      }
    },
  }
}
