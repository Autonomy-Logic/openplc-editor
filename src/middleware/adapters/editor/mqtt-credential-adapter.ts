// The renderer sends a secret once and reads back presence only.

import type { MqttCredentialPersistence, MqttCredentialStorePort } from '../../shared/ports/mqtt-credential-port'

export const createEditorMqttCredentialAdapter = (): MqttCredentialStorePort => {
  // Session until the main process says otherwise, so the UI never promises a persistence it has not confirmed.
  let persistence: MqttCredentialPersistence = 'session'
  const adopt = (value: MqttCredentialPersistence | undefined) => {
    if (value === 'protected' || value === 'session') persistence = value
  }

  window.bridge
    .mqttCredentialsGetPersistence()
    .then(adopt)
    .catch(() => undefined)

  return {
    get persistence() {
      return persistence
    },

    async getPresence(scope) {
      const reply = await window.bridge.mqttCredentialsGetPresence(scope)
      if (!reply.ok) throw new Error(reply.message)
      adopt(reply.persistence)
      return reply.presence
    },

    async put(scope, secret, binding) {
      const reply = await window.bridge.mqttCredentialsPut(scope, secret, binding)
      adopt(reply.persistence)
      return reply.ok ? { ok: true, presence: reply.presence } : { ok: false, code: reply.code, message: reply.message }
    },

    async remove(scope) {
      const reply = await window.bridge.mqttCredentialsRemove(scope)
      if (!reply.ok) throw new Error(reply.message)
      adopt(reply.persistence)
    },
  }
}
