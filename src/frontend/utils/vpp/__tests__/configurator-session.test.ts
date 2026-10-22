import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import type { ConfiguratorPort, ConfiguratorSnapshot } from '@root/middleware/shared/ports/configurator-port'
import type { DeviceSetup } from '@root/middleware/shared/vendor-document/protocol'

import {
  type ConfiguratorSessionStatus,
  LOAD_FAILED_MESSAGE,
  SNAPSHOT_ATTEMPTS,
  startConfiguratorSession,
} from '../configurator-session'

const SETTLE_MS = 50

function setupOf(...guids: string[]): DeviceSetup {
  return {
    systembus: { guid: '0001', name: 'System_Bus', typeId: '01000000' },
    devices: guids.map((guid, index) => ({ guid, name: `M${index + 1}`, typeId: 'FAKE-4DI' })),
  }
}

type BootEventsOn = 'setController' | 'show'

/** A port whose guest behaves like Device Editor 3.5.22: `setController` fires 2 `modified`, `setProject` 1. */
function createFakePort(
  options: {
    loadedGuids?: string[]
    loadError?: string
    readyError?: string
    lateEventsMs?: number
    /** What the n-th snapshot returns; by default `archive-<n>` with module `g1`. */
    snapshotResult?: (n: number) => { archive: string; guids: string[] } | Error
    bootEventsOn?: BootEventsOn
  } = {},
) {
  const bootEventsOn = options.bootEventsOn ?? 'setController'
  const calls: string[] = []
  const modified = new Set<() => void>()
  const errors = new Set<(message: string) => void>()
  let snapshots = 0
  let disposed = false
  let snapshotGate: Promise<void> = Promise.resolve()

  const fire = (times: number) => {
    for (let i = 0; i < times; i++) modified.forEach((listener) => listener())
  }
  const fireOwn = (times: number) => {
    if (options.lateEventsMs === undefined) fire(times)
    else setTimeout(() => fire(times), options.lateEventsMs)
  }

  const port: ConfiguratorPort = {
    ready: () => {
      calls.push('ready')
      return options.readyError ? Promise.reject(new Error(options.readyError)) : Promise.resolve()
    },
    setController: (id) => {
      calls.push(`setController:${id}`)
      if (bootEventsOn === 'setController') fireOwn(2)
      return Promise.resolve()
    },
    show: () => {
      calls.push('show')
      if (bootEventsOn === 'show') fireOwn(2)
      return Promise.resolve()
    },
    load: (archive) => {
      calls.push(`load:${archive}`)
      if (options.loadError) return Promise.reject(new Error(options.loadError))
      fireOwn(1)
      return Promise.resolve()
    },
    getDeviceSetup: () => {
      calls.push('getDeviceSetup')
      return Promise.resolve(setupOf(...(options.loadedGuids ?? [])))
    },
    snapshot: async (): Promise<ConfiguratorSnapshot> => {
      calls.push('snapshot')
      snapshots += 1
      const n = snapshots
      await snapshotGate
      const result = options.snapshotResult?.(n) ?? { archive: `archive-${n}`, guids: ['g1'] }
      if (result instanceof Error) throw result
      return { archive: result.archive, deviceSetup: setupOf(...result.guids) }
    },
    onModified: (callback) => {
      modified.add(callback)
      return () => modified.delete(callback)
    },
    onError: (callback) => {
      errors.add(callback)
      return () => errors.delete(callback)
    },
    dispose: () => {
      disposed = true
    },
  }

  return {
    port,
    calls,
    userChange: () => fire(1),
    guestError: (message: string) => errors.forEach((listener) => listener(message)),
    holdSnapshots: () => {
      let release: () => void = () => undefined
      snapshotGate = new Promise<void>((resolve) => {
        release = () => resolve()
      })
      return () => release()
    },
    isDisposed: () => disposed,
    listenerCount: () => modified.size + errors.size,
  }
}

