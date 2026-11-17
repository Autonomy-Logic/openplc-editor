import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import type {
  ArchiveDownloadProgress,
  VppTargetLoadState,
  VppTargetMechanisms,
  VppVerifyResult,
} from '../../../../../middleware/shared/ports/vpp-target-mechanisms'
import { createVppTargetLoader, type VppLoaderTarget, type VppTargetLoaderOptions } from '../vpp-target-loader'

const STALL_MS = 30_000
const MAX_MS = 600_000
const PROGRESS_STEP_MS = 20_000

interface FakePackage {
  contentHash: string
  bytes: Uint8Array
}

interface ArchiveFetch {
  archivePath: string
  signal: AbortSignal
  progress(loaded: number, total?: number | null): void
  succeed(bytes: Uint8Array): void
  fail(error: Error): void
}

/** In-memory archive host: every fetch hangs until the test settles it, and rejects when its signal aborts. */
class InMemoryArchiveHost implements VppTargetMechanisms<FakePackage> {
  readonly fetches: ArchiveFetch[] = []
  verification: 'pass' | 'fail' | 'hold' = 'pass'
  rejectOnAbort = true
  private readonly heldVerifications: Array<() => void> = []

  fetchArchive(
    archivePath: string,
    options: { signal: AbortSignal; onProgress: (progress: ArchiveDownloadProgress) => void },
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.rejectOnAbort) options.signal.addEventListener('abort', () => reject(new Error('canceled')))
      this.fetches.push({
        archivePath,
        signal: options.signal,
        progress: (loaded, total = null) => options.onProgress({ loaded, total }),
        succeed: resolve,
        fail: reject,
      })
    })
  }

  verify(bytes: Uint8Array, expectedContentHash: string): Promise<VppVerifyResult<FakePackage>> {
    if (this.verification === 'fail') return Promise.resolve({ ok: false, error: 'signature does not verify' })
    const verified: VppVerifyResult<FakePackage> = { ok: true, package: { contentHash: expectedContentHash, bytes } }
    if (this.verification === 'pass') return Promise.resolve(verified)
    return new Promise((resolve) => this.heldVerifications.push(() => resolve(verified)))
  }

  releaseVerifications(): void {
    for (const release of this.heldVerifications.splice(0)) release()
  }

  fetchAt(index: number): ArchiveFetch {
    const found = this.fetches[index]
    if (!found) throw new Error(`fetch ${index} was never started`)
    return found
  }
}

const TARGET_A: VppLoaderTarget = {
  deviceId: 'vplc-a',
  archivePath: '/devices/vplc-a/vpp/archive',
  contentHash: 'sha256:aaaa',
}
const TARGET_B: VppLoaderTarget = {
  deviceId: 'vplc-b',
  archivePath: '/devices/vplc-b/vpp/archive',
  contentHash: 'sha256:bbbb',
}
const BYTES_A = Uint8Array.of(0xa)
const BYTES_B = Uint8Array.of(0xb)

/** Lets pending promise callbacks run without advancing fake time. */
async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let round = 0; round < rounds; round++) await Promise.resolve()
}

/** Keeps a download alive with a progress event every 20 s until fake time reaches `untilMs` since its start. */
async function keepSendingBytes(fetch: ArchiveFetch, untilMs: number): Promise<void> {
  for (let elapsed = PROGRESS_STEP_MS; elapsed <= untilMs; elapsed += PROGRESS_STEP_MS) {
    await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS)
    fetch.progress(elapsed, null)
  }
  await flushMicrotasks()
}

function setup(options?: VppTargetLoaderOptions) {
  const host = new InMemoryArchiveHost()
  const loader = createVppTargetLoader(host, options)
  return { host, loader }
}

