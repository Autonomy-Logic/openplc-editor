import {
  MQTT_LIMITS,
  type MqttConfigErrorCode,
  type MqttProjectIntegrationV1,
  type MqttProjectSelectionV1,
  type MqttSourceToken,
} from '../contract/contract'
import {
  defaultMetricName,
  defaultTopic,
  defaultTopicPrefix,
  findDestinationConflicts,
  validateClientId,
  validateMetricName,
  validateNodeId,
  validateTopic,
} from '../contract/names'
import { isMqttSecretAuthMethod } from './model'

export type MqttProjectIssueCode =
  | Extract<
      MqttConfigErrorCode,
      | 'config_tls_required'
      | 'config_destination_invalid'
      | 'config_destination_conflict'
      | 'config_sparkplug_id_invalid'
      | 'config_no_leaves'
      | 'config_too_many_leaves'
      | 'config_multiple_enabled'
      | 'config_credential_missing'
      | 'config_credential_binding_mismatch'
      | 'config_type_unsupported'
      | 'config_size_mismatch'
      | 'config_leaf_duplicate'
      | 'config_payload_too_large'
      | 'config_too_large'
    >
  | 'project_host_invalid'
  | 'project_port_invalid'
  | 'project_client_id_invalid'
  | 'project_ca_pem_invalid'
  | 'project_interval_invalid'
  | 'project_topic_prefix_invalid'
  | 'project_selection_invalid'
  | 'project_selection_duplicate'
  | 'project_target_unsupported'
  | 'project_selection_unresolved'
  | 'project_program_invalid'

export interface MqttProjectIssue {
  code: MqttProjectIssueCode
  /** JSON Pointer into the integration (camelCase project model). */
  pointer: string
  message: string
  /** Name-rule code from `names.ts` when the issue comes from a naming rule. */
  detail?: string
}

/** Minimal server shape, so this module does not depend on the project store types. */
export interface MqttServerLike {
  name: string
  protocol: string
  mqttConfig?: MqttProjectIntegrationV1
}

export interface MqttServerIssue extends MqttProjectIssue {
  server: string
}

const HOST_PATTERN =
  /^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|[0-9]{1,3}(\.[0-9]{1,3}){3}|\[[0-9A-Fa-f:.]+\])$/
const PEM_HEADER = '-----BEGIN CERTIFICATE-----'
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

export const isValidMqttHost = (host: string): boolean =>
  host.length >= 1 && host.length <= MQTT_LIMITS.maxHostChars && HOST_PATTERN.test(host)

const isValidInterval = (value: number): boolean =>
  Number.isInteger(value) && value >= MQTT_LIMITS.minIntervalMs && value <= MQTT_LIMITS.maxIntervalMs

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

const isValidToken = (token: MqttSourceToken): boolean => {
  if (token.role !== 'index') {
    return (
      token.name.length >= 1 && token.name.length <= MQTT_LIMITS.maxTokenNameChars && !LONE_SURROGATE.test(token.name)
    )
  }
  return (
    token.indices.length >= 1 &&
    token.indices.length <= MQTT_LIMITS.maxIndicesPerToken &&
    token.indices.every((i) => Number.isInteger(i) && i >= INT32_MIN && i <= INT32_MAX)
  )
}

/** True when the tokens can identify a leaf; resolution against a compiled program happens later. */
export const isValidMqttSource = (tokens: readonly MqttSourceToken[]): boolean =>
  tokens.length >= MQTT_LIMITS.minSourceTokens &&
  tokens.length <= MQTT_LIMITS.maxSourceTokens &&
  tokens[0].role !== 'index' &&
  tokens.every(isValidToken)

export const mqttTopicPrefix = (integration: MqttProjectIntegrationV1): string =>
  integration.generic.topicPrefix ?? defaultTopicPrefix(integration.connection.clientId)

