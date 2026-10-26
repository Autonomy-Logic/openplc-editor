/**
 * Relay: runs inside the sandboxed iframe next to the vendor bundle and bridges host postMessage
 * requests to `window.DeviceEditorProvider`. `npm run build:relay` in openplc-editor bundles
 * `installWindowRelay(window)` into the `relay.js` a vendor package ships.
 */

import {
  type DataPoint,
  type DeviceReference,
  type DeviceSetup,
  isRelayMethod,
  parseHostToRelayMessage,
  RELAY_CHANNEL,
  RELAY_PROTOCOL_VERSION,
  type RelayMethod,
  type RelayToHostMessage,
  type RelayTransport,
} from './protocol'

export interface DeviceEditorProviderLike {
  show(deviceId?: string): Promise<void>
  setController(deviceTypeId: string): Promise<void>
  setProject(data?: string): Promise<void>
  getConfiguration(): Promise<string>
  getDeviceSetup(): Promise<unknown>
  getDataPoints(): Promise<unknown>
}

export interface DeviceEditorConsumerLike {
  setProjectModified(): Promise<void>
  setLiveDataArrived(): Promise<void>
  notifyError?(message: string): Promise<void>
  notifyWarning?(message: string): Promise<void>
  notifyInformation?(message: string): Promise<void>
}

export interface RelayGuestScope {
  DeviceEditorProvider?: DeviceEditorProviderLike
  DeviceEditorConsumer?: DeviceEditorConsumerLike
}

export interface RelayOptions {
  pollIntervalMs?: number
  /** How long to wait for the vendor bundle to publish its provider and consumer. */
  bootTimeoutMs?: number
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {}
}

const str = (value: unknown): string => {
  if (typeof value === 'string') return value
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}
const num = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0))
const optionalStr = (value: unknown) => (value === undefined || value === null ? undefined : str(value))

function toDeviceReference(value: unknown): DeviceReference {
  const record = toRecord(value)
  return { guid: str(record.guid), name: str(record.name), typeId: str(record.typeId) }
}

/** Copies only declared fields so vendor class instances never reach structured clone. */
function toDeviceSetup(value: unknown): DeviceSetup {
  const record = toRecord(value)
  const devices = Array.isArray(record.devices) ? record.devices : []
  return { systembus: toDeviceReference(record.systembus), devices: devices.map(toDeviceReference) }
}

function toDataPoints(value: unknown): DataPoint[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = toRecord(item)
    return {
      id: str(record.id),
      name: str(record.name),
      min: optionalStr(record.min),
      max: optionalStr(record.max),
      datatype: str(record.datatype),
      byteoffset: num(record.byteoffset),
      bitoffset: num(record.bitoffset),
      bitlength: num(record.bitlength),
      direction: optionalStr(record.direction),
      access: optionalStr(record.access),
    }
  })
}

async function invoke(provider: DeviceEditorProviderLike, method: RelayMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'setController':
      return provider.setController(str(args[0]))
    case 'show':
      return provider.show()
    case 'setProject': {
      const archive = args[0]
      if (typeof archive !== 'string' || archive.length === 0) throw new Error('setProject needs a non-empty archive')
      return provider.setProject(archive)
    }
    case 'getConfiguration':
      return str(await provider.getConfiguration())
    case 'getDeviceSetup':
      return toDeviceSetup(await provider.getDeviceSetup())
    case 'getDataPoints':
      return toDataPoints(await provider.getDataPoints())
    default: {
      const exhaustive: never = method
      return exhaustive
    }
  }
}

/**
 * The vendor bundle replaces `DeviceEditorConsumer` after scripts that ran before it, so the
 * relay waits for the vendor's object and patches its methods in place. Returns a stop function.
 */
export function installRelay(
  scope: RelayGuestScope,
  transport: RelayTransport<RelayToHostMessage>,
  options: RelayOptions = {},
): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? 50
  const bootTimeoutMs = options.bootTimeoutMs ?? 60_000
  let ready = false

  const announce = () => transport.post({ channel: RELAY_CHANNEL, kind: 'ready', relayVersion: RELAY_PROTOCOL_VERSION })
  const reportError = (message: string) => transport.post({ channel: RELAY_CHANNEL, kind: 'error', message })

  const tryBoot = () => {
    const consumer = scope.DeviceEditorConsumer
    if (!scope.DeviceEditorProvider || !consumer) return false
    consumer.setProjectModified = () => {
      transport.post({ channel: RELAY_CHANNEL, kind: 'modified' })
      return Promise.resolve()
    }
    consumer.setLiveDataArrived = () => Promise.resolve()
    consumer.notifyError = (message: string) => {
      reportError(str(message))
      return Promise.resolve()
    }
    ready = true
    announce()
    return true
  }

  const poll = setInterval(() => {
    if (tryBoot()) stopBootWait()
  }, pollIntervalMs)
  const bootTimer = setTimeout(() => {
    stopBootWait()
    if (!ready) reportError('The configurator bundle did not start.')
  }, bootTimeoutMs)
  function stopBootWait() {
    clearInterval(poll)
    clearTimeout(bootTimer)
  }

  const unsubscribe = transport.subscribe((data) => {
    const message = parseHostToRelayMessage(data)
    if (!message) return
    if (message.kind === 'hello') {
      if (ready) announce()
      return
    }
    const { id, method, args } = message
    const provider = scope.DeviceEditorProvider
    if (!ready || !provider) {
      transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: false, error: 'relay not ready' })
      return
    }
    if (!isRelayMethod(method)) {
      transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: false, error: `unsupported method ${method}` })
      return
    }
    invoke(provider, method, args).then(
      (result) => transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: true, result }),
      (error: unknown) =>
        transport.post({
          channel: RELAY_CHANNEL,
          kind: 'response',
          id,
          ok: false,
          error: error instanceof Error ? error.message : str(error),
        }),
    )
  })

  if (tryBoot()) stopBootWait()

  return () => {
    stopBootWait()
    unsubscribe()
  }
}

/** Entry point for the packaged script: listens only to the embedding parent. */
export function installWindowRelay(guest: Window & RelayGuestScope, options?: RelayOptions): () => void {
  return installRelay(
    guest,
    {
      post: (message) => guest.parent.postMessage(message, '*'),
      subscribe: (handler) => {
        const listener = (event: MessageEvent) => {
          if (event.source !== guest.parent) return
          handler(event.data)
        }
        guest.addEventListener('message', listener)
        return () => guest.removeEventListener('message', listener)
      },
    },
    options,
  )
}