/** Starts loading `target` and waits until its archive request is in flight. */
async function startLoading(target: VppLoaderTarget = TARGET_A, options?: VppTargetLoaderOptions) {
  const { host, loader } = setup(options)
  loader.setTarget(target)
  const loading = loader.load()
  await flushMicrotasks()
  return { host, loader, loading, fetch: host.fetchAt(0) }
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('createVppTargetLoader with no target', () => {
  it('resolves null, stays idle and fetches nothing', async () => {
    const { host, loader } = setup()

    await expect(loader.load()).resolves.toBeNull()

    expect(loader.getState()).toEqual({ status: 'idle' })
    expect(loader.getTarget()).toBeNull()
    expect(host.fetches).toHaveLength(0)
  })
})

describe('createVppTargetLoader loading the target package', () => {
  it('fetches the archive of the target', async () => {
    const { fetch } = await startLoading()

    expect(fetch.archivePath).toBe(TARGET_A.archivePath)
  })

  it('reports downloading from zero bytes of an unknown total as soon as the load starts', async () => {
    const { loader } = await startLoading()

    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })
  })

  it('reports each progress event of the download', async () => {
    const { loader, fetch } = await startLoading()

    fetch.progress(1024, 4096)
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 1024, total: 4096 })

    fetch.progress(3072, 4096)
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 3072, total: 4096 })
  })

  it('reports verifying once the bytes arrived and until the verifier answers', async () => {
    const { host, loader } = setup()
    host.verification = 'hold'
    loader.setTarget(TARGET_A)
    void loader.load()
    await flushMicrotasks()

    host.fetchAt(0).succeed(BYTES_A)
    await flushMicrotasks()

    expect(loader.getState()).toEqual({ status: 'verifying' })
  })

  it('resolves the verified package and reports ready', async () => {
    const { loader, loading, fetch } = await startLoading()

    fetch.succeed(BYTES_A)

    await expect(loading).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(loader.getState()).toEqual({ status: 'ready' })
  })

  it('shares one download between concurrent loads', async () => {
    const { host, loader, loading, fetch } = await startLoading()

    const second = loader.load()
    fetch.succeed(BYTES_A)

    const [first, other] = await Promise.all([loading, second])
    expect(host.fetches).toHaveLength(1)
    expect(other).toBe(first)
  })

  it('resolves the cached package with no fetch once ready', async () => {
    const { host, loader, loading, fetch } = await startLoading()
    fetch.succeed(BYTES_A)
    const first = await loading

    const again = await loader.load()

    expect(again).toBe(first)
    expect(host.fetches).toHaveLength(1)
    expect(loader.getState()).toEqual({ status: 'ready' })
  })
})

describe('createVppTargetLoader stall timeout', () => {
  it('keeps a download that has not been silent for 30 s since its start', async () => {
    const { loader, fetch } = await startLoading()

    await jest.advanceTimersByTimeAsync(STALL_MS - 1)

    expect(fetch.signal.aborted).toBe(false)
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })
  })

  it('aborts a download that received no byte for 30 s since its start, as stalled', async () => {
    const { loader, loading, fetch } = await startLoading()

    await jest.advanceTimersByTimeAsync(STALL_MS)

    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toEqual({ status: 'error', reason: 'stalled', message: expect.any(String) })
    await expect(loading).resolves.toBeNull()
  })

  it('measures the stall from the last progress event, not from the start', async () => {
    const { loader, fetch } = await startLoading()
    await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS)
    fetch.progress(512, null)

    await jest.advanceTimersByTimeAsync(STALL_MS - 1)
    expect(fetch.signal.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toMatchObject({ status: 'error', reason: 'stalled' })
  })

  it('completes a download slower than 30 s in total that keeps sending bytes', async () => {
    const { loader, loading, fetch } = await startLoading()
    await keepSendingBytes(fetch, 6 * PROGRESS_STEP_MS)

    fetch.succeed(BYTES_A)

    await expect(loading).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(fetch.signal.aborted).toBe(false)
    expect(loader.getState()).toEqual({ status: 'ready' })
  })

  it('honours a custom stall timeout', async () => {
    const { loader, fetch } = await startLoading(TARGET_A, { stallTimeoutMs: 5_000 })

    await jest.advanceTimersByTimeAsync(4_999)
    expect(fetch.signal.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toMatchObject({ status: 'error', reason: 'stalled' })
  })
})

