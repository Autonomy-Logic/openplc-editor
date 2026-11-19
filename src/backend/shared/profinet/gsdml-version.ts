/** The newest GSDML schema version the parser supports. */
export const GSDML_SUPPORTED_SCHEMA_VERSION = 'V2.45'

/**
 * The SupportedRT_Classes tokens the parser knows for the supported schema version. In a newer file, every other token
 * is dropped with an `unknown-token` notice (Annex A.3.3).
 */
export const GSDML_RT_CLASS_TOKENS = [
  'RT_CLASS_UDP',
  'RT_CLASS_1',
  'RT_CLASS_2',
  'RT_CLASS_3',
  'RT_CLASS_STREAM_HI',
  'RT_CLASS_STREAM_LO',
] as const

/** A token of {@link GSDML_RT_CLASS_TOKENS}. */
export type GsdmlRtClassToken = (typeof GSDML_RT_CLASS_TOKENS)[number]

/**
 * The SupportedProtocols tokens the parser knows for the supported schema version. In a newer file, every other token
 * is dropped with an `unknown-token` notice (Annex A.3.3).
 */
export const GSDML_PROTOCOL_TOKENS = ['SNMP', 'LLDP'] as const

/** A token of {@link GSDML_PROTOCOL_TOKENS}. */
export type GsdmlProtocolToken = (typeof GSDML_PROTOCOL_TOKENS)[number]

const SCHEMA_FILE_VERSION_PATTERN = /GSDML-DeviceProfile-(v[0-9][0-9.]*[0-9]|v[0-9])\.xsd/i

/** A schema version with its leading `v` in upper case, so `v2.45` reads as `V2.45`. */
export function normaliseSchemaVersion(version: string): string {
  const text = version.trim()
  return text.startsWith('v') ? `V${text.slice(1)}` : text
}

/** Whether a version is newer than the supported one, compared textually as Annex A.3.3 defines. */
export function isNewerSchemaVersion(version: string): boolean {
  return normaliseSchemaVersion(version) > GSDML_SUPPORTED_SCHEMA_VERSION
}

/** The version named by the schema file of an `xsi:schemaLocation` value, such as `V2.45`; empty when it names none. */
export function schemaVersionFromLocation(schemaLocation: string): string {
  const match = SCHEMA_FILE_VERSION_PATTERN.exec(schemaLocation)
  return match === null ? '' : normaliseSchemaVersion(match[1])
}
