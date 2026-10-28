/**
 * Host-side responder for guest-to-host queries over the vendor-document relay channel.
 * Listens for `host-query` kinds and replies with `host-response`. Also sends the initial `hello`
 * so the guest sees the host as ready without needing a full configurator client.
 */

import {
  type HostRelayMethod,
  type HostToRelayMessage,
  isHostRelayMethod,
  parseRelayToHostMessage,
  RELAY_CHANNEL,
  type RelayTransport,
} from './protocol'

export type HostQueryDispatcher = (method: HostRelayMethod, args: unknown[]) => Promise<unknown>

export interface HostQuerySession {
  dispose(): void
}

/** Returned when the guest asks a method that has no registered handler. */
export class UnsupportedHostMethodError extends Error {
  constructor(readonly method: string) {
    super(`host does not support ${method}`)
    this.name = 'UnsupportedHostMethodError'
  }
}

/**
 * Install the host-side responder on a transport (typically the iframe transport). Returns a
 * handle whose `dispose()` detaches the listener. The transport is shared with
 * `createConfiguratorClient`; the two layer cleanly because they consume disjoint message kinds.
 */
export function installHostQueryHandler(
  transport: RelayTransport<HostToRelayMessage>,
  dispatcher: HostQueryDispatcher,
): HostQuerySession {
  const unsubscribe = transport.subscribe((data) => {
    const message = parseRelayToHostMessage(data)
    if (!message || message.kind !== 'host-query') return
    const { id, method, args } = message
    if (!isHostRelayMethod(method)) {
      transport.post({
        channel: RELAY_CHANNEL,
        kind: 'host-response',
        id,
        ok: false,
        error: new UnsupportedHostMethodError(method).message,
      })
      return
    }
    dispatcher(method, args).then(
      (result) => transport.post({ channel: RELAY_CHANNEL, kind: 'host-response', id, ok: true, result }),
      (error: unknown) =>
        transport.post({
          channel: RELAY_CHANNEL,
          kind: 'host-response',
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  })
  return { dispose: () => unsubscribe() }
}
