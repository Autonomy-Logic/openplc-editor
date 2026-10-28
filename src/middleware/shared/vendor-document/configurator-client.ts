import { z } from 'zod'

import type { ConfiguratorPort, ConfiguratorSnapshot } from '../ports/configurator-port'
import type { Unsubscribe } from '../ports/types'
import {
  configuratorArchiveSchema,
  deviceSetupSchema,
  type HostToRelayMessage,
  parseRelayToHostMessage,
  RELAY_CHANNEL,
  RELAY_PROTOCOL_VERSION,
  type RelayMethod,
  type RelayTransport,
} from './protocol'

export interface ConfiguratorClientOptions {
  /** Time allowed for the relay to announce itself. */
  readyTimeoutMs?: number
  /** Time allowed for one call; `setProject` unpacks the archive and gets `loadTimeoutMs`. */
  requestTimeoutMs?: number
  loadTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_LOAD_TIMEOUT_MS = 60_000

export class RelayVersionMismatchError extends Error {
  constructor(readonly relayVersion: number) {
    super(
      `The configurator package ships relay protocol version ${relayVersion}, but this editor requires version ${RELAY_PROTOCOL_VERSION}.`,
    )
    this.name = 'RelayVersionMismatchError'
  }
}

export class ConfiguratorTimeoutError extends Error {
  constructor(what: string, timeoutMs: number) {
    super(`The configurator did not answer ${what} within ${timeoutMs} ms.`)
    this.name = 'ConfiguratorTimeoutError'
  }
}

export class ConfiguratorRemoteError extends Error {
  constructor(method: RelayMethod, message: string) {
    super(`The configurator failed ${method}: ${message}`)
    this.name = 'ConfiguratorRemoteError'
  }
}

export class ConfiguratorDisposedError extends Error {
  constructor() {
    super('The configurator was closed.')
    this.name = 'ConfiguratorDisposedError'
  }
}

interface PendingRequest {
  method: RelayMethod
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function parseResult<T>(method: RelayMethod, schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result)
  if (!parsed.success) throw new ConfiguratorRemoteError(method, 'malformed result')
  return parsed.data
}

export function createConfiguratorClient(
  transport: RelayTransport<HostToRelayMessage>,
  options: ConfiguratorClientOptions = {},
): ConfiguratorPort {
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS

  const pending = new Map<string, PendingRequest>()
  const modifiedListeners = new Set<() => void>()
  const errorListeners = new Set<(message: string) => void>()
  let nextId = 0
  let disposed = false

  let settleReady: { resolve: () => void; reject: (error: Error) => void } | null = null
  const readyPromise = new Promise<void>((resolve, reject) => {
    settleReady = { resolve, reject }
  })
  readyPromise.catch(() => undefined)
  const readyTimer = setTimeout(() => failReady(new ConfiguratorTimeoutError('ready', readyTimeoutMs)), readyTimeoutMs)

  function failReady(error: Error) {
    clearTimeout(readyTimer)
    settleReady?.reject(error)
    settleReady = null
  }

  function handleMessage(data: unknown) {
    const message = parseRelayToHostMessage(data)
    if (!message || disposed) return
    switch (message.kind) {
      case 'ready':
        if (!settleReady) return
        if (message.relayVersion !== RELAY_PROTOCOL_VERSION) {
          failReady(new RelayVersionMismatchError(message.relayVersion))
          return
        }
        clearTimeout(readyTimer)
        settleReady.resolve()
        settleReady = null
        return
      case 'response': {
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        clearTimeout(request.timer)
        if (message.ok) request.resolve(message.result)
        else request.reject(new ConfiguratorRemoteError(request.method, message.error ?? 'unknown error'))
        return
      }
      case 'modified':
        modifiedListeners.forEach((listener) => listener())
        return
      case 'error':
        errorListeners.forEach((listener) => listener(message.message))
        return
      default: {
        const exhaustive: never = message
        return exhaustive
      }
    }
  }

  const unsubscribe = transport.subscribe(handleMessage)
  transport.post({ channel: RELAY_CHANNEL, kind: 'hello' })

  async function request(method: RelayMethod, args: unknown[], timeoutMs = requestTimeoutMs): Promise<unknown> {
    if (disposed) throw new ConfiguratorDisposedError()
    await readyPromise
    if (disposed) throw new ConfiguratorDisposedError()
    nextId += 1
    const id = `r${nextId}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new ConfiguratorTimeoutError(method, timeoutMs))
      }, timeoutMs)
      pending.set(id, { method, resolve, reject, timer })
      transport.post({ channel: RELAY_CHANNEL, kind: 'request', id, method, args })
    })
  }

  async function getDeviceSetup() {
    return parseResult('getDeviceSetup', deviceSetupSchema, await request('getDeviceSetup', []))
  }

  return {
    ready: () => readyPromise,
    setController: async (deviceTypeId) => {
      await request('setController', [deviceTypeId])
    },
    show: async () => {
      await request('show', [])
    },
    load: async (archive) => {
      if (archive.length === 0) throw new Error('Refusing to load an empty configurator archive.')
      await request('setProject', [archive], loadTimeoutMs)
    },
    getDeviceSetup,
    snapshot: async (): Promise<ConfiguratorSnapshot> => {
      const archive = parseResult('getConfiguration', configuratorArchiveSchema, await request('getConfiguration', []))
      const deviceSetup = await getDeviceSetup()
      return { archive, deviceSetup }
    },
    onModified: (callback): Unsubscribe => {
      modifiedListeners.add(callback)
      return () => modifiedListeners.delete(callback)
    },
    onError: (callback): Unsubscribe => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      failReady(new ConfiguratorDisposedError())
      pending.forEach((entry) => {
        clearTimeout(entry.timer)
        entry.reject(new ConfiguratorDisposedError())
      })
      pending.clear()
      modifiedListeners.clear()
      errorListeners.clear()
    },
  }
}

/**
 * Transport over a sandboxed iframe. The guest's origin is opaque, so only messages whose
 * `source` is this iframe's window and whose origin is `"null"` are accepted.
 */
export function createIframeTransport(iframe: HTMLIFrameElement): RelayTransport<HostToRelayMessage> {
  const hostWindow = iframe.ownerDocument.defaultView
  return {
    post: (message) => iframe.contentWindow?.postMessage(message, '*'),
    subscribe: (handler) => {
      if (!hostWindow) return () => undefined
      const listener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== 'null') return
        handler(event.data)
      }
      hostWindow.addEventListener('message', listener)
      return () => hostWindow.removeEventListener('message', listener)
    },
  }
}

export function createIframeConfiguratorClient(
  iframe: HTMLIFrameElement,
  options?: ConfiguratorClientOptions,
): ConfiguratorPort {
  return createConfiguratorClient(createIframeTransport(iframe), options)
}