function start(fake: ReturnType<typeof createFakePort>, stored: { archive: string | null; guids: string[] }) {
  const statuses: ConfiguratorSessionStatus[] = []
  const snapshots: ConfiguratorSnapshot[] = []
  const errors: string[] = []
  const signals: string[] = []
  const session = startConfiguratorSession({
    port: fake.port,
    controller: 'UC20-M3000',
    storedArchive: stored.archive,
    storedModuleGuids: stored.guids,
    settleMs: SETTLE_MS,
    onStatus: (status) => statuses.push(status),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onError: (message) => errors.push(message),
    onPending: () => signals.push('pending'),
    onUnchanged: () => signals.push('unchanged'),
  })
  return { session, statuses, snapshots, errors, signals, last: () => statuses[statuses.length - 1] }
}

describe('startConfiguratorSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('boots in order and restores the stored archive', async () => {
    const fake = createFakePort({ loadedGuids: ['g1', 'g2'] })
    const run = start(fake, { archive: 'stored', guids: ['g1', 'g2'] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(fake.calls).toEqual(['ready', 'setController:UC20-M3000', 'show', 'load:stored', 'getDeviceSetup'])
    expect(run.statuses).toEqual([{ kind: 'booting' }, { kind: 'ready' }])
  })

  it('reports ready only once the guest has been quiet after boot, when edits start to count', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1)
    expect(run.last()).toEqual({ kind: 'booting' })

    await vi.advanceTimersByTimeAsync(1)
    expect(run.last()).toEqual({ kind: 'ready' })
    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(run.snapshots).toHaveLength(1)
  })

  it('never loads when nothing is stored', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    expect(fake.calls.some((call) => call.startsWith('load'))).toBe(false)
    expect(run.last()).toEqual({ kind: 'ready' })
  })

  it.each<BootEventsOn>(['setController', 'show'])(
    'does not treat its own boot events as user changes when they fire on %s',
    async (bootEventsOn) => {
      const fake = createFakePort({ loadedGuids: ['g1'], bootEventsOn })
      const run = start(fake, { archive: 'stored', guids: ['g1'] })
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 4)

      expect(fake.calls).not.toContain('snapshot')
      expect(run.snapshots).toHaveLength(0)
    },
  )

  it.each<BootEventsOn>(['setController', 'show'])(
    'snapshots the first user change when boot events fire on %s',
    async (bootEventsOn) => {
      const fake = createFakePort({ bootEventsOn })
      const run = start(fake, { archive: null, guids: [] })
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

      fake.userChange()
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(run.snapshots).toHaveLength(1)
    },
  )

  it('ignores its own events even when they arrive after boot', async () => {
    const fake = createFakePort({ loadedGuids: ['g1'], lateEventsMs: SETTLE_MS / 5 })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 4)
    expect(run.last()).toEqual({ kind: 'ready' })
    expect(run.snapshots).toHaveLength(0)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(run.snapshots).toHaveLength(1)
  })

  it('reports a user change as pending at once, and only once until a snapshot delivers it', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    fake.userChange()
    expect(run.signals).toEqual(['pending'])
    expect(run.snapshots).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    fake.userChange()
    expect(run.snapshots).toHaveLength(1)
    expect(run.signals).toEqual(['pending', 'pending'])
  })

  it('does not deliver a snapshot equal to the stored archive', async () => {
    const fake = createFakePort({ loadedGuids: ['g1'], snapshotResult: () => ({ archive: 'stored', guids: ['g1'] }) })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run.snapshots).toHaveLength(0)
    expect(run.signals).toEqual(['pending', 'unchanged'])
  })

  it('does not deliver an empty station when nothing was stored', async () => {
    const fake = createFakePort({ snapshotResult: () => ({ archive: 'empty', guids: [] }) })
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run.snapshots).toHaveLength(0)
    expect(run.signals).toEqual(['pending', 'unchanged'])
  })

  it('delivers a change back to an earlier state once a different one was delivered', async () => {
    const results = [
      { archive: 'one-module', guids: ['g1'] },
      { archive: 'empty', guids: [] },
    ]
    const fake = createFakePort({ snapshotResult: (n) => results[n - 1] })
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run.snapshots.map((s) => s.archive)).toEqual(['one-module', 'empty'])
  })

  it('retries at once, without reporting, when a change arrived during a failed snapshot', async () => {
    const fake = createFakePort({
      snapshotResult: (n) => (n === 1 ? new Error('relay timeout') : { archive: 'a', guids: ['g1'] }),
    })
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    const release = fake.holdSnapshots()
    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    fake.userChange()
    release()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    expect(run.errors).toEqual([])
    expect(run.snapshots.map((s) => s.archive)).toEqual(['a'])
  })

  it('retries a failed snapshot while its change is pending, without another change', async () => {
    const fake = createFakePort({
      snapshotResult: (n) => (n < SNAPSHOT_ATTEMPTS ? new Error('relay timeout') : { archive: 'a', guids: ['g1'] }),
    })
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2 ** SNAPSHOT_ATTEMPTS * 2)

    expect(fake.calls.filter((call) => call === 'snapshot')).toHaveLength(SNAPSHOT_ATTEMPTS)
    expect(run.errors).toEqual([])
    expect(run.snapshots.map((s) => s.archive)).toEqual(['a'])
  })

  it('reports the error once the attempts run out, and starts over on the next change', async () => {
    const fake = createFakePort({
      snapshotResult: (n) => (n <= SNAPSHOT_ATTEMPTS ? new Error('relay timeout') : { archive: 'b', guids: ['g1'] }),
    })
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2 ** SNAPSHOT_ATTEMPTS * 4)
    expect(fake.calls.filter((call) => call === 'snapshot')).toHaveLength(SNAPSHOT_ATTEMPTS)
    expect(run.errors).toEqual(['relay timeout'])
    expect(run.snapshots).toHaveLength(0)
    expect(run.signals).toEqual(['pending'])

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)
    expect(run.snapshots.map((s) => s.archive)).toEqual(['b'])
  })

  it('snapshots once after a burst of user changes settles', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    fake.userChange()
    fake.userChange()
    expect(run.snapshots).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expect(run.snapshots.map((s) => s.archive)).toEqual(['archive-1'])
  })

  it('discards a snapshot overtaken by a newer change and takes the settled one', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    const release = fake.holdSnapshots()
    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    fake.userChange()
    release()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    expect(run.snapshots.map((s) => s.archive)).toEqual(['archive-2'])
  })

  it('fails the load when the bundle accepted the archive but loaded other modules', async () => {
    const fake = createFakePort({ loadedGuids: [] })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(0)

    expect(run.last()).toEqual({ kind: 'failed', message: LOAD_FAILED_MESSAGE })
  })

  it('fails the load when the bundle rejects the archive', async () => {
    const fake = createFakePort({ loadError: 'invalid archive' })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(0)

    expect(run.last()).toEqual({ kind: 'failed', message: `${LOAD_FAILED_MESSAGE} invalid archive` })
  })

  it('writes nothing after a failed load, so the stored archive is kept', async () => {
    const fake = createFakePort({ loadedGuids: ['other'] })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(0)

    fake.userChange()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    expect(run.snapshots).toHaveLength(0)
  })

  it('fails when the relay never becomes ready, without driving the guest', async () => {
    const fake = createFakePort({ readyError: 'relay version mismatch' })
    const run = start(fake, { archive: 'stored', guids: ['g1'] })
    await vi.advanceTimersByTimeAsync(0)

    expect(fake.calls).toEqual(['ready'])
    expect(run.last()).toEqual({ kind: 'failed', message: 'relay version mismatch' })
  })

  it('reports guest errors without ending the session', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.guestError('icon missing')

    expect(run.errors).toEqual(['icon missing'])
    expect(run.last()).toEqual({ kind: 'ready' })
  })

  it('stops listening and disposes the port, dropping a pending snapshot', async () => {
    const fake = createFakePort()
    const run = start(fake, { archive: null, guids: [] })
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    fake.userChange()
    run.session.dispose()
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)

    expect(fake.isDisposed()).toBe(true)
    expect(fake.listenerCount()).toBe(0)
    expect(run.snapshots).toHaveLength(0)
  })
})
