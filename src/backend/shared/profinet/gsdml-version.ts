/** The newest GSDML schema version the parser supports. */
export const GSDML_SUPPORTED_SCHEMA_VERSION = 'V2.45'

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
