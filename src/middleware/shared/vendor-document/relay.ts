/**
 * Relay: runs inside the sandboxed iframe next to the vendor bundle and bridges host postMessage
 * requests to `window.DeviceEditorProvider`. `npm run build:relay` in openplc-editor bundles
 * `installWindowRelay(window)` into the `relay.js` a vendor package ships.
 */

import {
  type ConfiguratorTheme,
  type DataPoint,
  type DeviceReference,
  type DeviceSetup,
  type HostRelayMethod,
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
  applyTheme?: (theme: ConfiguratorTheme) => void
}

export const THEME_ATTRIBUTE = 'data-openplc-theme'
export const THEME_OVERRIDES_STYLESHEET = 'openplc-theme-overrides.css'

export interface ThemeOverrides {
  apply(theme: ConfiguratorTheme): void
  uninstall(): void
}

/** Must run before the vendor bundle: its UI renders in shadow roots that document stylesheets cannot reach. */
export function installThemeOverrides(guest: Window & typeof globalThis): ThemeOverrides {
  const doc = guest.document
  const prototype = guest.Element.prototype
  const attachShadow = prototype.attachShadow
  const links = new Set<HTMLLinkElement>()
  let dark = false

  const overridesLink = () => {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute('href', THEME_OVERRIDES_STYLESHEET)
    link.media = dark ? 'all' : 'not all'
    links.add(link)
    return link
  }

  const wrapped = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = attachShadow.call(this, init)
    root.append(overridesLink())
    return root
  }
  prototype.attachShadow = wrapped
  doc.head.append(overridesLink())

  return {
    apply: (theme) => {
      dark = theme === 'dark'
      doc.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
      links.forEach((link) => {
        link.media = dark ? 'all' : 'not all'
      })
    },
    uninstall: () => {
      if (prototype.attachShadow === wrapped) prototype.attachShadow = attachShadow
      links.forEach((link) => link.remove())
      links.clear()
    },
  }
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

/** Pending host query the guest is awaiting a response for. */
interface GuestPendingHostQuery {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface InstalledRelay {
  /** Stops the relay and rejects every pending host query. */
  stop(): void
  /** Guest-to-host query. Returns the raw host result, caller is responsible for shape validation. */
  callHost(method: HostRelayMethod, args: unknown[]): Promise<unknown>
}

const DEFAULT_HOST_QUERY_TIMEOUT_MS = 15_000

/**
 * The vendor bundle replaces `DeviceEditorConsumer` after scripts that ran before it, so the
 * relay waits for the vendor's object and patches its methods in place. Returns a handle whose
 * `stop()` tears it down and whose `callHost(method, args)` performs a guest-to-host query.
 */
export function installRelay(
  scope: RelayGuestScope,
  transport: RelayTransport<RelayToHostMessage>,
  options: RelayOptions = {},
): InstalledRelay {
  const pollIntervalMs = options.pollIntervalMs ?? 50
  const bootTimeoutMs = options.bootTimeoutMs ?? 60_000
  let ready = false
  const pendingHostQueries = new Map<string, GuestPendingHostQuery>()
  let nextHostQueryId = 0
  let stopped = false

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
    if (message.kind === 'host-response') {
      const pending = pendingHostQueries.get(message.id)
      if (!pending) return
      pendingHostQueries.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error ?? 'host query failed'))
      return
    }
    if (message.kind === 'host-event') {
      // Host-pushed events are observed by the embedded screen through its own `postMessage` listener,
      // not through the configurator relay. The relay forwards nothing and emits no response.
      return
    }
    if (message.kind === 'theme') {
      options.applyTheme?.(message.theme)
      return
    }
    const { id, method, args } = message
    const provider = scope.DeviceEditorProvider
    if (!ready) {
      transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: false, error: 'relay not ready' })
      return
    }
    if (!isRelayMethod(method)) {
      transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: false, error: `unsupported method ${method}` })
      return
    }
    if (!provider) {
      transport.post({ channel: RELAY_CHANNEL, kind: 'response', id, ok: false, error: 'no device editor provider' })
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

  function stop() {
    if (stopped) return
    stopped = true
    stopBootWait()
    unsubscribe()
    pendingHostQueries.forEach((entry) => {
      clearTimeout(entry.timer)
      entry.reject(new Error('relay stopped'))
    })
    pendingHostQueries.clear()
  }

  function callHost(method: HostRelayMethod, args: unknown[]): Promise<unknown> {
    if (stopped) return Promise.reject(new Error('relay stopped'))
    nextHostQueryId += 1
    const id = `h${nextHostQueryId}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHostQueries.delete(id)
        reject(new Error(`host did not answer ${method} within ${DEFAULT_HOST_QUERY_TIMEOUT_MS} ms`))
      }, DEFAULT_HOST_QUERY_TIMEOUT_MS)
      pendingHostQueries.set(id, { resolve, reject, timer })
      transport.post({ channel: RELAY_CHANNEL, kind: 'host-query', id, method, args })
    })
  }

  return { stop, callHost }
}

/** Entry point for the packaged script: listens only to the embedding parent. */
export function installWindowRelay(
  guest: Window & typeof globalThis & RelayGuestScope,
  options?: RelayOptions,
): InstalledRelay {
  const theme = installThemeOverrides(guest)
  const relay = installRelay(
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
    { ...options, applyTheme: theme.apply },
  )
  // Exposed so a VPP screen bundle can perform guest-to-host queries via `window.OpenPlcRelay.callHost(...)`.
  type RelayHostScope = Window & { OpenPlcRelay?: InstalledRelay }
  ;(guest as RelayHostScope).OpenPlcRelay = relay
  return {
    stop: () => {
      relay.stop()
      theme.uninstall()
    },
    callHost: (method, args) => relay.callHost(method, args),
  }
}
