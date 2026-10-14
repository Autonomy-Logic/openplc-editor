import type { RuntimeIdentityPort } from '../../shared/ports/runtime-identity-port'

export const createEditorRuntimeIdentityAdapter = (): RuntimeIdentityPort => ({
  getPin: (targetKey) => window.bridge.runtimeIdentityGet(targetKey),
  setPin: (targetKey, fingerprint) => window.bridge.runtimeIdentitySet(targetKey, fingerprint),
  removePin: (targetKey) => window.bridge.runtimeIdentityRemove(targetKey),
})
