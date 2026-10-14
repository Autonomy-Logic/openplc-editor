import type { MqttMode, MqttSecretAuthMethod } from '../contract/contract'

export const MQTT_STATUS_CONTRACT = 'openplc-mqtt-status'

export const MQTT_RUNTIME_STATES = [
  'disabled',
  'plc_stopped',
  'connecting',
  'connected',
  'retry_wait',
  'config_error',
  'credential_error',
] as const

export type MqttRuntimeState = (typeof MQTT_RUNTIME_STATES)[number]

export const MQTT_ERROR_CATEGORIES = [
  'configuration',
  'network',
  'authentication',
  'certificate',
  'read_conversion',
  'credential',
  'limit',
  'authorization',
  'internal',
] as const

export type MqttErrorCategory = (typeof MQTT_ERROR_CATEGORIES)[number]

export interface MqttRuntimeStatusError {
  category: MqttErrorCategory
  code: string
  message: string
  since: string
  count: number
}

/** Body of `GET /api/mqtt/status` (`$defs/status` of `mqtt-api.v1.schema.json`). */
export interface MqttRuntimeStatusV1 {
  contract: typeof MQTT_STATUS_CONTRACT
  version: 1
  configured: boolean
  mode?: MqttMode
  state: MqttRuntimeState
  since: string
  programMd5?: string
  broker?: { host: string; port: number; tls: boolean }
  error: MqttRuntimeStatusError | null
  reconnect?: { attempt: number; nextRetryInMs: number | null }
  stats?: {
    leaves: number
    lastSampleAt: string | null
    lastForwardedAt: string | null
    published: number
    dropped: number
    readErrors: number
  }
  sparkplug?: { bdSeq: number; seq: number; lastBirthAt: string | null }
}

export interface MqttRuntimeBinding {
  host: string
  port: number
  tls_enabled: boolean
  client_id: string
  method: MqttSecretAuthMethod
}

export interface MqttRuntimeCertificateInfo {
  sha256: string
  subject: string
  notAfter: string
}

export interface MqttRuntimeCredentialStatus {
  id: string
  revision: number
  method: MqttSecretAuthMethod
  binding: MqttRuntimeBinding
  usernameSet?: boolean
  clientCertificate?: MqttRuntimeCertificateInfo
  updatedAt: string
  updatedBy: string
}

export interface MqttRuntimeStagingStatus {
  stagingId: string
  credentialRef: { id: string; revision: number; staging_id: string }
  method: MqttSecretAuthMethod
  binding: MqttRuntimeBinding
  programMd5: string
  expiresAt: string
  createdBy: string
  clientCertificate?: MqttRuntimeCertificateInfo
}

/** Body of `GET /api/mqtt/credentials`: presence and non-secret metadata only. */
export interface MqttRuntimeCredentialsV1 {
  active: MqttRuntimeCredentialStatus | null
  staged: MqttRuntimeStagingStatus[]
}

type Json = { [key: string]: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/
const SHA256 = /^[0-9a-f]{64}$/
const MD5 = /^[0-9a-f]{32}$/
const CODE = /^[a-z][a-z0-9_]{2,63}$/
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const METHODS: readonly string[] = ['username_password', 'client_certificate']
const MODES: readonly string[] = ['generic', 'sparkplug_b']
const MAX_STAGED = 4
const MAX_STATUS_LEAVES = 1000

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Required members present and nothing outside `required` + `optional`. */
const hasShape = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Json => {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  return required.every((k) => k in value) && keys.every((k) => required.includes(k) || optional.includes(k))
}

const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

const matches = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value)

const isText = (value: unknown, maxLength: number, minLength = 0): value is string =>
  typeof value === 'string' && value.length >= minLength && value.length <= maxLength

const isTimestampOrNull = (value: unknown): boolean => value === null || matches(value, TIMESTAMP)

const isOneOf = (value: unknown, allowed: readonly string[]): value is string =>
  typeof value === 'string' && allowed.includes(value)

