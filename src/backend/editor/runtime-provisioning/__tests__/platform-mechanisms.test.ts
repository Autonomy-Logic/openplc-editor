/** @jest-environment node */

import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import type { UsersInfoRawFacts } from '../../../../middleware/shared/ports/runtime-port'
import type { RuntimeProvisioningMechanisms } from '../../../../middleware/shared/ports/runtime-provisioning-mechanisms'
import { createDesktopProvisioningMechanisms } from '../platform-mechanisms'
import { temporaryFolder } from './fixtures/local-servers'

const FACTS: UsersInfoRawFacts = {
  kind: 'error',
  code: 'ECONNREFUSED',
  message: 'connect ECONNREFUSED 192.0.2.10:8443',
  timedOut: false,
}
const AUDIT_LINE =
  '[runtime-provisioning-audit] target=192.0.2.10:22 operation=install start=2026-11-05T12:00:00.000Z end=2026-11-05T12:04:00.000Z outcome=unknown'

interface Harness {
  mechanisms: RuntimeProvisioningMechanisms
  hostKeyFilePath: string
  reachabilityHosts: string[]
  logged: string[]
}

const folders: string[] = []

function setup(): Harness {
  const folder = temporaryFolder('provisioning-platform-')
  folders.push(folder)
  const hostKeyFilePath = path.join(folder, 'ssh-known-hosts.json')
  const reachabilityHosts: string[] = []
  const logged: string[] = []
  const mechanisms = createDesktopProvisioningMechanisms({
    hostKeyFilePath,
    runtimeApi: {
      getUsersInfoFacts: (address: string) => {
        reachabilityHosts.push(address)
        return Promise.resolve(FACTS)
      },
    },
    audit: {
      info: (message: string) => {
        logged.push(message)
      },
    },
  })
  return { mechanisms, hostKeyFilePath, reachabilityHosts, logged }
}

function settled(promise: Promise<void>): () => 'pending' | 'resolved' | 'rejected' {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending'
  void promise.then(
    () => {
      state = 'resolved'
    },
    () => {
      state = 'rejected'
    },
  )
  return () => state
}

afterEach(() => {
  jest.useRealTimers()
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})

describe('the desktop provisioning mechanisms', () => {
  it('checks reachability with the runtime client, returning its facts unchanged for the host given', async () => {
    const { mechanisms, reachabilityHosts } = setup()

    await expect(mechanisms.reachability.check('192.0.2.10')).resolves.toBe(FACTS)
    expect(reachabilityHosts).toEqual(['192.0.2.10'])
  })

  it('writes each audit line to the log exactly as given (M13)', () => {
    const { mechanisms, logged } = setup()

    mechanisms.audit.write(AUDIT_LINE)

    expect(logged).toEqual([AUDIT_LINE])
  })

  it('keeps the host keys at the path given', async () => {
    const { mechanisms, hostKeyFilePath } = setup()

    await mechanisms.hostKeyFile.replace('{"version":1,"hosts":[]}\n')

    expect(readFileSync(hostKeyFilePath, 'utf8')).toBe('{"version":1,"hosts":[]}\n')
    await expect(mechanisms.hostKeyFile.read()).resolves.toEqual({ kind: 'text', text: '{"version":1,"hosts":[]}\n' })
  })
})

describe('the desktop clock', () => {
  it('reads the wall clock', () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 5, 12, 0, 0, 0) })
    const { mechanisms } = setup()

    expect(mechanisms.clock.now()).toBe(Date.UTC(2026, 10, 5, 12, 0, 0, 0))
  })

  it('resolves a sleep once its time has passed, not before', async () => {
    jest.useFakeTimers()
    const { mechanisms } = setup()
    const state = settled(mechanisms.clock.sleep(1000))

    await jest.advanceTimersByTimeAsync(999)
    expect(state()).toBe('pending')
    await jest.advanceTimersByTimeAsync(1)
    expect(state()).toBe('resolved')
  })

  it('ends a sleep at once when its signal aborts, leaving no timer behind', async () => {
    jest.useFakeTimers()
    const { mechanisms } = setup()
    const controller = new AbortController()
    const state = settled(mechanisms.clock.sleep(60_000, controller.signal))
    await jest.advanceTimersByTimeAsync(10)

    controller.abort()
    await jest.advanceTimersByTimeAsync(0)

    expect(state()).not.toBe('pending')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('ends a sleep with an already aborted signal without starting a timer', async () => {
    jest.useFakeTimers()
    const { mechanisms } = setup()
    const controller = new AbortController()
    controller.abort()

    const state = settled(mechanisms.clock.sleep(60_000, controller.signal))
    await jest.advanceTimersByTimeAsync(0)

    expect(state()).not.toBe('pending')
    expect(jest.getTimerCount()).toBe(0)
  })
})