/** Destination the selection publishes to in the integration's current mode; null when it cannot be derived. */
export const mqttSelectionDestination = (
  integration: MqttProjectIntegrationV1,
  selection: MqttProjectSelectionV1,
): string | null => {
  const explicit = integration.mode === 'generic' ? selection.topic : selection.metricName
  if (explicit !== undefined) return explicit
  if (!isValidMqttSource(selection.source.tokens)) return null
  return integration.mode === 'generic'
    ? defaultTopic(mqttTopicPrefix(integration), selection.source.tokens)
    : defaultMetricName(selection.source.tokens)
}

const sourceKey = (tokens: readonly MqttSourceToken[]): string =>
  JSON.stringify(tokens.map((t) => (t.role === 'index' ? ['index', t.indices] : [t.role, t.name])))

const validateConnection = (integration: MqttProjectIntegrationV1, issues: MqttProjectIssue[]): void => {
  const { connection } = integration
  if (!isValidMqttHost(connection.host)) {
    issues.push({ code: 'project_host_invalid', pointer: '/connection/host', message: 'Broker host is not valid.' })
  }
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    issues.push({
      code: 'project_port_invalid',
      pointer: '/connection/port',
      message: 'Broker port must be between 1 and 65535.',
    })
  }
  if (validateClientId(connection.clientId) !== null) {
    issues.push({
      code: 'project_client_id_invalid',
      pointer: '/connection/clientId',
      message: 'Client ID must start with a letter or digit and use up to 64 letters, digits, ".", "_" or "-".',
    })
  }
  const { tls } = connection
  if (tls.enabled && tls.trust.source === 'pem') {
    const { caPem } = tls.trust
    if (caPem.length > MQTT_LIMITS.maxCaPemChars || !caPem.startsWith(PEM_HEADER)) {
      issues.push({
        code: 'project_ca_pem_invalid',
        pointer: '/connection/tls/trust/caPem',
        message: 'The trusted CA must be a PEM certificate of at most 65536 characters.',
      })
    }
  }
  if (integration.authMethod === 'client_certificate' && !tls.enabled) {
    issues.push({
      code: 'config_tls_required',
      pointer: '/connection/tls/enabled',
      message: 'Client certificate authentication requires TLS.',
    })
  }
}

const intervalIssue = (pointer: string): MqttProjectIssue => ({
  code: 'project_interval_invalid',
  pointer,
  message: `Interval must be an integer between ${MQTT_LIMITS.minIntervalMs} and ${MQTT_LIMITS.maxIntervalMs} ms.`,
})

const validateModeSettings = (integration: MqttProjectIntegrationV1, issues: MqttProjectIssue[]): void => {
  if (integration.mode === 'generic') {
    const { generic } = integration
    const intervalField = generic.publishMode === 'on_change' ? 'sampleIntervalMs' : 'publishIntervalMs'
    if (!isValidInterval(generic[intervalField])) issues.push(intervalIssue(`/generic/${intervalField}`))
    if (generic.topicPrefix !== undefined) {
      const rule = validateTopic(generic.topicPrefix)
      if (rule !== null) {
        issues.push({
          code: 'project_topic_prefix_invalid',
          pointer: '/generic/topicPrefix',
          message: 'Topic prefix is not a valid MQTT topic.',
          detail: rule,
        })
      }
    }
    return
  }
  const { sparkplug } = integration
  if (!isValidInterval(sparkplug.sampleIntervalMs)) issues.push(intervalIssue('/sparkplug/sampleIntervalMs'))
  for (const key of ['groupId', 'edgeNodeId'] as const) {
    const rule = validateNodeId(sparkplug[key])
    if (rule !== null) {
      issues.push({
        code: 'config_sparkplug_id_invalid',
        pointer: `/sparkplug/${key}`,
        message: `Sparkplug ${key === 'groupId' ? 'Group ID' : 'Edge Node ID'} is not valid.`,
        detail: rule,
      })
    }
  }
}

