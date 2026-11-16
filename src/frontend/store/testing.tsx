import type { ReactNode } from 'react'

import { PlatformProvider } from '../../middleware/shared/providers'
import type { PlatformPorts } from '../../middleware/shared/providers/types'
import { OpenPLCStoreProvider } from './context'
import { createOpenPLCStore, type OpenPLCStore, type StoreConfig } from './index'

type TestStoreSeed = (store: OpenPLCStore) => void

let seed: TestStoreSeed | null = null

/** Registered once by each runner's setup file (system libraries read from disk). */
export function setTestStoreSeed(next: TestStoreSeed | null): void {
  seed = next
}

export function createTestStore(config: StoreConfig = {}): OpenPLCStore {
  const store = createOpenPLCStore(config)
  seed?.(store)
  return store
}

type PortName = Exclude<keyof PlatformPorts, 'capabilities'>

export type TestPortOverrides = { [K in PortName]?: Partial<PlatformPorts[K]> } & {
  capabilities: PlatformPorts['capabilities']
}

/**
 * Platform ports for a render test: each named port answers with the overrides given, and with a
 * method returning `undefined` for anything else. One stub per port name, so a port kept in a hook
 * dependency array stays the same object across renders.
 */
export function createTestPorts({ capabilities, ...overrides }: TestPortOverrides): PlatformPorts {
  const built = new Map<string, object>()
  const portFor = (name: string): object => {
    const existing = built.get(name)
    if (existing) return existing
    const given: unknown = name in overrides ? overrides[name as PortName] : undefined
    const target: object = typeof given === 'object' && given !== null ? given : {}
    const port = new Proxy(target, {
      get(proxyTarget, prop, receiver) {
        if (prop in proxyTarget) {
          const value: unknown = Reflect.get(proxyTarget, prop, receiver)
          return value
        }
        return typeof prop === 'string' ? () => undefined : undefined
      },
    })
    built.set(name, port)
    return port
  }

  // The one assertion of the test helpers: a Proxy cannot be typed as the interface it stands in for.
  const seed = { capabilities } as PlatformPorts
  return new Proxy(seed, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || prop === 'capabilities') {
        const value: unknown = Reflect.get(target, prop, receiver)
        return value
      }
      return portFor(prop)
    },
  })
}

export function createStoreWrapper(store: OpenPLCStore, ports?: PlatformPorts) {
  return function StoreWrapper({ children }: { children: ReactNode }) {
    return (
      <OpenPLCStoreProvider store={store}>
        {ports ? <PlatformProvider ports={ports}>{children}</PlatformProvider> : children}
      </OpenPLCStoreProvider>
    )
  }
}
