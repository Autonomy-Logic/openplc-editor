import { useEffect } from 'react'

import { useRuntime } from '../../middleware/shared/providers'
import { disconnectEndedRuntimeSession, refreshRuntimeAccount } from '../services/runtime-account'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'

/**
 * Keeps the signed-in runtime account's role in the store: read on connect and after every re-sign-in, cleared on
 * disconnect. Disconnects with a notice when the runtime refuses to sign the account in again.
 */
export const useRuntimeAccount = (): void => {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      void refreshRuntimeAccount(store, runtime)
    } else if (store.getState().runtimeConnection.accountRole !== null) {
      store.getState().deviceActions.setRuntimeAccountRole(null)
    }
  }, [store, runtime, connectionStatus])

  useEffect(() => {
    const unsubscribeRefreshed = runtime.onTokenRefreshed?.(() => {
      void refreshRuntimeAccount(store, runtime)
    })
    const unsubscribeEnded = runtime.onSessionEnded?.(() => {
      void disconnectEndedRuntimeSession(store, runtime)
    })
    return () => {
      unsubscribeRefreshed?.()
      unsubscribeEnded?.()
    }
  }, [store, runtime])
}
