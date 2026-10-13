import type { MqttIecType, MqttMode, MqttSourceToken } from '../contract/contract'
import type { MqttMissingReason, MqttUnsupportedReason } from '../project/source-model'
import type { MqttErrorCategory, MqttRuntimeState } from '../runtime/status'

export const MQTT_RUNTIME_STATE_LABELS: Readonly<Record<MqttRuntimeState, string>> = {
  disabled: 'Disabled',
  plc_stopped: 'PLC stopped',
  connecting: 'Connecting',
  connected: 'Connected',
  retry_wait: 'Waiting to retry',
  config_error: 'Configuration error',
  credential_error: 'Credential error',
}

export const MQTT_ERROR_CATEGORY_LABELS: Readonly<Record<MqttErrorCategory, string>> = {
  configuration: 'Configuration',
  network: 'Network',
  authentication: 'Authentication',
  certificate: 'Certificate',
  read_conversion: 'Read/conversion',
  credential: 'Credential',
  limit: 'Limit',
  authorization: 'Authorization',
  internal: 'Internal',
}

const GENERIC_ENCODING: Readonly<Record<MqttIecType, string>> = {
  BOOL: 'JSON boolean',
  SINT: 'JSON integer',
  INT: 'JSON integer',
  DINT: 'JSON integer',
  USINT: 'JSON integer',
  UINT: 'JSON integer',
  UDINT: 'JSON integer',
  BYTE: 'JSON integer (bits)',
  WORD: 'JSON integer (bits)',
  DWORD: 'JSON integer (bits)',
  LINT: 'Decimal string',
  ULINT: 'Decimal string',
  LWORD: 'Decimal string (bits)',
  REAL: 'JSON number',
  LREAL: 'JSON number',
  STRING: 'JSON string',
  WSTRING: 'Base64 of UTF-16LE',
  TIME: 'Nanoseconds, decimal string',
  TOD: 'HH:mm:ss.fffffffff',
  DATE: 'YYYY-MM-DD (UTC)',
  DT: 'YYYY-MM-DDTHH:mm:ss.fffffffffZ',
}

const SPARKPLUG_ENCODING: Readonly<Record<MqttIecType, string>> = {
  BOOL: 'Boolean',
  SINT: 'Int8',
  INT: 'Int16',
  DINT: 'Int32',
  USINT: 'UInt8',
  UINT: 'UInt16',
  UDINT: 'UInt32',
  BYTE: 'UInt8',
  WORD: 'UInt16',
  DWORD: 'UInt32',
  LINT: 'Int64',
  ULINT: 'UInt64',
  LWORD: 'UInt64',
  REAL: 'Float',
  LREAL: 'Double',
  STRING: 'String',
  WSTRING: 'Bytes (UTF-16LE)',
  TIME: 'Int64 (ns duration)',
  TOD: 'Int64 (ns since midnight)',
  DATE: 'Int64 (ns since Unix epoch, UTC midnight)',
  DT: 'Int64 (ns since Unix epoch)',
}

/** How a leaf of this type is published in the given mode. */
export const mqttEncodingLabel = (iecType: MqttIecType, mode: MqttMode): string =>
  mode === 'generic' ? GENERIC_ENCODING[iecType] : SPARKPLUG_ENCODING[iecType]

const UNSUPPORTED_TEXT: Readonly<Record<MqttUnsupportedReason, string>> = {
  type_enumeration: 'Enumerations cannot be published.',
  type_unsupported: 'This type cannot be published.',
  type_unknown: 'The type is not declared in the project.',
  type_recursive: 'The type contains itself.',
  array_bounds_invalid: 'The array bounds are not valid.',
  array_rank_too_high: 'Arrays with more than 8 dimensions cannot be published.',
  path_too_deep: 'The variable path is too deep.',
}

export const mqttUnsupportedReasonText = (reason: MqttUnsupportedReason): string => UNSUPPORTED_TEXT[reason]

const MISSING_TEXT: Readonly<Record<MqttMissingReason | 'not_a_leaf', string>> = {
  token_shape: 'The reference is malformed.',
  identifier_invalid: 'The reference contains an invalid name.',
  instance_missing: 'The program instance no longer exists.',
  program_mismatch: 'The instance now runs a different program.',
  program_missing: 'The program no longer exists.',
  member_missing: 'The variable or field no longer exists.',
  not_an_array: 'The variable is no longer an array.',
  index_rank_mismatch: 'The array changed its number of dimensions.',
  index_out_of_range: 'The index is outside the array bounds.',
  not_a_composite: 'The variable no longer has fields.',
  not_a_leaf: 'The reference points to a structure, block or array, not a single value.',
}

const isMissingTextKey = (reason: string): reason is keyof typeof MISSING_TEXT =>
  Object.prototype.hasOwnProperty.call(MISSING_TEXT, reason)

/** Text for a selection that no longer resolves; unknown details fall back to a generic text. */
export const mqttMissingReasonText = (reason: string | undefined): string =>
  reason !== undefined && isMissingTextKey(reason) ? MISSING_TEXT[reason] : 'The reference does not match the program.'

/** Readable source path: names joined by dots, indices in brackets with their original values. */
export const mqttSourceDisplayPath = (tokens: readonly MqttSourceToken[]): string =>
  tokens.reduce(
    (path, token) =>
      token.role === 'index'
        ? `${path}[${token.indices.join(',')}]`
        : path === ''
          ? token.name
          : `${path}.${token.name}`,
    '',
  )

export type MqttEditorSection = 'general' | 'connection' | 'security' | 'publication' | 'variables'

/** Editor section that owns the field a JSON Pointer of the project model points to. */
export const mqttIssueSection = (pointer: string): MqttEditorSection => {
  if (pointer === '/authMethod' || pointer.startsWith('/connection/tls')) return 'security'
  if (pointer.startsWith('/connection')) return 'connection'
  if (pointer.startsWith('/generic') || pointer.startsWith('/sparkplug')) return 'publication'
  if (pointer.startsWith('/selections')) return 'variables'
  return 'general'
}

const SELECTION_POINTER = /^\/selections\/(\d+)(?:\/|$)/

/** Index of the selection a pointer refers to, or null for a pointer outside one selection. */
export const mqttIssueSelectionIndex = (pointer: string): number | null => {
  const match = SELECTION_POINTER.exec(pointer)
  return match ? Number(match[1]) : null
}