const isStatusError = (value: unknown): boolean =>
  hasShape(value, ['category', 'code', 'message', 'since', 'count']) &&
  isOneOf(value.category, MQTT_ERROR_CATEGORIES) &&
  matches(value.code, CODE) &&
  isText(value.message, 512) &&
  matches(value.since, TIMESTAMP) &&
  isInt(value.count, 1)

const isBroker = (value: unknown): boolean =>
  hasShape(value, ['host', 'port', 'tls']) &&
  typeof value.host === 'string' &&
  isInt(value.port, Number.MIN_SAFE_INTEGER) &&
  typeof value.tls === 'boolean'

const isReconnect = (value: unknown): boolean =>
  hasShape(value, ['attempt', 'nextRetryInMs']) &&
  isInt(value.attempt, 0) &&
  (value.nextRetryInMs === null || isInt(value.nextRetryInMs, 0))

const isStats = (value: unknown): boolean =>
  hasShape(value, ['leaves', 'lastSampleAt', 'lastForwardedAt', 'published', 'dropped', 'readErrors']) &&
  isInt(value.leaves, 0, MAX_STATUS_LEAVES) &&
  isTimestampOrNull(value.lastSampleAt) &&
  isTimestampOrNull(value.lastForwardedAt) &&
  isInt(value.published, 0) &&
  isInt(value.dropped, 0) &&
  isInt(value.readErrors, 0)

const isSparkplugStatus = (value: unknown): boolean =>
  hasShape(value, ['bdSeq', 'seq', 'lastBirthAt']) &&
  isInt(value.bdSeq, 0, 255) &&
  isInt(value.seq, 0, 255) &&
  isTimestampOrNull(value.lastBirthAt)

const optional = (value: Json, key: string, check: (v: unknown) => boolean): boolean =>
  !(key in value) || check(value[key])

const isRuntimeStatus = (value: unknown): value is MqttRuntimeStatusV1 =>
  hasShape(
    value,
    ['contract', 'version', 'configured', 'state', 'since', 'error'],
    ['mode', 'programMd5', 'broker', 'reconnect', 'stats', 'sparkplug'],
  ) &&
  value.contract === MQTT_STATUS_CONTRACT &&
  value.version === 1 &&
  typeof value.configured === 'boolean' &&
  isOneOf(value.state, MQTT_RUNTIME_STATES) &&
  matches(value.since, TIMESTAMP) &&
  (value.error === null || isStatusError(value.error)) &&
  optional(value, 'mode', (v) => isOneOf(v, MODES)) &&
  optional(value, 'programMd5', (v) => matches(v, MD5)) &&
  optional(value, 'broker', isBroker) &&
  optional(value, 'reconnect', isReconnect) &&
  optional(value, 'stats', isStats) &&
  optional(value, 'sparkplug', isSparkplugStatus)

/** Strict check of a status body; anything outside the contract is rejected rather than half shown. */
export const parseMqttRuntimeStatus = (value: unknown): MqttRuntimeStatusV1 | null =>
  isRuntimeStatus(value) ? value : null

const isBinding = (value: unknown): boolean =>
  hasShape(value, ['host', 'port', 'tls_enabled', 'client_id', 'method']) &&
  isText(value.host, 253, 1) &&
  isInt(value.port, 1, 65535) &&
  typeof value.tls_enabled === 'boolean' &&
  matches(value.client_id, CLIENT_ID) &&
  isOneOf(value.method, METHODS)

const isCertificateInfo = (value: unknown): boolean =>
  hasShape(value, ['sha256', 'subject', 'notAfter']) &&
  matches(value.sha256, SHA256) &&
  isText(value.subject, 512) &&
  matches(value.notAfter, TIMESTAMP)

const isCredentialStatus = (value: unknown): boolean =>
  hasShape(
    value,
    ['id', 'revision', 'method', 'binding', 'updatedAt', 'updatedBy'],
    ['usernameSet', 'clientCertificate'],
  ) &&
  matches(value.id, UUID) &&
  isInt(value.revision, 1) &&
  isOneOf(value.method, METHODS) &&
  isBinding(value.binding) &&
  optional(value, 'usernameSet', (v) => typeof v === 'boolean') &&
  optional(value, 'clientCertificate', isCertificateInfo) &&
  matches(value.updatedAt, TIMESTAMP) &&
  isText(value.updatedBy, 128)

