import { errorMessage } from '@root/backend/shared/device-description/error-message'
import type { ProcessEntitiesOptions } from 'fast-xml-parser'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

/** An element of the parsed document: `@_`-prefixed attributes and child element arrays, read by name. */
export type GsdmlXmlElement = { readonly [key: string]: unknown }

/** The result of reading GSDML text: the top-level elements, or the reason the text is not well-formed XML. */
export type GsdmlXmlReadResult = { ok: true; document: GsdmlXmlElement } | { ok: false; reason: string }

/** Every entity limit of the pinned XML library, set explicitly. */
export const GSDML_XML_ENTITY_LIMITS = {
  maxEntitySize: 1_000,
  maxExpansionDepth: 10,
  maxTotalExpansions: 1_000_000,
  maxExpandedLength: 100_000,
  maxEntityCount: 100,
} as const satisfies ProcessEntitiesOptions

/** The deepest element nesting the XML library accepts. */
const GSDML_XML_MAX_NESTED_TAGS = 100

const ATTRIBUTE_PREFIX = '@_'
const EMPTY_ELEMENT: GsdmlXmlElement = Object.freeze({})

/**
 * Creates the configured XML library parser, with every limit of {@link GSDML_XML_ENTITY_LIMITS} and no DOCTYPE
 * pre-check. It decodes the predefined entities and, through the library option `htmlEntities`, numeric character
 * references.
 *
 * @returns A parser that returns every element as an array and keeps attribute values as strings.
 */
export function createGsdmlXmlLibraryParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    allowBooleanAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    removeNSPrefix: false,
    processEntities: { enabled: true, ...GSDML_XML_ENTITY_LIMITS },
    htmlEntities: true,
    maxNestedTags: GSDML_XML_MAX_NESTED_TAGS,
    isArray: (_tagName: string, _path: unknown, _isLeafNode: boolean, isAttribute: boolean) => !isAttribute,
  })
}

/** Whether a value is a parsed element object. */
function isElementObject(value: unknown): value is GsdmlXmlElement {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The named entity references XML predefines; with no DTD, every other name is undeclared. */
const PREDEFINED_ENTITY_NAMES: ReadonlySet<string> = new Set(['lt', 'gt', 'amp', 'quot', 'apos'])

/** Markup whose content holds no references: its opening, and the text that closes it. */
const UNREFERENCED_SECTIONS = [
  { open: '<!--', close: '-->' },
  { open: '<![CDATA[', close: ']]>' },
  { open: '<?', close: '?>' },
] as const

/** A named entity reference with no declaration, and the 1-based line and UTF-16 column of its `&`. */
interface UndeclaredEntityReference {
  readonly name: string
  readonly line: number
  readonly column: number
}

/** Whether a character ends an entity reference name: XML whitespace, markup delimiters, quotes or `;`. */
function endsReferenceName(character: string): boolean {
  return ' \t\r\n<>&;"\''.includes(character)
}

/** The 1-based line and UTF-16 column of an index of the text, lines split at LF. */
function positionAt(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  let newline = text.indexOf('\n')
  while (newline !== -1 && newline < index) {
    line += 1
    lineStart = newline + 1
    newline = text.indexOf('\n', lineStart)
  }
  return { line, column: index - lineStart + 1 }
}

/**
 * Finds the first named entity reference, in document order, whose name is not one of the five predefined ones.
 * Comments, CDATA sections and processing instructions are skipped; an unterminated one ends the search.
 *
 * @param text - XML text without a DOCTYPE.
 * @returns The reference and its position, or null when there is none.
 */
function findUndeclaredEntityReference(text: string): UndeclaredEntityReference | null {
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '<') {
      const section = UNREFERENCED_SECTIONS.find(({ open }) => text.startsWith(open, index))
      if (section === undefined) {
        index += 1
        continue
      }
      const close = text.indexOf(section.close, index + section.open.length)
      if (close === -1) return null
      index = close + section.close.length
      continue
    }
    if (character !== '&' || text[index + 1] === '#') {
      index += 1
      continue
    }
    let end = index + 1
    while (end < text.length && !endsReferenceName(text[end])) end += 1
    if (end > index + 1 && text[end] === ';') {
      const name = text.slice(index + 1, end)
      if (!PREDEFINED_ENTITY_NAMES.has(name)) return { name, ...positionAt(text, index) }
    }
    index = end
  }
  return null
}

/**
 * Checks that the text is well-formed XML, then parses it with the configured library parser. Never throws.
 *
 * Before the XML library runs, a named entity reference other than `lt`, `gt`, `amp`, `quot` and `apos`, outside
 * comments, CDATA sections and processing instructions, rejects the text as an undeclared entity reference with the
 * line and column of its `&`. Numeric character references are not affected.
 *
 * @param text - XML text without a DOCTYPE.
 * @returns The top-level elements, or the reason the text could not be read.
 */
