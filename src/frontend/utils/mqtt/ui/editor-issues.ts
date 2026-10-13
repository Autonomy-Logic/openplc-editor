import type { MqttProjectIntegrationV1 } from '../contract/contract'
import type { MqttSelectionSummary } from '../project/selection-summary'
import {
  type MqttProjectIssue,
  type MqttServerLike,
  validateMqttCredentialPresence,
  validateMqttIntegration,
  validateMqttServers,
} from '../project/validate'
import type { MqttCredentialState } from './credential-state'
import { type MqttEditorSection, mqttIssueSection } from './presentation'

const credentialIssues = (integration: MqttProjectIntegrationV1, state: MqttCredentialState): MqttProjectIssue[] => {
  switch (state.kind) {
    case 'missing':
      return validateMqttCredentialPresence(integration, { present: false })
    case 'no_target':
      return [
        {
          code: 'config_credential_missing',
          pointer: '/authMethod',
          message: 'Select the target runtime in the device configuration, then enter the credential for it.',
        },
      ]
    case 'binding_mismatch':
      return [
        {
          code: 'config_credential_binding_mismatch',
          pointer: '/authMethod',
          message:
            'The saved credential was entered for a different broker, client ID or method. Enter it again for the current settings.',
        },
      ]
    default:
      return []
  }
}

/** Every issue the MQTT editor shows for one server, without duplicates. */
export const collectMqttEditorIssues = (input: {
  serverName: string
  integration: MqttProjectIntegrationV1
  servers: readonly MqttServerLike[] | undefined
  target: { mqttClient: boolean }
  summary: MqttSelectionSummary
  credential: MqttCredentialState
}): MqttProjectIssue[] => {
  const serverIssues = validateMqttServers(input.servers, input.target)
    .filter((issue) => issue.server === input.serverName)
    .map(({ server: _server, ...issue }) => issue)
  const all = [
    ...serverIssues,
    ...validateMqttIntegration(input.integration),
    ...input.summary.issues,
    ...credentialIssues(input.integration, input.credential),
  ]
  const seen = new Set<string>()
  return all.filter((issue) => {
    const key = `${issue.code}\u0000${issue.pointer}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const groupMqttIssues = (
  issues: readonly MqttProjectIssue[],
): Readonly<Record<MqttEditorSection, MqttProjectIssue[]>> => {
  const groups: Record<MqttEditorSection, MqttProjectIssue[]> = {
    general: [],
    connection: [],
    security: [],
    publication: [],
    variables: [],
  }
  for (const issue of issues) groups[mqttIssueSection(issue.pointer)].push(issue)
  return groups
}
