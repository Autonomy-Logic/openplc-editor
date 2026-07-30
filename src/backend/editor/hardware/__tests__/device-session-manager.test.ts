/**
 * The single held connection: candidate fallback, one owner for every command,
 * and what happens when the endpoint goes away.
 *
 * `tick()` is driven directly rather than through the poll timer, so the
 * sequences here are the real ones a cable pull produces, without the waiting.
 */
import {
  DeviceSessionManager,
  type DeviceLinkCandidate,
  type DeviceLinkHooks,
  type DeviceLinkStatus,
} from '../device-session-manager'
import type { DeviceModbusTransport } from '../../../shared/debug/types'

/** A client that records open/close and can be made to answer or not. */
class FakeClient {
  connected = false
  disconnectCount = 0
  connectCount = 0
  constructor(
    private readonly behaviour: {
      connectFails?: boolean
      answers?: boolean
    } = {},
  ) {}

  connect = async (): Promise<void> => {
    this.connectCount += 1
    if (this.behaviour.connectFails) throw new Error('cannot open')
    this.connected = true
  }

  disconnect = (): void => {
    this.disconnectCount += 1
    this.connected = false
  }

  answers(): boolean {
    return this.behaviour.answers !== false
  }
}

const asTransport = (client: FakeClient): DeviceModbusTransport => client as unknown as DeviceModbusTransport

interface Harness {
  manager: DeviceSessionManager
  statuses: DeviceLinkStatus[]
  /** Serial ports the OS currently reports. Mutate to pull or replug a cable. */
  ports: Set<string>
  clients: FakeClient[]
  /** Overridable per test. */
  verifyResult: { value: boolean }
}

function harness(overrides: Partial<DeviceLinkHooks> = {}): Harness {
  const statuses: DeviceLinkStatus[] = []
  const ports = new Set<string>(['/dev/ttyUSB0'])
  const clients: FakeClient[] = []
  const verifyResult = { value: true }

  const hooks: DeviceLinkHooks = {
    verify: async () => verifyResult.value,
    probe: async (client) => (client as unknown as FakeClient).answers(),
    serialPortPresent: async (port) => ports.has(port),
    emit: (status) => statuses.push(status),
    ...overrides,
  }

  const manager = new DeviceSessionManager(hooks, {
    pollIntervalMs: 10_000,
    failuresBeforeRecovery: 2,
    maxRecoveryAttempts: 2,
  })
  return { manager, statuses, ports, clients, verifyResult }
}

/** Candidate factory that hands out the clients a test prepared, in order. */
function candidate(
  transport: 'rtu' | 'tcp',
  descriptor: string,
  queue: FakeClient[],
  registry: FakeClient[],
): DeviceLinkCandidate {
  return {
    transport,
    descriptor,
    create: () => {
      const client = queue.shift() ?? new FakeClient()
      registry.push(client)
      return asTransport(client)
    },
  }
}

afterEach(() => {
  jest.useRealTimers()
})

