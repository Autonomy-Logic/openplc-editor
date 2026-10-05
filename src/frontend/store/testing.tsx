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

export function createStoreWrapper(store: OpenPLCStore, ports?: PlatformPorts) {
  return function StoreWrapper({ children }: { children: ReactNode }) {
    return (
      <OpenPLCStoreProvider store={store}>
        {ports ? <PlatformProvider ports={ports}>{children}</PlatformProvider> : children}
      </OpenPLCStoreProvider>
    )
  }
}
