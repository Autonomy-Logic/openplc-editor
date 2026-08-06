/**
 * Who may close the debug channel, and when.
 *
 * Two rules that pull against each other, which is why they are pinned here:
 *
 *   - A session whose debug medium is its OWN (Runtime v3's second Modbus TCP
 *     connection, v4's WebSocket) must close that channel when the debug session
 *     ends. Leaving it open holds an authenticated channel to the user's PLC for
 *     no reason, and contradicts the whole point of opening it lazily.
 *   - A BAREMETAL session must NOT close anything: control and debug are the same
 *     connection, so closing on debug-stop would disconnect the device and take
 *     run/stop and the status poll down with it.
 *
 * The bug these cover: per-command callers (`read variables` on every poll tick,
 * `write variable`, `verify md5`) were registered as lifetime holders, so the
 * holder set was never empty and the v3/v4 channel never closed.
 */
import type { DeviceDebugChannel, DeviceModbusTransport } from '../../../shared/debug/types'
import { type DeviceLinkHooks, DeviceSessionManager } from '../device-session-manager'

/** A debug channel that records whether it was closed. */
function fakeDebugChannel() {
  const channel = {
    connect: () => Promise.resolve(),
    disconnect: () => {
      channel.disconnects += 1
    },
    disconnects: 0,
  }
  return channel
}

/** A Modbus client standing in for a held baremetal link. */
function fakeModbusClient() {
  const client = {
    connect: () => Promise.resolve(),
    disconnect: () => {
      client.disconnects += 1
    },
    disconnects: 0,
  }
  return client
}

function managerWith(overrides: Partial<DeviceLinkHooks> = {}) {
  return new DeviceSessionManager({
    verify: () => Promise.resolve(true),
    probe: () => Promise.resolve(true),
    serialPortPresent: () => Promise.resolve(true),
    emit: () => undefined,
    log: () => undefined,
    ...overrides,
  })
}

describe('debug channel lifetime — a session with its own debug medium (v3 / v4)', () => {
  it('closes the channel once the debug session releases, even after per-command use', async () => {
    const channel = fakeDebugChannel()
    const manager = managerWith()
    manager.openRestSession({
      address: '192.168.0.9',
      debugChannel: {
        transport: 'websocket',
        descriptor: 'websocket 192.168.0.9',
        create: () => channel as unknown as DeviceDebugChannel,
      },
    })

    // The real order main.ts uses: connect (the lifetime holder), then commands.
    await manager.acquireDebugChannel('debug session')
    await manager.acquireDebugChannel('verify md5')
    manager.releaseDebugChannel('verify md5')
    for (let tick = 0; tick < 3; tick += 1) {
      await manager.acquireDebugChannel('read variables')
      manager.releaseDebugChannel('read variables')
    }
    expect(channel.disconnects).toBe(0) // still debugging — nothing may close it

    manager.releaseDebugChannel('debug session')

    expect(channel.disconnects).toBe(1)
    expect(manager.getDebugClient()).toBeNull()
  })

  it('opens exactly one channel across the whole session', async () => {
    let created = 0
    const channel = fakeDebugChannel()
    const manager = managerWith()
    manager.openRestSession({
      address: '192.168.0.9',
      debugChannel: {
        transport: 'websocket',
        descriptor: 'websocket 192.168.0.9',
        create: () => {
          created += 1
          return channel as unknown as DeviceDebugChannel
        },
      },
    })

    await manager.acquireDebugChannel('debug session')
    await manager.acquireDebugChannel('read variables')
    manager.releaseDebugChannel('read variables')

    expect(created).toBe(1)
  })

  it('keeps the channel while a second holder still needs it', async () => {
    const channel = fakeDebugChannel()
    const manager = managerWith()
    manager.openRestSession({
      address: '192.168.0.9',
      debugChannel: {
        transport: 'websocket',
        descriptor: 'websocket 192.168.0.9',
        create: () => channel as unknown as DeviceDebugChannel,
      },
    })

    await manager.acquireDebugChannel('debug session')
    await manager.acquireDebugChannel('licensing')
    manager.releaseDebugChannel('debug session')

    // Ref-counting still holds: one release does not close a channel another holds.
    expect(channel.disconnects).toBe(0)
    manager.releaseDebugChannel('licensing')
    expect(channel.disconnects).toBe(1)
  })
})

describe('debug channel lifetime — a baremetal session (one shared channel)', () => {
  it('never closes the device connection when a debug caller releases', async () => {
    const client = fakeModbusClient()
    const manager = managerWith()
    const opened = await manager.open([
      {
        transport: 'rtu',
        descriptor: '/dev/ttyACM0',
        baudRate: 115200,
        create: () => client as unknown as DeviceModbusTransport,
      },
    ])
    expect(opened.ok).toBe(true)

    await manager.acquireDebugChannel('debug session')
    await manager.acquireDebugChannel('read variables')
    manager.releaseDebugChannel('read variables')
    manager.releaseDebugChannel('debug session')

    // The control channel IS the debug channel here. Stopping the debugger must
    // leave run/stop and the status poll with a live connection.
    expect(client.disconnects).toBe(0)
    expect(manager.isConnected()).toBe(true)
    expect(manager.getDebugClient()).not.toBeNull()
    manager.close()
  })
})

describe('open() always reports a settled state', () => {
  it('emits disconnected when no candidate could be built', async () => {
    // Otherwise the renderer, which set 'connecting' the moment the user clicked,
    // is left there forever with its Connect button disabled.
    const emitted: string[] = []
    const manager = managerWith({
      emit: (status) => {
        emitted.push(status.status)
      },
    })

    const result = await manager.open([])

    expect(result.ok).toBe(false)
    expect(emitted).toContain('disconnected')
  })
})