describe('DeviceSessionManager', () => {
  describe('opening', () => {
    it('takes the first candidate that works', async () => {
      const h = harness()
      const tcp = new FakeClient()
      const serial = new FakeClient()
      const result = await h.manager.open([
        candidate('tcp', '192.168.0.50', [tcp], h.clients),
        candidate('rtu', '/dev/ttyUSB0', [serial], h.clients),
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.transport).toBe('tcp')
      // The serial fallback must not have been touched at all.
      expect(serial.connectCount).toBe(0)
      expect(h.manager.getLink()).toEqual({ transport: 'tcp', descriptor: '192.168.0.50' })
      h.manager.close()
    })

    it('falls back to serial when Modbus TCP cannot connect', async () => {
      const h = harness()
      const tcp = new FakeClient({ connectFails: true })
      const serial = new FakeClient()

      const result = await h.manager.open([
        candidate('tcp', '192.168.0.50', [tcp], h.clients),
        candidate('rtu', '/dev/ttyUSB0', [serial], h.clients),
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.transport).toBe('rtu')
      h.manager.close()
    })

    it('falls back when Modbus TCP opens but nothing answers', async () => {
      // A socket that connects proves a host, not a PLC. This is the case that
      // makes "prefer TCP" safe: an IP that belongs to something else, or a stale
      // DHCP address, must not strand the user on a dead link.
      const h = harness({ verify: async (client) => (client as unknown as FakeClient).answers() })
      const tcp = new FakeClient({ answers: false })
      const serial = new FakeClient()

      const result = await h.manager.open([
        candidate('tcp', '192.168.0.50', [tcp], h.clients),
        candidate('rtu', '/dev/ttyUSB0', [serial], h.clients),
      ])

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.transport).toBe('rtu')
      // The rejected candidate is closed, not leaked.
      expect(tcp.disconnectCount).toBeGreaterThan(0)
      h.manager.close()
    })

    it('tells verify whether alternatives remain, so patience is spent last', async () => {
      // Measured on a real board: ruling out one Modbus TCP address took 32.5s,
      // because the id read is retried for a device that might still be booting.
      // That patience belongs to the LAST candidate — with alternatives waiting, a
      // stale address must not delay the cable that would have worked.
      const seen: Array<{ descriptor: string; isLastCandidate: boolean }> = []
      const h = harness({
        verify: async (_client, candidate, context) => {
          seen.push({ descriptor: candidate.descriptor, isLastCandidate: context.isLastCandidate })
          return candidate.transport === 'rtu'
        },
      })

      await h.manager.open([
        candidate('tcp', '192.168.0.50', [new FakeClient()], h.clients),
        candidate('rtu', '/dev/ttyUSB0', [new FakeClient()], h.clients),
      ])

      expect(seen).toEqual([
        { descriptor: '192.168.0.50', isLastCandidate: false },
        { descriptor: '/dev/ttyUSB0', isLastCandidate: true },
      ])
      h.manager.close()
    })

    it('treats a sole candidate as the last one', async () => {
      const seen: boolean[] = []
      const h = harness({
        verify: async (_client, _candidate, context) => {
          seen.push(context.isLastCandidate)
          return true
        },
      })

      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [new FakeClient()], h.clients)])

      expect(seen).toEqual([true])
      h.manager.close()
    })

    it('fails when no candidate works, reporting each attempt', async () => {
      const h = harness()
      const result = await h.manager.open([
        candidate('tcp', '192.168.0.50', [new FakeClient({ connectFails: true })], h.clients),
        candidate('rtu', '/dev/ttyUSB0', [new FakeClient({ connectFails: true })], h.clients),
      ])

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.attempts).toHaveLength(2)
        expect(result.attempts[0]).toMatchObject({ transport: 'tcp', descriptor: '192.168.0.50' })
        expect(result.attempts[1]).toMatchObject({ transport: 'rtu', descriptor: '/dev/ttyUSB0' })
      }
      // Nothing is held, and the renderer is told — claiming "connected" without
      // a connection is what made later requests time out mysteriously.
      expect(h.manager.isConnected()).toBe(false)
      expect(h.statuses.at(-1)).toEqual({ status: 'disconnected' })
    })

    it('skips a serial candidate whose port is not enumerated', async () => {
      const h = harness()
      h.ports.clear()
      const serial = new FakeClient()

      const result = await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [serial], h.clients)])

      expect(result.ok).toBe(false)
      // Not even opened: no connect timeout was waited out.
      expect(serial.connectCount).toBe(0)
      if (!result.ok) expect(result.attempts[0].error).toContain('not available')
    })

    it('supersedes a previously held link', async () => {
      const h = harness()
      const first = new FakeClient()
      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [first], h.clients)])

      const second = new FakeClient()
      await h.manager.open([candidate('tcp', '192.168.0.50', [second], h.clients)])

      expect(first.disconnectCount).toBe(1)
      expect(h.manager.getLink()).toEqual({ transport: 'tcp', descriptor: '192.168.0.50' })
      h.manager.close()
    })
  })

  describe('one owner for every command', () => {
    it('hands the same client to every caller', async () => {
      // The whole point: the debugger, run/stop and the poll must share this, not
      // open their own. A second socket to an Arduino Modbus TCP server is never
      // answered, which is how a stop command died with a bare timeout.
      const h = harness()
      const tcp = new FakeClient()
      await h.manager.open([candidate('tcp', '192.168.0.50', [tcp], h.clients)])

      expect(h.manager.getClient()).toBe(asTransport(tcp))
      expect(h.manager.getClient()).toBe(h.manager.getClient())
      expect(tcp.connectCount).toBe(1)
      h.manager.close()
    })

    it('reports no client while recovering, instead of a dead one', async () => {
      const h = harness()
      const live = new FakeClient({ answers: false })
      await h.manager.open([candidate('tcp', '192.168.0.50', [live], h.clients)])

      await h.manager.tick()
      await h.manager.tick()

      expect(h.manager.isRecovering()).toBe(true)
      expect(h.manager.getClient()).toBeNull()
      h.manager.close()
    })
  })

  describe('a pulled serial cable', () => {
    it('fails immediately on the first tick, without retrying', async () => {
      const h = harness()
      const serial = new FakeClient()
      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [serial], h.clients)])
      h.statuses.length = 0

      h.ports.clear() // cable pulled
      await h.manager.tick()

      expect(h.manager.isConnected()).toBe(false)
      expect(h.manager.isRecovering()).toBe(false)
      expect(h.statuses).toEqual([
        { status: 'error', transport: 'rtu', descriptor: '/dev/ttyUSB0', reason: 'lost' },
      ])
    })
  })

  describe('a device that stops answering', () => {
    it('recovers on its own when it comes back', async () => {
      const h = harness()
      const dying = new FakeClient({ answers: false })
      const revived = new FakeClient()
      const cand = {
        transport: 'tcp' as const,
        descriptor: '192.168.0.50',
        create: jest
          .fn()
          .mockImplementationOnce(() => asTransport(dying))
          .mockImplementation(() => asTransport(revived)),
      }

      await h.manager.open([cand])
      h.statuses.length = 0

      await h.manager.tick() // one silent poll: tolerated
      expect(h.manager.isRecovering()).toBe(false)
      await h.manager.tick() // second: enter recovery
      expect(h.statuses).toEqual([{ status: 'connecting', transport: 'tcp', descriptor: '192.168.0.50' }])
      expect(dying.disconnectCount).toBe(1)

      await h.manager.tick() // reopen attempt succeeds
      expect(h.manager.isRecovering()).toBe(false)
      expect(h.manager.getClient()).toBe(asTransport(revived))
      expect(h.statuses.at(-1)).toEqual({ status: 'connected', transport: 'tcp', descriptor: '192.168.0.50' })
      h.manager.close()
    })

    it('gives up after the retry budget and reports the link lost', async () => {
      const h = harness()
      const cand = {
        transport: 'tcp' as const,
        descriptor: '192.168.0.50',
        create: () => asTransport(new FakeClient({ answers: false })),
      }
      await h.manager.open([cand])
      h.statuses.length = 0

      await h.manager.tick()
      await h.manager.tick() // enter recovery
      await h.manager.tick() // attempt 1
      expect(h.manager.isRecovering()).toBe(true)
      await h.manager.tick() // attempt 2 -> give up

      expect(h.manager.isConnected()).toBe(false)
      expect(h.statuses.at(-1)).toEqual({
        status: 'error',
        transport: 'tcp',
        descriptor: '192.168.0.50',
        reason: 'lost',
      })
    })

    it('can come back on the OTHER transport', async () => {
      // Seamless across transports: the link was opened from a candidate list, so
      // recovery tries the whole list. An ethernet link that drops while the USB
      // cable is plugged in comes back over serial.
      const h = harness()
      const tcp = new FakeClient({ answers: false })
      const serial = new FakeClient()
      const candidates = [
        { transport: 'tcp' as const, descriptor: '192.168.0.50', create: () => asTransport(tcp) },
        candidate('rtu', '/dev/ttyUSB0', [serial], h.clients),
      ]

      await h.manager.open(candidates)
      await h.manager.tick()
      await h.manager.tick() // enter recovery
      await h.manager.tick() // reopen: tcp still silent, serial answers

      expect(h.manager.getLink()).toEqual({ transport: 'rtu', descriptor: '/dev/ttyUSB0' })
      h.manager.close()
    })

    it('treats a throwing probe as unresponsive rather than crashing the tick', async () => {
      const h = harness({
        probe: async () => {
          throw new Error('read timeout')
        },
      })
      await h.manager.open([candidate('tcp', '192.168.0.50', [new FakeClient()], h.clients)])

      await expect(h.manager.tick()).resolves.toBeUndefined()
      await h.manager.tick()
      expect(h.manager.isRecovering()).toBe(true)
      h.manager.close()
    })
  })

  describe('the debug channel', () => {
    it('IS the control channel when one medium serves both', async () => {
      // A baremetal board answers control and debug over one connection. Opening a
      // second client to it is what an Arduino Modbus TCP server never answers, and
      // what the OS refuses on a serial port.
      const h = harness()
      const only = new FakeClient()
      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [only], h.clients)])

      expect(h.manager.isDebugShared()).toBe(true)
      const acquired = await h.manager.acquireDebugChannel('debug session')
      expect('client' in acquired && acquired.client).toBe(asTransport(only))
      expect(only.connectCount).toBe(1)
      h.manager.close()
    })

    it('releasing a shared channel never closes the connection', async () => {
      // Stopping the debugger must not take the connection run/stop and the status
      // poll are using.
      const h = harness()
      const only = new FakeClient()
      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [only], h.clients)])
      await h.manager.acquireDebugChannel('debug session')

      h.manager.releaseDebugChannel('debug session')

      expect(only.disconnectCount).toBe(0)
      expect(h.manager.isConnected()).toBe(true)
      expect(h.manager.getDebugClient()).toBe(asTransport(only))
      h.manager.close()
    })

    it('opens a channel of its own when the debug medium differs', async () => {
      // A Runtime v3/v4 shape: control is elsewhere, debug is its own channel, and
      // it stays shut until something asks for it.
      const h = harness()
      const control = new FakeClient()
      const debug = new FakeClient()
      await h.manager.open([candidate('tcp', '10.0.0.5', [control], h.clients)], {
        debugChannel: candidate('tcp', '10.0.0.5:502', [debug], h.clients),
      })

      expect(h.manager.isDebugShared()).toBe(false)
      expect(h.manager.getDebugClient()).toBeNull()
      expect(debug.connectCount).toBe(0)

      const acquired = await h.manager.acquireDebugChannel('debug session')
      expect('client' in acquired).toBe(true)
      expect(debug.connectCount).toBe(1)
      h.manager.close()
    })

    it('closes its own channel only when the last holder lets go', async () => {
      const h = harness()
      const debug = new FakeClient()
      await h.manager.open([candidate('tcp', '10.0.0.5', [new FakeClient()], h.clients)], {
        debugChannel: candidate('tcp', '10.0.0.5:502', [debug], h.clients),
      })

      await h.manager.acquireDebugChannel('debug session')
      await h.manager.acquireDebugChannel('license check')
      expect(debug.connectCount).toBe(1) // reused, not reopened

      // A license check finishing must not close the channel a live debug session
      // is still reading through.
      h.manager.releaseDebugChannel('license check')
      expect(debug.disconnectCount).toBe(0)
      expect(h.manager.getDebugClient()).not.toBeNull()

      h.manager.releaseDebugChannel('debug session')
      expect(debug.disconnectCount).toBe(1)
      expect(h.manager.getDebugClient()).toBeNull()
      h.manager.close()
    })

    it('leaves control connected when its own channel will not open', async () => {
      // Independent channels: port 502 firewalled is a debugging problem, not a
      // reason to drop a working control connection.
      const h = harness()
      await h.manager.open([candidate('tcp', '10.0.0.5', [new FakeClient()], h.clients)], {
        debugChannel: candidate('tcp', '10.0.0.5:502', [new FakeClient({ connectFails: true })], h.clients),
      })

      const acquired = await h.manager.acquireDebugChannel('debug session')

      expect('error' in acquired).toBe(true)
      expect(h.manager.isConnected()).toBe(true)
      expect(h.manager.getClient()).not.toBeNull()
      h.manager.close()
    })

    it('closes its own channel when the session ends', async () => {
      const h = harness()
      const debug = new FakeClient()
      await h.manager.open([candidate('tcp', '10.0.0.5', [new FakeClient()], h.clients)], {
        debugChannel: candidate('tcp', '10.0.0.5:502', [debug], h.clients),
      })
      await h.manager.acquireDebugChannel('debug session')

      h.manager.close()

      expect(debug.disconnectCount).toBe(1)
      expect(h.manager.getDebugClient()).toBeNull()
    })

    it('refuses to acquire when nothing is connected', async () => {
      const h = harness()
      expect(await h.manager.acquireDebugChannel('debug session')).toEqual({ error: 'Not connected' })
    })
  })

  describe('upload handoff', () => {
    it('releases a serial link that holds the port being flashed', async () => {
      const h = harness()
      const serial = new FakeClient()
      await h.manager.open([candidate('rtu', '/dev/ttyUSB0', [serial], h.clients)])

      expect(h.manager.releaseSerialPort('/dev/ttyUSB0')).toBe(true)
      expect(h.manager.isConnected()).toBe(false)
      expect(serial.disconnectCount).toBe(1)
    })

    it('keeps a TCP link across an upload', async () => {
      // Flashing over USB does not disturb an ethernet link, so debugging and
      // run/stop keep working through an upload.
      const h = harness()
      await h.manager.open([candidate('tcp', '192.168.0.50', [new FakeClient()], h.clients)])

      expect(h.manager.releaseSerialPort('/dev/ttyUSB0')).toBe(false)
      expect(h.manager.isConnected()).toBe(true)
      h.manager.close()
    })

    it('leaves a serial link on a different port alone', async () => {
      const h = harness()
      h.ports.add('/dev/ttyUSB1')
      await h.manager.open([candidate('rtu', '/dev/ttyUSB1', [new FakeClient()], h.clients)])

      expect(h.manager.releaseSerialPort('/dev/ttyUSB0')).toBe(false)
      expect(h.manager.isConnected()).toBe(true)
      h.manager.close()
    })
  })

  describe('polling', () => {
    it('stops polling once the link is closed', async () => {
      jest.useFakeTimers()
      const probe = jest.fn().mockResolvedValue(true)
      const h = harness({ probe })
      await h.manager.open([candidate('tcp', '192.168.0.50', [new FakeClient()], h.clients)])

      jest.advanceTimersByTime(30_000)
      const callsWhileOpen = probe.mock.calls.length
      expect(callsWhileOpen).toBeGreaterThan(0)

      h.manager.close()
      jest.advanceTimersByTime(30_000)
      expect(probe.mock.calls.length).toBe(callsWhileOpen)
    })
  })
})
