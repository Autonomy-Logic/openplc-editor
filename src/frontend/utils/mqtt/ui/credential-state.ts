import type {
  MqttCredentialBinding,
  MqttCredentialPresence,
} from '../../../../middleware/shared/ports/mqtt-credential-port'
import type { MqttProjectIntegrationV1 } from '../contract/contract'
import { isMqttSecretAuthMethod } from '../project/model'
import type { MqttRuntimeBinding, MqttRuntimeCredentialStatus } from '../runtime/status'

/** Stable identity of the selected runtime, or null when no target is selected. */
export const mqttTargetKey = (target: {
  selectedDevice?: { orchestratorId: string; deviceId: string } | null
  runtimeIpAddress?: string | null
}): string | null => {
  if (target.selectedDevice) return `device:${target.selectedDevice.orchestratorId}/${target.selectedDevice.deviceId}`
  const address = target.runtimeIpAddress?.trim() ?? ''
  return address === '' ? null : `address:${address}`
}

/** Broker parameters a credential of this integration is bound to; null when it needs none. */
export const mqttCredentialBinding = (integration: MqttProjectIntegrationV1): MqttCredentialBinding | null =>
  isMqttSecretAuthMethod(integration.authMethod)
    ? {
        host: integration.connection.host,
        port: integration.connection.port,
        tlsEnabled: integration.connection.tls.enabled,
        clientId: integration.connection.clientId,
        method: integration.authMethod,
      }
    : null

export const mqttBindingsEqual = (a: MqttCredentialBinding, b: MqttCredentialBinding): boolean =>
  a.host === b.host &&
  a.port === b.port &&
  a.tlsEnabled === b.tlsEnabled &&
  a.clientId === b.clientId &&
  a.method === b.method

export const mqttRuntimeBindingMatches = (binding: MqttCredentialBinding, runtime: MqttRuntimeBinding): boolean =>
  mqttBindingsEqual(binding, {
    host: runtime.host,
    port: runtime.port,
    tlsEnabled: runtime.tls_enabled,
    clientId: runtime.client_id,
    method: runtime.method,
  })

export type MqttCredentialState =
  | { kind: 'not_required' }
  | { kind: 'no_target' }
  | { kind: 'loading' }
  | { kind: 'local'; presence: MqttCredentialPresence }
  | { kind: 'runtime'; active: MqttRuntimeCredentialStatus }
  | { kind: 'binding_mismatch'; presence: MqttCredentialPresence }
  | { kind: 'missing' }

/** Whether the integration has the credential it needs for the selected target, and where it comes from. */
export const evaluateMqttCredentialState = (input: {
  integration: MqttProjectIntegrationV1
  targetKey: string | null
  local: MqttCredentialPresence | null
  runtimeActive: MqttRuntimeCredentialStatus | null
}): MqttCredentialState => {
  const binding = mqttCredentialBinding(input.integration)
  if (binding === null) return { kind: 'not_required' }
  if (input.targetKey === null) return { kind: 'no_target' }
  if (input.local === null) return { kind: 'loading' }
  const { local } = input
  if (local.present && local.binding && mqttBindingsEqual(local.binding, binding)) {
    return { kind: 'local', presence: local }
  }
  if (input.runtimeActive && mqttRuntimeBindingMatches(binding, input.runtimeActive.binding)) {
    return { kind: 'runtime', active: input.runtimeActive }
  }
  return local.present ? { kind: 'binding_mismatch', presence: local } : { kind: 'missing' }
}
