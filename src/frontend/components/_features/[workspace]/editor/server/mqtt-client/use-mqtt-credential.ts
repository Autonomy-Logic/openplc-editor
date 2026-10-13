import { useCallback, useEffect, useState } from 'react'

import type {
  MqttCredentialBinding,
  MqttCredentialPresence,
  MqttCredentialScope,
  MqttCredentialSecret,
  MqttCredentialStorePort,
  MqttCredentialWriteResult,
} from '../../../../../../../middleware/shared/ports/mqtt-credential-port'
import { mqttCredentialScopeKey } from '../../../../../../utils/mqtt/credentials/session-store'

export interface MqttCredentialHandle {
  /** Null while the presence for the current scope is not known yet. */
  presence: MqttCredentialPresence | null
  save: (secret: MqttCredentialSecret, binding: MqttCredentialBinding) => Promise<MqttCredentialWriteResult>
  remove: () => Promise<void>
}

/** A scope switch forgets the previous answer; a change the store announces is read again. */
export const useMqttCredential = (
  store: MqttCredentialStorePort,
  scope: MqttCredentialScope | null,
): MqttCredentialHandle => {
  const scopeKey = scope === null ? null : mqttCredentialScopeKey(scope)
  const [state, setState] = useState<{ key: string | null; presence: MqttCredentialPresence | null }>({
    key: null,
    presence: null,
  })

  useEffect(() => {
    let active = true
    let generation = 0
    setState({ key: scopeKey, presence: null })
    if (scope === null) return
    const read = () => {
      const current = ++generation
      store
        .getPresence(scope)
        .then((presence) => {
          if (active && current === generation) setState({ key: scopeKey, presence })
        })
        .catch(() => {
          if (active && current === generation) setState({ key: scopeKey, presence: { present: false } })
        })
    }
    read()
    const unsubscribe = store.subscribe?.(read)
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [store, scope, scopeKey])

  const save = useCallback(
    async (secret: MqttCredentialSecret, binding: MqttCredentialBinding): Promise<MqttCredentialWriteResult> => {
      if (scope === null) {
        return { ok: false, code: 'credential_store_unavailable', message: 'Select the target runtime first.' }
      }
      const result = await store.put(scope, secret, binding)
      if (result.ok)
        setState((current) => (current.key === scopeKey ? { key: scopeKey, presence: result.presence } : current))
      return result
    },
    [store, scope, scopeKey],
  )

  const remove = useCallback(async (): Promise<void> => {
    if (scope === null) return
    await store.remove(scope)
    setState((current) => (current.key === scopeKey ? { key: scopeKey, presence: { present: false } } : current))
  }, [store, scope, scopeKey])

  return { presence: state.key === scopeKey ? state.presence : null, save, remove }
}