const isStagingRef = (value: unknown): boolean =>
  hasShape(value, ['id', 'revision', 'staging_id']) &&
  matches(value.id, UUID) &&
  isInt(value.revision, 1) &&
  matches(value.staging_id, UUID)

const isStagingStatus = (value: unknown): value is MqttRuntimeStagingStatus =>
  hasShape(
    value,
    ['stagingId', 'credentialRef', 'method', 'binding', 'programMd5', 'expiresAt', 'createdBy'],
    ['clientCertificate'],
  ) &&
  matches(value.stagingId, UUID) &&
  isStagingRef(value.credentialRef) &&
  isOneOf(value.method, METHODS) &&
  isBinding(value.binding) &&
  matches(value.programMd5, MD5) &&
  matches(value.expiresAt, TIMESTAMP) &&
  isText(value.createdBy, 128) &&
  optional(value, 'clientCertificate', isCertificateInfo)

const isRuntimeCredentials = (value: unknown): value is MqttRuntimeCredentialsV1 =>
  hasShape(value, ['active', 'staged']) &&
  (value.active === null || isCredentialStatus(value.active)) &&
  Array.isArray(value.staged) &&
  value.staged.length <= MAX_STAGED &&
  value.staged.every(isStagingStatus)

/** Strict check of a credentials body; a member that could carry secret material makes it invalid. */
export const parseMqttRuntimeCredentials = (value: unknown): MqttRuntimeCredentialsV1 | null =>
  isRuntimeCredentials(value) ? value : null

/** Strict check of the `201` body of `POST /api/mqtt/credentials/staging` (`stagingStatus`). */
export const parseMqttStagingReceipt = (value: unknown): MqttRuntimeStagingStatus | null =>
  isStagingStatus(value) ? value : null

export interface MqttRuntimeApiError {
  code: string
  category: MqttErrorCategory
  message: string
  pointer?: string
}

const isErrorCategory = (value: unknown): value is MqttErrorCategory =>
  MQTT_ERROR_CATEGORIES.some((category) => category === value)

/** Strict check of an MQTT API error body (`{error: {code, category, message, pointer?}}`). */
export const parseMqttApiError = (value: unknown): MqttRuntimeApiError | null => {
  if (!hasShape(value, ['error'])) return null
  const error = value.error
  if (
    !hasShape(error, ['code', 'category', 'message'], ['pointer']) ||
    !matches(error.code, CODE) ||
    !isErrorCategory(error.category) ||
    !isText(error.message, 512) ||
    !optional(error, 'pointer', (v) => isText(v, 1024))
  ) {
    return null
  }
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(typeof error.pointer === 'string' ? { pointer: error.pointer } : {}),
  }
}

export interface MqttRuntimeCapabilities {
  formatVersions: number[]
  modes: MqttMode[]
  methods: MqttSecretAuthMethod[]
}

/** What `GET /api/mqtt/capabilities` declares; null when the body is not that contract. */
export const parseMqttCapabilities = (value: unknown): MqttRuntimeCapabilities | null => {
  if (!isObject(value) || value.contract !== 'openplc-mqtt-capabilities' || value.version !== 1) return null
  const { runtimeConfig, credentials, modes } = value
  if (!isObject(runtimeConfig) || runtimeConfig.contract !== 'openplc-mqtt-runtime-config') return null
  if (!isObject(credentials) || !Array.isArray(credentials.methods) || !Array.isArray(modes)) return null
  const formatVersions = runtimeConfig.formatVersions
  if (!Array.isArray(formatVersions) || !formatVersions.every((v) => isInt(v, 1))) return null
  return {
    formatVersions: formatVersions.filter((v): v is number => typeof v === 'number'),
    modes: modes.filter((m): m is MqttMode => isOneOf(m, MODES)),
    methods: credentials.methods.filter((m): m is MqttSecretAuthMethod => isOneOf(m, METHODS)),
  }
}
