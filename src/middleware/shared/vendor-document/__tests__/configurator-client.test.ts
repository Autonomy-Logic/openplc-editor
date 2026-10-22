import { afterEach, describe, expect, it } from '@jest/globals'

import {
  type FakeDeviceEditorOptions,
  installFakeDeviceEditor,
} from '../../../../__fixtures__/fake-device-editor/fake-device-editor'
import { installRelay, type RelayGuestScope } from '../relay'
import {
  ConfiguratorDisposedError,
  ConfiguratorRemoteError,
  ConfiguratorTimeoutError,
  createConfiguratorClient,
  createIframeTransport,
  RelayVersionMismatchError,
} from '../configurator-client'
import {
  type HostToRelayMessage,
  MAX_ARCHIVE_HEX_LENGTH,
  MAX_DEVICE_SETUP_DEVICES,
  RELAY_CHANNEL,
  RELAY_PROTOCOL_VERSION,
  type RelayToHostMessage,
  type RelayTransport,
} from '../protocol'

/** Two transports joined like a MessageChannel: async delivery of structured clones. */
function createChannel() {
  const hostHandlers = new Set<(data: unknown) => void>()
  const guestHandlers = new Set<(data: unknown) => void>()
  const sentToGuest: unknown[] = []
  const deliver = (handlers: Set<(data: unknown) => void>, message: unknown) => {
    const copy: unknown = structuredClone(message)
    setTimeout(() => handlers.forEach((handler) => handler(copy)), 0)
  }
  const host: RelayTransport<HostToRelayMessage> = {
    post: (message) => {
      sentToGuest.push(message)
      deliver(guestHandlers, message)
    },
    subscribe: (handler) => {
      hostHandlers.add(handler)
      return () => hostHandlers.delete(handler)
    },
  }
  const guest: RelayTransport<RelayToHostMessage> = {
    post: (message) => deliver(hostHandlers, message),
    subscribe: (handler) => {
      guestHandlers.add(handler)
      return () => guestHandlers.delete(handler)
    },
  }
  const rawToHost = (data: unknown) => deliver(hostHandlers, data)
  return { host, guest, sentToGuest, rawToHost }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

function setup(fakeOptions: FakeDeviceEditorOptions = {}) {
  const channel = createChannel()
  const scope: RelayGuestScope = {}
  const fake = installFakeDeviceEditor(scope, fakeOptions)
  cleanups.push(installRelay(scope, channel.guest, { pollIntervalMs: 5, bootTimeoutMs: 1_000 }))
  const client = createConfiguratorClient(channel.host, { readyTimeoutMs: 1_000, requestTimeoutMs: 500 })
  cleanups.push(() => client.dispose())
  let modified = 0
  client.onModified(() => {
    modified += 1
  })
  return { client, fake, scope, channel, modifiedCount: () => modified }
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

describe('configurator client over the relay', () => {
  it('takes a snapshot from the configuration and the device setup only, never the datapoints', async () => {
    const { client, fake, channel } = setup()
    await client.ready()
    await client.setController('UC20-M3000')
    await client.show()
    fake.addModule('FAKE-4DI')
    await tick()
    channel.sentToGuest.splice(0)

    await client.snapshot()

    const methods = channel.sentToGuest.flatMap((message) =>
      typeof message === 'object' && message !== null && 'method' in message ? [message.method] : [],
    )
    expect(methods).toEqual(['getConfiguration', 'getDeviceSetup'])
  })

  it('refuses a snapshot whose archive is not bounded hex', async () => {
    for (const archive of ['zz', 'abc', '', 'a'.repeat(MAX_ARCHIVE_HEX_LENGTH + 2)]) {
      const { client, scope } = setup()
      await client.ready()
      const provider = scope.DeviceEditorProvider
      if (!provider) throw new Error('the fake published no provider')
      provider.getConfiguration = () => Promise.resolve(archive)
      await expect(client.snapshot()).rejects.toBeInstanceOf(ConfiguratorRemoteError)
    }
  })

  it('refuses a device setup with more devices than the bound', async () => {
    const { client, scope } = setup()
    await client.ready()
    const provider = scope.DeviceEditorProvider
    if (!provider) throw new Error('the fake published no provider')
    const device = { guid: 'g', name: 'n', typeId: 't' }
    provider.getDeviceSetup = () =>
      Promise.resolve({
        systembus: device,
        devices: Array.from({ length: MAX_DEVICE_SETUP_DEVICES + 1 }, () => device),
      })
    await expect(client.getDeviceSetup()).rejects.toBeInstanceOf(ConfiguratorRemoteError)
  })

  it('becomes ready only after the bundle publishes its consumer, then relays its events', async () => {
    const { client, scope, modifiedCount } = setup({ consumerDelayMs: 40 })
    let ready = false
    void client.ready().then(() => {
      ready = true
    })
    await tick(15)
    expect(ready).toBe(false)
    expect(scope.DeviceEditorConsumer).toBeUndefined()

    await client.ready()
    await client.setController('UC20-M3000')
    await tick()
    expect(modifiedCount()).toBe(2)
  })

  it('round-trips every method and reproduces the device setup from the archive', async () => {
    const first = setup()
    await first.client.ready()
    await first.client.setController('UC20-M3000')
    await first.client.show()
    first.fake.addModule('FAKE-4DI')
    first.fake.addModule('FAKE-2AI')
    first.fake.addModule('FAKE-4DO')
    await tick()
    expect(first.modifiedCount()).toBe(5)

    const snapshot = await first.client.snapshot()
    expect(snapshot.archive).toMatch(/^[0-9a-f]+$/)
    expect(snapshot.deviceSetup.systembus.typeId).toBe('UC20-M3000')
    expect(snapshot.deviceSetup.devices.map((device) => device.typeId)).toEqual(['FAKE-4DI', 'FAKE-2AI', 'FAKE-4DO'])
    expect(Object.keys(snapshot).sort()).toEqual(['archive', 'deviceSetup'])

    const second = setup()
    await second.client.ready()
    await second.client.load(snapshot.archive)
    await tick()
    expect(second.modifiedCount()).toBe(1)
    expect(await second.client.getDeviceSetup()).toEqual(snapshot.deviceSetup)
    expect((await second.client.snapshot()).archive).toBe(snapshot.archive)
  })

  it('refuses an empty archive without sending anything to the guest', async () => {
    const { client, channel } = setup()
    await client.ready()
    await expect(client.load('')).rejects.toThrow('empty configurator archive')
    expect(channel.sentToGuest.some((message) => JSON.stringify(message).includes('setProject'))).toBe(false)
  })

  it('reports a rejected load and lets a silent one through for the caller to verify', async () => {
    const rejecting = setup({ loadFailure: 'reject' })
    await rejecting.client.ready()
    await expect(rejecting.client.load('00')).rejects.toBeInstanceOf(ConfiguratorRemoteError)

    const silent = setup({ loadFailure: 'silent' })
    await silent.client.ready()
    await silent.client.load('7b7d')
    expect((await silent.client.getDeviceSetup()).devices).toEqual([])
  })

  it('forwards notifyError from the bundle', async () => {
    const { client, scope } = setup()
    await client.ready()
    const errors: string[] = []
    client.onError((message) => errors.push(message))
    await scope.DeviceEditorConsumer?.notifyError?.('worker blocked')
    await tick()
    expect(errors).toEqual(['worker blocked'])
  })

  it('rejects pending and later calls after dispose', async () => {
    const { client, scope } = setup()
    await client.ready()
    if (scope.DeviceEditorProvider) scope.DeviceEditorProvider.show = () => new Promise(() => undefined)
    const pending = client.show()
    client.dispose()
    await expect(pending).rejects.toBeInstanceOf(ConfiguratorDisposedError)
    await expect(client.getDeviceSetup()).rejects.toBeInstanceOf(ConfiguratorDisposedError)
  })
})

describe('configurator client failures', () => {
  it('times out when no relay ever answers', async () => {
    const channel = createChannel()
    const client = createConfiguratorClient(channel.host, { readyTimeoutMs: 30 })
    cleanups.push(() => client.dispose())
    await expect(client.ready()).rejects.toBeInstanceOf(ConfiguratorTimeoutError)
    await expect(client.show()).rejects.toBeInstanceOf(ConfiguratorTimeoutError)
  })

  it('times out a call the guest never answers', async () => {
    const channel = createChannel()
    const client = createConfiguratorClient(channel.host, { requestTimeoutMs: 30 })
    cleanups.push(() => client.dispose())
    channel.guest.post({ channel: RELAY_CHANNEL, kind: 'ready', relayVersion: RELAY_PROTOCOL_VERSION })
    await client.ready()
    await expect(client.show()).rejects.toThrow('did not answer show')
  })

  it('refuses a relay that speaks another protocol version', async () => {
    const channel = createChannel()
    const client = createConfiguratorClient(channel.host)
    cleanups.push(() => client.dispose())
    channel.guest.post({ channel: RELAY_CHANNEL, kind: 'ready', relayVersion: RELAY_PROTOCOL_VERSION + 1 })
    await expect(client.ready()).rejects.toBeInstanceOf(RelayVersionMismatchError)
    await expect(client.setController('UC20-M3000')).rejects.toBeInstanceOf(RelayVersionMismatchError)
    expect(channel.sentToGuest.every((message) => JSON.stringify(message).includes('"hello"'))).toBe(true)
  })

  it('rejects a malformed result from the guest', async () => {
    const channel = createChannel()
    const client = createConfiguratorClient(channel.host)
    cleanups.push(() => client.dispose())
    channel.guest.subscribe((data) => {
      if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') {
        channel.guest.post({ channel: RELAY_CHANNEL, kind: 'response', id: data.id, ok: true, result: { devices: 1 } })
      }
    })
    channel.guest.post({ channel: RELAY_CHANNEL, kind: 'ready', relayVersion: RELAY_PROTOCOL_VERSION })
    await expect(client.getDeviceSetup()).rejects.toThrow('malformed result')
  })

  it('ignores messages that are not on the relay channel', async () => {
    const channel = createChannel()
    const client = createConfiguratorClient(channel.host, { readyTimeoutMs: 30 })
    cleanups.push(() => client.dispose())
    channel.rawToHost({ kind: 'ready', relayVersion: RELAY_PROTOCOL_VERSION })
    await expect(client.ready()).rejects.toBeInstanceOf(ConfiguratorTimeoutError)
  })
})

describe('relay', () => {
  it('rejects methods outside the protocol', async () => {
    const { client, channel } = setup()
    await client.ready()
    const responses: unknown[] = []
    channel.host.subscribe((data) => responses.push(data))
    channel.host.post({ channel: RELAY_CHANNEL, kind: 'request', id: 'x1', method: 'getProject', args: [] })
    await tick()
    expect(responses).toContainEqual({
      channel: RELAY_CHANNEL,
      kind: 'response',
      id: 'x1',
      ok: false,
      error: 'unsupported method getProject',
    })
  })

  it('reports a bundle that never publishes its provider', async () => {
    const channel = createChannel()
    cleanups.push(installRelay({}, channel.guest, { pollIntervalMs: 5, bootTimeoutMs: 30 }))
    const client = createConfiguratorClient(channel.host, { readyTimeoutMs: 1_000 })
    cleanups.push(() => client.dispose())
    const errors: string[] = []
    client.onError((message) => errors.push(message))
    await tick(60)
    expect(errors).toEqual(['The configurator bundle did not start.'])
  })
})

describe('iframe transport', () => {
  function mountIframe() {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    cleanups.push(() => iframe.remove())
    const received: unknown[] = []
    const transport = createIframeTransport(iframe)
    cleanups.push(transport.subscribe((data) => received.push(data)))
    return { iframe, received }
  }

  it('accepts only opaque-origin messages from its own iframe', () => {
    const { iframe, received } = mountIframe()
    const other = mountIframe()
    const send = (source: Window | null, origin: string, data: string) =>
      window.dispatchEvent(new MessageEvent('message', { source, origin, data }))

    send(iframe.contentWindow, 'null', 'accepted')
    send(iframe.contentWindow, 'http://localhost', 'same-origin guest')
    send(other.iframe.contentWindow, 'null', 'other iframe')
    send(window, 'null', 'host itself')

    expect(received).toEqual(['accepted'])
  })
})
