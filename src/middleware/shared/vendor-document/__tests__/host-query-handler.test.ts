import {
  type HostToRelayMessage,
  parseHostToRelayMessage,
  RELAY_CHANNEL,
  type RelayToHostMessage,
  type RelayTransport,
} from '../protocol'
import { installHostQueryHandler, UnsupportedHostMethodError } from '../host-query-handler'

type Posted = HostToRelayMessage

function createMemoryTransport(): {
  transport: RelayTransport<HostToRelayMessage>
  posted: Posted[]
  deliver(message: RelayToHostMessage): void
} {
  const posted: Posted[] = []
  let currentHandler: ((data: unknown) => void) | null = null
  return {
    transport: {
      post: (message) => posted.push(message),
      subscribe: (handler) => {
        currentHandler = handler
        return () => {
          if (currentHandler === handler) currentHandler = null
        }
      },
    },
    posted,
    deliver: (message) => currentHandler?.(message),
  }
}

/** Resolves after the promise microtask queue has drained, which is enough to settle one dispatcher call. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('installHostQueryHandler', () => {
  it('answers a known host method with its result', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    installHostQueryHandler(transport, async (method, args) => {
      expect(method).toBe('getPlcVariables')
      expect(args).toEqual([])
      return [{ qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true }]
    })
    deliver({ channel: RELAY_CHANNEL, kind: 'host-query', id: 'g1', method: 'getPlcVariables', args: [] })
    await flush()
    expect(posted).toEqual([
      {
        channel: RELAY_CHANNEL,
        kind: 'host-response',
        id: 'g1',
        ok: true,
        result: [{ qualifier: 'Program0.pump_speed', type: 'INT', isWritable: true }],
      },
    ])
    const roundTripped = parseHostToRelayMessage(posted[0])
    expect(roundTripped?.kind).toBe('host-response')
  })

  it('rejects an unknown host method with UnsupportedHostMethodError', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    installHostQueryHandler(transport, async () => 'never called')
    deliver({ channel: RELAY_CHANNEL, kind: 'host-query', id: 'g2', method: 'wat', args: [] })
    await flush()
    expect(posted).toHaveLength(1)
    expect(posted[0].kind).toBe('host-response')
    const response = posted[0]
    if (response.kind === 'host-response') {
      expect(response.ok).toBe(false)
      expect(response.error).toBe(new UnsupportedHostMethodError('wat').message)
    }
  })

  it('forwards dispatcher rejections as host-response errors', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    installHostQueryHandler(transport, async () => {
      throw new Error('boom')
    })
    deliver({ channel: RELAY_CHANNEL, kind: 'host-query', id: 'g3', method: 'getPlcVariables', args: [] })
    await flush()
    expect(posted[0]).toMatchObject({ kind: 'host-response', id: 'g3', ok: false, error: 'boom' })
  })

  it('ignores non host-query messages so it can share a transport with the configurator client', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    installHostQueryHandler(transport, async () => 'nope')
    deliver({ channel: RELAY_CHANNEL, kind: 'ready', relayVersion: 1 })
    deliver({ channel: RELAY_CHANNEL, kind: 'modified' })
    deliver({ channel: RELAY_CHANNEL, kind: 'error', message: 'meh' })
    await flush()
    expect(posted).toEqual([])
  })

  it('dispose() stops accepting further host queries', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    const session = installHostQueryHandler(transport, async () => 'answer')
    session.dispose()
    deliver({ channel: RELAY_CHANNEL, kind: 'host-query', id: 'g4', method: 'getPlcVariables', args: [] })
    await flush()
    expect(posted).toEqual([])
  })

  it('drops a dispatcher reply that resolves after dispose() so it cannot land on a reused transport', async () => {
    const { transport, posted, deliver } = createMemoryTransport()
    let release: (value: string) => void = () => undefined
    const session = installHostQueryHandler(
      transport,
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    )
    deliver({ channel: RELAY_CHANNEL, kind: 'host-query', id: 'g5', method: 'getPlcVariables', args: [] })
    session.dispose()
    release('late')
    await flush()
    expect(posted).toEqual([])
  })
})
