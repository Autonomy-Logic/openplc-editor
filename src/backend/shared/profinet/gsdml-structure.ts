import type { GsdmlSlotSet } from '@root/middleware/shared/ports/gsdml-types'

import {
  attributeValue,
  type GsdmlXmlElement,
  parseIdentValue,
  parseOctetsValue,
  parseSlotSetValue,
  parseUnsignedValue,
} from './gsdml-xml'

/** A structural failure that rejects the whole file; its message is the rejection reason. */
export class GsdmlStructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GsdmlStructureError'
  }
}

const DOCTYPE_PATTERN = /<!doctype/i
const MAX_QUOTED_VALUE_LENGTH = 64

/** Whether the text holds a DOCTYPE declaration, in any letter case. */
export function containsDoctype(text: string): boolean {
  return DOCTYPE_PATTERN.test(text)
}

/** The element name followed by its ID attribute when it has one, as in `ModuleItem ID="DI 8"`. */
function describeElement(element: GsdmlXmlElement, elementName: string): string {
  const id = attributeValue(element, 'ID')
  return id === undefined ? elementName : `${elementName} ID="${id}"`
}

/** A value shortened for an error message. */
function quoted(value: string): string {
  const text = value.length > MAX_QUOTED_VALUE_LENGTH ? `${value.slice(0, MAX_QUOTED_VALUE_LENGTH)}...` : value
  return JSON.stringify(text)
}

/**
 * Reads an attribute the catalog needs.
 *
 * @throws {GsdmlStructureError} When the attribute is missing, naming the element, its ID and the attribute.
 */
export function requireAttribute(element: GsdmlXmlElement, elementName: string, attribute: string): string {
  const value = attributeValue(element, attribute)
  if (value === undefined) {
    throw new GsdmlStructureError(
      `GSDML ${describeElement(element, elementName)} is missing the required attribute ${attribute}.`,
    )
  }
  return value
}

/** Reads a required attribute and converts it; throws a structure error naming the expected type when it does not convert. */
function requireConverted<T>(
  element: GsdmlXmlElement,
  elementName: string,
  attribute: string,
  expected: string,
  convert: (raw: string) => T | null,
): T {
  const raw = requireAttribute(element, elementName, attribute)
  const value = convert(raw)
  if (value === null) {
    throw new GsdmlStructureError(
      `GSDML ${describeElement(element, elementName)} has an invalid ${attribute} value ${quoted(raw)}: expected ${expected}.`,
    )
  }
  return value
}

/**
 * Reads a required unsigned integer attribute, decimal or `0x` hexadecimal.
 *
 * @throws {GsdmlStructureError} When it is missing or not an unsigned integer.
 */
export function requireUnsigned(element: GsdmlXmlElement, elementName: string, attribute: string): number {
  return requireConverted(element, elementName, attribute, 'an unsigned integer', parseUnsignedValue)
}

/** The hex digit count of an Unsigned16 ident number. */
export const UNSIGNED16_HEX_DIGITS = 4

/** The hex digit count of an Unsigned32 ident number. */
export const UNSIGNED32_HEX_DIGITS = 8

/**
 * Reads a required `0x` hexadecimal ident number and normalises it.
 *
 * @param maxDigits - {@link UNSIGNED16_HEX_DIGITS} for an Unsigned16 ident, {@link UNSIGNED32_HEX_DIGITS} for an
 *   Unsigned32 ident.
 * @throws {GsdmlStructureError} When it is missing or not a hexadecimal number of that size.
 */
export function requireIdent(
  element: GsdmlXmlElement,
  elementName: string,
  attribute: string,
  maxDigits: number,
): string {
  return requireConverted(
    element,
    elementName,
    attribute,
    `a 0x hexadecimal number of at most ${maxDigits} digits`,
    (raw) => parseIdentValue(raw, maxDigits),
  )
}

/**
 * Reads a required slot or subslot set.
 *
 * @throws {GsdmlStructureError} When it is missing or not a list of numbers and ranges.
 */
export function requireSlotSet(element: GsdmlXmlElement, elementName: string, attribute: string): GsdmlSlotSet {
  return requireConverted(
    element,
    elementName,
    attribute,
    'a list of numbers and ranges such as "1..4 8"',
    parseSlotSetValue,
  )
}

/**
 * Reads a required octet list such as `0x00,0x01`.
 *
 * @throws {GsdmlStructureError} When it is missing or not a comma-separated list of 0x octets.
 */
export function requireOctets(element: GsdmlXmlElement, elementName: string, attribute: string): number[] {
  return requireConverted(element, elementName, attribute, 'a comma-separated list of 0x octets', parseOctetsValue)
}

/** Reads an optional unsigned integer attribute; the fallback when it is absent or not an unsigned integer. */
export function optionalUnsigned<T extends number | null>(
  element: GsdmlXmlElement,
  attribute: string,
  fallback: T,
): number | T {
  const raw = attributeValue(element, attribute)
  if (raw === undefined) return fallback
  return parseUnsignedValue(raw) ?? fallback
}

/** Reads an optional slot or subslot set; empty when it is absent or not a set. */
export function optionalSlotSet(element: GsdmlXmlElement, attribute: string): GsdmlSlotSet {
  const raw = attributeValue(element, attribute)
  if (raw === undefined) return []
  return parseSlotSetValue(raw) ?? []
}