describe('createVppTargetLoader overall cap', () => {
  it('keeps a download that keeps sending bytes until 10 min since its start', async () => {
    const { loader, fetch } = await startLoading()
    await keepSendingBytes(fetch, MAX_MS - PROGRESS_STEP_MS)

    await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS - 1)

    expect(fetch.signal.aborted).toBe(false)
    expect(loader.getState()).toMatchObject({ status: 'downloading' })
  })

  it('aborts a download still running 10 min after its start, as a timeout', async () => {
    const { loader, loading, fetch } = await startLoading()
    await keepSendingBytes(fetch, MAX_MS - PROGRESS_STEP_MS)

    await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS)

    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toEqual({ status: 'error', reason: 'timeout', message: expect.any(String) })
    await expect(loading).resolves.toBeNull()
  })

  it('honours a custom cap', async () => {
    const { loader, fetch } = await startLoading(TARGET_A, { stallTimeoutMs: 5_000, maxDurationMs: 12_000 })
    for (let elapsed = 4_000; elapsed < 12_000; elapsed += 4_000) {
      await jest.advanceTimersByTimeAsync(4_000)
      fetch.progress(elapsed, null)
    }

    await jest.advanceTimersByTimeAsync(3_999)
    expect(fetch.signal.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toMatchObject({ status: 'error', reason: 'timeout' })
  })
})

describe('createVppTargetLoader transfer failure', () => {
  it('reports a rejected download as a transfer error and resolves null', async () => {
    const { loader, loading, fetch } = await startLoading()

    fetch.fail(new Error('Network Error'))

    await expect(loading).resolves.toBeNull()
    expect(loader.getState()).toEqual({ status: 'error', reason: 'transfer', message: expect.any(String) })
  })
})

describe('createVppTargetLoader transport failures are not cached', () => {
  const failures: Array<[string, (fetch: ArchiveFetch) => Promise<void>]> = [
    ['stalled', () => jest.advanceTimersByTimeAsync(STALL_MS)],
    [
      'timeout',
      async (fetch) => {
        await keepSendingBytes(fetch, MAX_MS - PROGRESS_STEP_MS)
        await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS)
      },
    ],
    [
      'transfer',
      async (fetch) => {
        fetch.fail(new Error('Network Error'))
        await flushMicrotasks()
      },
    ],
  ]

  it.each(failures)('downloads again on the next load after a %s error', async (reason, fail) => {
    const { host, loader, loading, fetch } = await startLoading()
    await fail(fetch)
    await loading
    expect(loader.getState()).toMatchObject({ status: 'error', reason })

    const again = loader.load()
    await flushMicrotasks()
    host.fetchAt(1).succeed(BYTES_A)

    await expect(again).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(host.fetches).toHaveLength(2)
    expect(loader.getState()).toEqual({ status: 'ready' })
  })
})

describe('createVppTargetLoader verification failure', () => {
  /** Loads TARGET_A once with a verifier that refuses it. */
  async function failVerification() {
    const { host, loader, loading, fetch } = await startLoading()
    host.verification = 'fail'
    fetch.succeed(BYTES_A)
    const result = await loading
    host.verification = 'pass'
    return { host, loader, result }
  }

  it('reports a verification error and resolves null', async () => {
    const { loader, result } = await failVerification()

    expect(result).toBeNull()
    expect(loader.getState()).toEqual({ status: 'error', reason: 'verification', message: expect.any(String) })
  })

  it('does not download the same content hash again on the next load', async () => {
    const { host, loader } = await failVerification()

    await expect(loader.load()).resolves.toBeNull()

    expect(host.fetches).toHaveLength(1)
    expect(loader.getState()).toMatchObject({ status: 'error', reason: 'verification' })
  })

  it('downloads again after a change of target', async () => {
    const { host, loader } = await failVerification()

    loader.setTarget(TARGET_B)
    const loading = loader.load()
    await flushMicrotasks()
    host.fetchAt(1).succeed(BYTES_B)

    await expect(loading).resolves.toEqual({ contentHash: TARGET_B.contentHash, bytes: BYTES_B })
  })
})

describe('createVppTargetLoader retry', () => {
  it('clears a verification error and downloads again', async () => {
    const { host, loader, loading, fetch } = await startLoading()
    host.verification = 'fail'
    fetch.succeed(BYTES_A)
    await loading
    host.verification = 'pass'

    const retrying = loader.retry()
    await flushMicrotasks()
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })
    host.fetchAt(1).succeed(BYTES_A)

    await expect(retrying).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(loader.getState()).toEqual({ status: 'ready' })
  })

  it('downloads again after a stalled download', async () => {
    const { host, loader, loading } = await startLoading()
    await jest.advanceTimersByTimeAsync(STALL_MS)
    await loading

    const retrying = loader.retry()
    await flushMicrotasks()
    host.fetchAt(1).succeed(BYTES_A)

    await expect(retrying).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(loader.getState()).toEqual({ status: 'ready' })
  })
})

