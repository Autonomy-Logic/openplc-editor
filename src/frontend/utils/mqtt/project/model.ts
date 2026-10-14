import {
  MQTT_DEFAULTS,
  MQTT_PROJECT_FORMAT_VERSION,
  type MqttAuthMethod,
  type MqttProjectIntegrationV1,
  type MqttProjectSelectionV1,
  type MqttSecretAuthMethod,
  type MqttSourceToken,
} from '../contract/contract'

export const MQTT_DEFAULT_CLIENT_ID = 'openplc'
export const MQTT_DEFAULT_GROUP_ID = 'openplc'

type MqttProjectTls = MqttProjectIntegrationV1['connection']['tls']

const CLIENT_ID_UNSAFE = /[^A-Za-z0-9_.-]+/g
const CLIENT_ID_LEADING = /^[^A-Za-z0-9]+/

/** Client ID derived from a server name, always matching the runtime client ID pattern. */
export const suggestMqttClientId = (name: string): string => {
  const candidate = name.replace(CLIENT_ID_UNSAFE, '-').replace(CLIENT_ID_LEADING, '').slice(0, 64)
  return candidate === '' ? MQTT_DEFAULT_CLIENT_ID : candidate
}

export const createDefaultMqttIntegration = (clientId: string = MQTT_DEFAULT_CLIENT_ID): MqttProjectIntegrationV1 => ({
  formatVersion: MQTT_PROJECT_FORMAT_VERSION,
  enabled: MQTT_DEFAULTS.enabled,
  mode: 'generic',
  connection: {
    host: '',
    port: MQTT_DEFAULTS.tlsPort,
    clientId,
    tls: { enabled: true, trust: { source: 'system' } },
  },
  authMethod: 'anonymous',
  generic: {
    publishMode: MQTT_DEFAULTS.genericPublishMode,
    sampleIntervalMs: MQTT_DEFAULTS.sampleIntervalMs,
    publishIntervalMs: MQTT_DEFAULTS.publishIntervalMs,
    qos: MQTT_DEFAULTS.qos,
    retain: MQTT_DEFAULTS.retain,
  },
  sparkplug: {
    groupId: MQTT_DEFAULT_GROUP_ID,
    edgeNodeId: clientId,
    sampleIntervalMs: MQTT_DEFAULTS.sampleIntervalMs,
  },
  selections: [],
})

/** Toggles TLS, moving the port between the two defaults only when it still holds the other default. */
export const withMqttTlsEnabled = (
  integration: MqttProjectIntegrationV1,
  enabled: boolean,
): MqttProjectIntegrationV1 => {
  const { port } = integration.connection
  const fromDefault = enabled ? MQTT_DEFAULTS.plaintextPort : MQTT_DEFAULTS.tlsPort
  const toDefault = enabled ? MQTT_DEFAULTS.tlsPort : MQTT_DEFAULTS.plaintextPort
  const tls: MqttProjectTls = enabled ? { enabled: true, trust: { source: 'system' } } : { enabled: false }
  const keepTls = integration.connection.tls.enabled === enabled
  return {
    ...integration,
    connection: {
      ...integration.connection,
      port: port === fromDefault ? toDefault : port,
      tls: keepTls ? integration.connection.tls : tls,
    },
  }
}

export const isMqttSecretAuthMethod = (method: MqttAuthMethod): method is MqttSecretAuthMethod => method !== 'anonymous'

export type MqttCredentialRequirement = { required: false } | { required: true; method: MqttSecretAuthMethod }

/** What the project needs from a credential store; the project itself never carries the secret. */
export const mqttCredentialRequirement = (integration: MqttProjectIntegrationV1): MqttCredentialRequirement =>
  isMqttSecretAuthMethod(integration.authMethod)
    ? { required: true, method: integration.authMethod }
    : { required: false }

const copyToken = (token: MqttSourceToken): MqttSourceToken =>
  token.role === 'index' ? { role: 'index', indices: [...token.indices] } : { role: token.role, name: token.name }

const copySelection = (selection: MqttProjectSelectionV1): MqttProjectSelectionV1 => ({
  source: { tokens: selection.source.tokens.map(copyToken) },
  ...(selection.topic !== undefined ? { topic: selection.topic } : {}),
  ...(selection.metricName !== undefined ? { metricName: selection.metricName } : {}),
})

const copyTls = (tls: MqttProjectTls): MqttProjectTls => {
  if (!tls.enabled) return { enabled: false }
  return tls.trust.source === 'pem'
    ? { enabled: true, trust: { source: 'pem', caPem: tls.trust.caPem } }
    : { enabled: true, trust: { source: 'system' } }
}

/** Rebuilds the integration from its known fields only, so nothing outside the model reaches a project file. */
export const toPersistedMqttIntegration = (integration: MqttProjectIntegrationV1): MqttProjectIntegrationV1 => {
  const { connection, generic, sparkplug } = integration
  return {
    formatVersion: MQTT_PROJECT_FORMAT_VERSION,
    enabled: integration.enabled,
    mode: integration.mode,
    connection: {
      host: connection.host,
      port: connection.port,
      clientId: connection.clientId,
      tls: copyTls(connection.tls),
    },
    authMethod: integration.authMethod,
    generic: {
      publishMode: generic.publishMode,
      sampleIntervalMs: generic.sampleIntervalMs,
      publishIntervalMs: generic.publishIntervalMs,
      qos: generic.qos,
      retain: generic.retain,
      ...(generic.topicPrefix !== undefined ? { topicPrefix: generic.topicPrefix } : {}),
    },
    sparkplug: {
      groupId: sparkplug.groupId,
      edgeNodeId: sparkplug.edgeNodeId,
      sampleIntervalMs: sparkplug.sampleIntervalMs,
    },
    selections: integration.selections.map(copySelection),
  }
}

/** Server object as written to `devices/servers/<name>.json`; only the MQTT member is rebuilt. */
export const toPersistedServer = <T extends { protocol: string; mqttConfig?: MqttProjectIntegrationV1 }>(
  server: T,
): T =>
  server.mqttConfig === undefined ? server : { ...server, mqttConfig: toPersistedMqttIntegration(server.mqttConfig) }
