// Fixtures in ./fixtures are byte-identical with the runtime's mqtt/contract/fixtures.

import type { TokenRole } from './names'

export const MQTT_RUNTIME_CONFIG_CONTRACT = 'openplc-mqtt-runtime-config'
export const MQTT_RUNTIME_CONFIG_FORMAT_VERSION = 1
export const MQTT_RUNTIME_CONFIG_FILE = 'conf/mqtt.json'
export const MQTT_PROJECT_FORMAT_VERSION = 1

export const MQTT_LIMITS = {
  maxLeaves: 1000,
  maxNameBytes: 512,
  maxPayloadBytes: 262144,
  maxConfigBytes: 4194304,
  maxConfigDepth: 32,
  maxCaPemChars: 65536,
  minIntervalMs: 100,
  maxIntervalMs: 60000,
  maxHostChars: 253,
  minSourceTokens: 2,
  maxSourceTokens: 64,
  maxTokenNameChars: 256,
  maxIndicesPerToken: 8,
} as const

export const MQTT_DEFAULTS = {
  enabled: false,
  tlsEnabled: true,
  tlsPort: 8883,
  plaintextPort: 1883,
  genericPublishMode: 'on_change',
  publishIntervalMs: 1000,
  sampleIntervalMs: 100,
  qos: 0,
  retain: false,
} as const

export const MQTT_CONNECTION_POLICY = {
  connectTimeoutMs: 10000,
  keepaliveS: 30,
  backoffBasesS: [1, 2, 4, 8, 16, 30],
  backoffJitter: 0.2,
  backoffResetAfterMs: 60000,
  shutdownBudgetMs: 5000,
  identicalErrorLogIntervalMs: 30000,
} as const

export const MQTT_CREDENTIAL_STAGING = {
  ttlSeconds: 600,
  maxStaged: 4,
} as const

export type MqttMode = 'generic' | 'sparkplug_b'
export type MqttAuthMethod = 'anonymous' | 'username_password' | 'client_certificate'
export type MqttSecretAuthMethod = Exclude<MqttAuthMethod, 'anonymous'>

export const MQTT_IEC_TYPES = [
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
  'STRING',
  'WSTRING',
  'TIME',
  'DATE',
  'TOD',
  'DT',
] as const

export type MqttIecType = (typeof MQTT_IEC_TYPES)[number]

/** Byte width reported by the compiler's debug map (and the runtime's debug_size) per type. */
export const MQTT_DEBUG_SIZE: Readonly<Record<MqttIecType, number>> = {
  BOOL: 1,
  SINT: 1,
  USINT: 1,
  BYTE: 1,
  INT: 2,
  UINT: 2,
  WORD: 2,
  DINT: 4,
  UDINT: 4,
  DWORD: 4,
  REAL: 4,
  LINT: 8,
  ULINT: 8,
  LWORD: 8,
  LREAL: 8,
  TIME: 8,
  DATE: 8,
  TOD: 8,
  DT: 8,
  STRING: 127,
  WSTRING: 253,
}

export const isMqttIecType = (value: string): value is MqttIecType =>
  (MQTT_IEC_TYPES as readonly string[]).includes(value)

/** Source identity token as serialized in conf/mqtt.json and in the project model. */
export type MqttSourceToken = { role: Exclude<TokenRole, 'index'>; name: string } | { role: 'index'; indices: number[] }

export interface MqttCredentialRef {
  id: string
  revision: number
  staging_id: string | null
}

export type MqttTlsTrust = { source: 'system' } | { source: 'pem'; ca_pem: string }

export type MqttRuntimeTls = { enabled: false } | { enabled: true; trust: MqttTlsTrust }

export type MqttRuntimeAuth =
  | { method: 'anonymous' }
  | { method: MqttSecretAuthMethod; credential_ref: MqttCredentialRef }

export type MqttGenericSection =
  | { publish_mode: 'on_change'; sample_interval_ms: number; qos: 0 | 1; retain: boolean }
  | { publish_mode: 'periodic'; publish_interval_ms: number; qos: 0 | 1; retain: boolean }

export interface MqttSparkplugSection {
  group_id: string
  edge_node_id: string
  sample_interval_ms: number
}

export interface MqttRuntimeLeaf {
  source: { tokens: MqttSourceToken[]; debug_path: string }
  address: { arr: number; elem: number }
  iec_type: MqttIecType
  size: number
  destination: string
}

interface MqttRuntimeConfigBase {
  contract: typeof MQTT_RUNTIME_CONFIG_CONTRACT
  format_version: typeof MQTT_RUNTIME_CONFIG_FORMAT_VERSION
  enabled: true
  program: { md5: string }
  connection: { host: string; port: number; client_id: string; tls: MqttRuntimeTls }
  auth: MqttRuntimeAuth
  leaves: MqttRuntimeLeaf[]
}

/** conf/mqtt.json, format_version 1. Absent file means MQTT disabled. */
export type MqttRuntimeConfigV1 =
  | (MqttRuntimeConfigBase & { mode: 'generic'; generic: MqttGenericSection })
  | (MqttRuntimeConfigBase & { mode: 'sparkplug_b'; sparkplug: MqttSparkplugSection })

/** Exportable project model. Never holds passwords, keys, usernames or runtime credential references. */
export interface MqttProjectSelectionV1 {
  source: { tokens: MqttSourceToken[] }
  /** Generic-mode topic; absent means the default derived from the prefix and source tokens. */
  topic?: string
  /** Sparkplug metric name; absent means the default derived from the source tokens. */
  metricName?: string
}

export interface MqttProjectIntegrationV1 {
  formatVersion: typeof MQTT_PROJECT_FORMAT_VERSION
  enabled: boolean
  mode: MqttMode
  connection: {
    host: string
    port: number
    clientId: string
    tls: { enabled: false } | { enabled: true; trust: { source: 'system' } | { source: 'pem'; caPem: string } }
  }
  authMethod: MqttAuthMethod
  generic: {
    publishMode: 'on_change' | 'periodic'
    sampleIntervalMs: number
    publishIntervalMs: number
    qos: 0 | 1
    retain: boolean
    topicPrefix?: string
  }
  sparkplug: { groupId: string; edgeNodeId: string; sampleIntervalMs: number }
  selections: MqttProjectSelectionV1[]
}

export const MQTT_CONFIG_ERROR_CODES = [
  'config_too_large',
  'config_too_deep',
  'config_duplicate_key',
  'config_unknown_contract',
  'config_unknown_version',
  'config_schema',
  'config_no_leaves',
  'config_too_many_leaves',
  'config_type_unsupported',
  'config_size_mismatch',
  'config_tls_required',
  'config_destination_invalid',
  'config_destination_conflict',
  'config_sparkplug_id_invalid',
  'config_program_mismatch',
  'config_address_invalid',
  'config_leaf_duplicate',
  'config_payload_too_large',
  'config_credential_missing',
  'config_credential_binding_mismatch',
  'config_multiple_enabled',
] as const

export type MqttConfigErrorCode = (typeof MQTT_CONFIG_ERROR_CODES)[number]