describe('createVppTargetLoader target changes', () => {
  it('aborts the running download when another device becomes the target', async () => {
    const { loader, fetch } = await startLoading()

    loader.setTarget(TARGET_B)
    await flushMicrotasks()

    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toEqual({ status: 'idle' })
    expect(loader.getTarget()).toEqual(TARGET_B)
  })

  it('aborts the running download when the same device names another content hash', async () => {
    const { loader, fetch } = await startLoading()

    loader.setTarget({ ...TARGET_A, contentHash: 'sha256:a2a2' })
    await flushMicrotasks()

    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toEqual({ status: 'idle' })
  })

  it('keeps the running download when the same device and content hash are set again', async () => {
    const { host, loader, loading, fetch } = await startLoading()

    loader.setTarget({ ...TARGET_A })
    fetch.succeed(BYTES_A)

    await expect(loading).resolves.toEqual({ contentHash: TARGET_A.contentHash, bytes: BYTES_A })
    expect(fetch.signal.aborted).toBe(false)
    expect(host.fetches).toHaveLength(1)
  })

  it('stays ready with no fetch for another device that runs the cached content hash', async () => {
    const { host, loader, loading, fetch } = await startLoading()
    fetch.succeed(BYTES_A)
    const first = await loading

    loader.setTarget({
      deviceId: 'vplc-c',
      archivePath: '/devices/vplc-c/vpp/archive',
      contentHash: TARGET_A.contentHash,
    })

    expect(loader.getState()).toEqual({ status: 'ready' })
    await expect(loader.load()).resolves.toBe(first)
    expect(host.fetches).toHaveLength(1)
  })

  it('keeps a superseded download that completes late out of the state and the cache', async () => {
    const { host, loader } = setup()
    host.rejectOnAbort = false
    loader.setTarget(TARGET_A)
    void loader.load()
    await flushMicrotasks()

    loader.setTarget(TARGET_B)
    host.fetchAt(0).succeed(BYTES_A)
    await flushMicrotasks()
    expect(loader.getState()).toEqual({ status: 'idle' })

    const loading = loader.load()
    await flushMicrotasks()
    expect(host.fetches).toHaveLength(2)
    host.fetchAt(1).succeed(BYTES_B)
    await expect(loading).resolves.toEqual({ contentHash: TARGET_B.contentHash, bytes: BYTES_B })
  })

  it('never hands a superseded download to the caller of the new load', async () => {
    const { host, loader } = setup()
    host.rejectOnAbort = false
    loader.setTarget(TARGET_A)
    void loader.load()
    await flushMicrotasks()
    loader.setTarget(TARGET_B)
    const loading = loader.load()
    await flushMicrotasks()

    host.fetchAt(0).succeed(BYTES_A)
    await flushMicrotasks()
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })

    host.fetchAt(1).succeed(BYTES_B)
    await expect(loading).resolves.toEqual({ contentHash: TARGET_B.contentHash, bytes: BYTES_B })
    expect(loader.getState()).toEqual({ status: 'ready' })
  })

  it('keeps the late failure of a superseded download out of the new target state', async () => {
    const { host, loader } = setup()
    host.rejectOnAbort = false
    loader.setTarget(TARGET_A)
    void loader.load()
    await flushMicrotasks()
    loader.setTarget(TARGET_B)
    void loader.load()
    await flushMicrotasks()

    host.fetchAt(0).fail(new Error('Network Error'))
    await flushMicrotasks()

    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })
  })

  it('does not let the timer of a superseded download stall the new one', async () => {
    const { host, loader } = setup()
    loader.setTarget(TARGET_A)
    void loader.load()
    await flushMicrotasks()
    await jest.advanceTimersByTimeAsync(10_000)
    loader.setTarget(TARGET_B)
    void loader.load()
    await flushMicrotasks()

    await jest.advanceTimersByTimeAsync(STALL_MS - 10_000)

    expect(host.fetchAt(1).signal.aborted).toBe(false)
    expect(loader.getState()).toEqual({ status: 'downloading', loaded: 0, total: null })
  })
})

