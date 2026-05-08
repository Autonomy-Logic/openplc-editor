import { lookupBaseType } from '../../iec-types-registry'

/**
 * Pick the PLCopen TC6 0201 XML element tag for a base type value.
 *
 * For PLCopen TC6 elementaryTypes (closed `<choice>` in the XSD), use
 * the canonical XML element name from strucpp's iec-types registry —
 * mixed-case on purpose: `<string>` / `<wstring>` are lowercase,
 * everything else uppercase. xml2st (MatIEC's TC6 schema validator)
 * rejects `<STRING>` outright with the same "expected one of (BOOL,
 * BYTE, ...)" error users see when a case is wrong.
 *
 * For non-PLCopen-standard types (custom user types, OpenPLC
 * extensions), callers should emit `<derived name="X"/>` instead —
 * see {@link isPlcopenStandardType}.
 */
export const baseTypeTag = (value: string): string => {
  const meta = lookupBaseType(value)
  if (meta && meta.xml.plcopenStandard) {
    return meta.xml.elementName
  }
  // Unrecognised name or an extension type — preserve the original
  // spelling but upper-cased. Emitters that need `<derived/>` should
  // branch on `isPlcopenStandardType` before reaching this helper.
  return value.trim().toUpperCase()
}

/**
 * Whether a type name should be emitted as a PLCopen TC6 standard
 * element (`<BOOL/>`, `<string length=…/>`, …) rather than a
 * `<derived name="X"/>` reference.
 */
export const isPlcopenStandardType = (value: string): boolean => {
  return lookupBaseType(value)?.xml.plcopenStandard ?? false
}