export function readGsdmlXml(text: string): GsdmlXmlReadResult {
  try {
    const undeclared = findUndeclaredEntityReference(text)
    if (undeclared !== null) {
      const { name, line, column } = undeclared
      return { ok: false, reason: `undeclared entity reference &${name}; (line ${line}, column ${column})` }
    }
    const validation = XMLValidator.validate(text, { allowBooleanAttributes: false })
    if (validation !== true) {
      const { msg, line, col } = validation.err
      return { ok: false, reason: `${msg} (line ${line}, column ${col})` }
    }
    const parsed: unknown = createGsdmlXmlLibraryParser().parse(text)
    if (!isElementObject(parsed)) return { ok: false, reason: 'the XML library returned no document' }
    return { ok: true, document: parsed }
  } catch (error: unknown) {
    return { ok: false, reason: errorMessage(error, 'unknown error') }
  }
}

/** The names of the child elements of an element, in document order of first appearance. */
export function childElementNames(element: GsdmlXmlElement): string[] {
  return Object.keys(element).filter((key) => !key.startsWith(ATTRIBUTE_PREFIX) && key !== '#text')
}

/** The child elements with the given name, in document order; an empty or text-only child reads as an empty element. */
export function childElements(element: GsdmlXmlElement, name: string): GsdmlXmlElement[] {
  if (!Object.prototype.hasOwnProperty.call(element, name)) return []
  const value: unknown = element[name]
  const items: readonly unknown[] = Array.isArray(value) ? value : [value]
  const result: GsdmlXmlElement[] = []
  for (const item of items) {
    if (isElementObject(item)) result.push(item)
    else if (typeof item === 'string') result.push(EMPTY_ELEMENT)
  }
  return result
}

/** The first child element with the given name. */
export function childElement(element: GsdmlXmlElement, name: string): GsdmlXmlElement | undefined {
  return childElements(element, name)[0]
}

/** The children of the first child list with the given name, such as `ModuleList` then `ModuleItem`. */
export function listItems(element: GsdmlXmlElement, listName: string, itemName: string): GsdmlXmlElement[] {
  const list = childElement(element, listName)
  return list === undefined ? [] : childElements(list, itemName)
}

/** The value of an attribute as written, or undefined when the element has no such attribute. */
export function attributeValue(element: GsdmlXmlElement, name: string): string | undefined {
  const key = `${ATTRIBUTE_PREFIX}${name}`
  if (!Object.prototype.hasOwnProperty.call(element, key)) return undefined
  const value: unknown = element[key]
  return typeof value === 'string' ? value : undefined
}

/** The names of the attributes of an element, without the attribute prefix. */
export function attributeNames(element: GsdmlXmlElement): string[] {
  return Object.keys(element)
    .filter((key) => key.startsWith(ATTRIBUTE_PREFIX))
    .map((key) => key.slice(ATTRIBUTE_PREFIX.length))
}

/** Parses an unsigned integer written in decimal or with a `0x` prefix; null when it is not one. */
export function parseUnsignedValue(raw: string): number | null {
  const text = raw.trim()
  let value: number
  if (/^[0-9]+$/.test(text)) value = Number(text)
  else if (/^0x[0-9a-f]+$/i.test(text)) value = parseInt(text.slice(2), 16)
  else return null
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Normalises a `0x` hexadecimal ident number to lowercase digits without leading zeros.
 *
 * @param raw - The attribute value.
 * @param maxDigits - The most significant hex digits the ident type holds.
 * @returns The normalised ident, such as `0x2a`, or null when the value is not a hex number that fits.
 */
export function parseIdentValue(raw: string, maxDigits: number): string | null {
  const match = /^0x([0-9a-f]+)$/i.exec(raw.trim())
  if (match === null) return null
  const digits = match[1].toLowerCase().replace(/^0+(?=.)/, '')
  return digits.length <= maxDigits ? `0x${digits}` : null
}

/** Parses a slot or subslot set: numbers and `a..b` ranges separated by whitespace; null when it is not one. */
export function parseSlotSetValue(raw: string): { first: number; last: number }[] | null {
  const tokens = raw.trim().split(/\s+/)
  if (tokens.length === 1 && tokens[0] === '') return null
  const ranges: { first: number; last: number }[] = []
  for (const token of tokens) {
    const separator = token.indexOf('..')
    const first = parseUnsignedValue(separator === -1 ? token : token.slice(0, separator))
    const last = separator === -1 ? first : parseUnsignedValue(token.slice(separator + 2))
    if (first === null || last === null || last < first) return null
    ranges.push({ first, last })
  }
  return ranges
}

/** Parses an octet list such as `0x00,0x1F`; null when it is not one. */
export function parseOctetsValue(raw: string): number[] | null {
  const octets: number[] = []
  for (const part of raw.split(',')) {
    const match = /^0x([0-9a-f]{1,2})$/i.exec(part.trim())
    if (match === null) return null
    octets.push(parseInt(match[1], 16))
  }
  return octets
}

/** Parses an XML schema boolean; the fallback when the value is absent or not a boolean. */
export function parseBooleanValue(raw: string | undefined, fallback: boolean): boolean {
  const text = raw?.trim()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  return fallback
}

/** Splits a token list on semicolons and whitespace, keeping every token as written. */
export function parseTokenList(raw: string | undefined): string[] {
  return raw === undefined ? [] : raw.split(/[;\s]+/).filter((token) => token !== '')
}