describe('createVppTargetLoader with the target cleared', () => {
  it('goes idle and resolves null after a package was ready', async () => {
    const { host, loader, loading, fetch } = await startLoading()
    fetch.succeed(BYTES_A)
    await loading

    loader.setTarget(null)

    expect(loader.getState()).toEqual({ status: 'idle' })
    expect(loader.getTarget()).toBeNull()
    await expect(loader.load()).resolves.toBeNull()
    expect(host.fetches).toHaveLength(1)
  })

  it('aborts the running download', async () => {
    const { loader, fetch } = await startLoading()

    loader.setTarget(null)
    await flushMicrotasks()

    expect(fetch.signal.aborted).toBe(true)
    expect(loader.getState()).toEqual({ status: 'idle' })
  })
})

describe('createVppTargetLoader timers', () => {
  const settles: Array<[string, (ctx: Awaited<ReturnType<typeof startLoading>>) => Promise<unknown>]> = [
    [
      'a verified download',
      ({ fetch, loading }) => {
        fetch.succeed(BYTES_A)
        return loading
      },
    ],
    ['a stalled download', () => jest.advanceTimersByTimeAsync(STALL_MS)],
    [
      'a download over the cap',
      async ({ fetch }) => {
        await keepSendingBytes(fetch, MAX_MS - PROGRESS_STEP_MS)
        await jest.advanceTimersByTimeAsync(PROGRESS_STEP_MS)
      },
    ],
    [
      'a failed transfer',
      ({ fetch, loading }) => {
        fetch.fail(new Error('Network Error'))
        return loading
      },
    ],
    [
      'a failed verification',
      ({ host, fetch, loading }) => {
        host.verification = 'fail'
        fetch.succeed(BYTES_A)
        return loading
      },
    ],
    [
      'a change of target',
      async ({ loader }) => {
        loader.setTarget(TARGET_B)
        await flushMicrotasks()
      },
    ],
    [
      'clearing the target',
      async ({ loader }) => {
        loader.setTarget(null)
        await flushMicrotasks()
      },
    ],
  ]

  it.each(settles)('leaves no timer behind after %s', async (_label, settle) => {
    const ctx = await startLoading()

    await settle(ctx)
    await flushMicrotasks()

    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('createVppTargetLoader state subscription', () => {
  it('announces every state of a load in order', async () => {
    const { host, loader } = setup()
    loader.setTarget(TARGET_A)
    const states: VppTargetLoadState[] = []
    loader.onStateChanged((state) => states.push(state))
    const loading = loader.load()
    await flushMicrotasks()

    host.fetchAt(0).progress(1024, 4096)
    host.fetchAt(0).succeed(BYTES_A)
    await loading

    expect(states).toEqual([
      { status: 'downloading', loaded: 0, total: null },
      { status: 'downloading', loaded: 1024, total: 4096 },
      { status: 'verifying' },
      { status: 'ready' },
    ])
  })

  it('announces the return to idle when the target is cleared', async () => {
    const { loader, loading, fetch } = await startLoading()
    fetch.succeed(BYTES_A)
    await loading
    const states: VppTargetLoadState[] = []
    loader.onStateChanged((state) => states.push(state))

    loader.setTarget(null)

    expect(states).toEqual([{ status: 'idle' }])
  })

  it('keeps notifying the other subscribers when one throws', async () => {
    const { loader } = setup()
    loader.setTarget(TARGET_A)
    const states: VppTargetLoadState[] = []
    loader.onStateChanged(() => {
      throw new Error('subscriber failed')
    })
    loader.onStateChanged((state) => states.push(state))

    void loader.load()
    await flushMicrotasks()

    expect(states).toEqual([{ status: 'downloading', loaded: 0, total: null }])
  })

  it('stops notifying a subscriber that unsubscribed', async () => {
    const { loader } = setup()
    loader.setTarget(TARGET_A)
    const states: VppTargetLoadState[] = []
    const unsubscribe = loader.onStateChanged((state) => states.push(state))

    unsubscribe()
    void loader.load()
    await flushMicrotasks()

    expect(states).toEqual([])
  })
})