const validateSelections = (integration: MqttProjectIntegrationV1, issues: MqttProjectIssue[]): void => {
  const { selections } = integration
  if (integration.enabled && selections.length === 0) {
    issues.push({ code: 'config_no_leaves', pointer: '/selections', message: 'Select at least one variable.' })
  }
  if (selections.length > MQTT_LIMITS.maxLeaves) {
    issues.push({
      code: 'config_too_many_leaves',
      pointer: '/selections',
      message: `At most ${MQTT_LIMITS.maxLeaves} leaves can be selected.`,
    })
  }

  const destinationField = integration.mode === 'generic' ? 'topic' : 'metricName'
  const prefix = integration.generic.topicPrefix
  // A bad prefix is reported once on its own field, not again on every topic derived from it.
  const derivedFromBadPrefix = integration.mode === 'generic' && prefix !== undefined && validateTopic(prefix) !== null
  const seenSources = new Map<string, number>()
  const derived: Array<{ index: number; destination: string }> = []
  selections.forEach((selection, index) => {
    const pointer = `/selections/${index}`
    if (!isValidMqttSource(selection.source.tokens)) {
      issues.push({
        code: 'project_selection_invalid',
        pointer: `${pointer}/source/tokens`,
        message: 'Selection does not identify a variable leaf.',
      })
    } else {
      const key = sourceKey(selection.source.tokens)
      if (seenSources.has(key)) {
        issues.push({
          code: 'project_selection_duplicate',
          pointer: `${pointer}/source/tokens`,
          message: 'The same leaf is selected more than once.',
        })
      } else {
        seenSources.set(key, index)
      }
    }
    if (derivedFromBadPrefix && selection.topic === undefined) return
    const destination = mqttSelectionDestination(integration, selection)
    if (destination === null) return
    const rule = integration.mode === 'generic' ? validateTopic(destination) : validateMetricName(destination)
    if (rule !== null) {
      issues.push({
        code: 'config_destination_invalid',
        pointer: `${pointer}/${destinationField}`,
        message: integration.mode === 'generic' ? 'Topic is not valid.' : 'Metric name is not valid.',
        detail: rule,
      })
      return
    }
    derived.push({ index, destination })
  })

  const conflicts = findDestinationConflicts(
    integration.mode,
    derived.map((d) => d.destination),
  )
  for (const conflict of conflicts) {
    const second = derived[conflict.second].index
    issues.push({
      code: 'config_destination_conflict',
      pointer: `/selections/${second}/${destinationField}`,
      message: `Destination collides with selection ${derived[conflict.first].index + 1}.`,
      detail: conflict.code,
    })
  }
}

/** Producer-side checks of one integration; the runtime remains the final authority. */
export const validateMqttIntegration = (integration: MqttProjectIntegrationV1): MqttProjectIssue[] => {
  const issues: MqttProjectIssue[] = []
  validateConnection(integration, issues)
  validateModeSettings(integration, issues)
  validateSelections(integration, issues)
  return issues
}

/** Checks across the project's MQTT servers against what the selected target can run. */
export const validateMqttServers = (
  servers: readonly MqttServerLike[] | undefined,
  target: { mqttClient: boolean },
): MqttServerIssue[] => {
  const issues: MqttServerIssue[] = []
  const enabled = (servers ?? []).filter((s) => s.protocol === 'mqtt' && s.mqttConfig?.enabled === true)
  enabled.slice(1).forEach((server) => {
    issues.push({
      server: server.name,
      code: 'config_multiple_enabled',
      pointer: '/enabled',
      message: `Only one MQTT integration can be enabled per runtime; "${enabled[0].name}" is already enabled.`,
    })
  })
  if (!target.mqttClient) {
    for (const server of enabled) {
      issues.push({
        server: server.name,
        code: 'project_target_unsupported',
        pointer: '/enabled',
        message: 'The selected target cannot run the MQTT client. Choose an OpenPLC Runtime v4 target or disable it.',
      })
    }
  }
  return issues
}

/** Flags an integration whose authentication needs a secret the destination does not hold. */
export const validateMqttCredentialPresence = (
  integration: MqttProjectIntegrationV1,
  credential: { present: boolean },
): MqttProjectIssue[] =>
  isMqttSecretAuthMethod(integration.authMethod) && !credential.present
    ? [
        {
          code: 'config_credential_missing',
          pointer: '/authMethod',
          message:
            integration.authMethod === 'username_password'
              ? 'Enter the broker username and password for this target.'
              : 'Provide the client certificate and private key for this target.',
        },
      ]
    : []
