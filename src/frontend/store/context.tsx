import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'

import type { OpenPLCStore, RootState } from './index'

const OpenPLCStoreContext = createContext<OpenPLCStore | null>(null)

type OpenPLCStoreProviderProps = {
  store: OpenPLCStore
  children: ReactNode
}

export function OpenPLCStoreProvider({ store, children }: OpenPLCStoreProviderProps) {
  return <OpenPLCStoreContext.Provider value={store}>{children}</OpenPLCStoreContext.Provider>
}

export function useOpenPLCStoreApi(): OpenPLCStore {
  const store = useContext(OpenPLCStoreContext)
  if (!store) throw new Error('useOpenPLCStoreApi must be used within an OpenPLCStoreProvider')
  return store
}

const selectWholeState = (state: RootState): RootState => state

export function useOpenPLCStore(): RootState
export function useOpenPLCStore<T>(selector: (state: RootState) => T): T
export function useOpenPLCStore<T>(selector?: (state: RootState) => T): T | RootState {
  return useStore<OpenPLCStore, T | RootState>(useOpenPLCStoreApi(), selector ?? selectWholeState)
}
