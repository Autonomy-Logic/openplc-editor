import { XMLParser } from 'fast-xml-parser'

import { asRecord } from './xml-node'

// Elements the old-editor generator always emits as a list, even with 0 or 1
// items (see xml-generator/old-editor/*.ts) — fast-xml-parser otherwise
// collapses a single child into a bare object, which would break every
// downstream `.map()`/`.forEach()` over "the list of X".
const ARRAY_TAGS = new Set(['dataType', 'pou', 'task', 'pouInstance', 'variable', 'dimension', 'value'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '$',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ARRAY_TAGS.has(name),
})

// Second parser, used only to recover whitespace-significant payloads.
//
// `trimValues` defaults to true and is global — fast-xml-parser has no
// per-tag opt-out (`tagValueProcessor` receives the already-trimmed value,
// `stopNodes` skips entity decoding). Harmless for everything else here, but
// an Execute element's `<STCode>` is source code, and trimming eats its first
// line's indentation. Flipping the flag globally would change every other
// value, so the document is parsed again with trimming off and only the
// STCode payloads are taken from it.
const untrimmedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '$',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_TAGS.has(name),
})

const EXECUTE_TYPE_NAME = 'EXECUTE'
// Duplicated from `execute-plcopen.ts` rather than imported: this module is
// the parser's entry point and must not pull in the generator-side surface.
const EXECUTE_STCODE_URIS = ['http://openplc.org/plcopenxml/stcode', 'http://www.3s-software.com/plcopenxml/stcode']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStCodeText(node: Record<string, unknown>): string | null {
  const addData = node.addData
  if (!isRecord(addData)) return null
  const entries = Array.isArray(addData.data) ? addData.data : [addData.data]
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry['@name'] !== 'string') continue
    if (!EXECUTE_STCODE_URIS.includes(entry['@name'])) continue
    const stCode = entry.STCode
    if (typeof stCode === 'string') return stCode
    if (isRecord(stCode) && typeof stCode['$'] === 'string') return stCode['$']
    return ''
  }
  return null
}

/**
 * Map every Execute element's `@localId` to its untrimmed ST snippet.
 *
 * Keyed by localId because that is the only identifier shared between this
 * pass and the main parse. A document with no Execute elements yields an
 * empty map and costs one extra parse; that is the price of fast-xml-parser
 * having no per-tag whitespace control.
 */
export function collectExecuteStCode(xml: string): Map<string, string> {
  const found = new Map<string, string>()
  let tree: unknown
  try {
    tree = untrimmedParser.parse(xml)
  } catch {
    // The main parse is the one that reports malformed input; this pass
    // failing alone just means snippets fall back to their trimmed values.
    return found
  }

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isRecord(value)) return
    if (value['@typeName'] === EXECUTE_TYPE_NAME) {
      const localId = value['@localId']
      const code = readStCodeText(value)
      if (typeof localId === 'string' && code !== null) found.set(localId, code)
    }
    for (const child of Object.values(value)) walk(child)
  }

  walk(tree)
  return found
}

// Parses raw PLCopen XML text into the untyped object tree fast-xml-parser
// produces. Deliberately returns `Record<string, unknown>`, not a typed
// shape — the vendored xml-types zod schemas (xml-generator/old-editor/*)
// are known to be narrower than what the generator itself can emit (e.g.
// `derived`/`array` variable types aren't in every schema), so validating
// against them here would silently strip data. Downstream parser modules
// narrow field by field instead.
export function parseXmlDocument(xml: string): Record<string, unknown> {
  const result = asRecord(parser.parse(xml))
  const project = asRecord(result.project)
  if (Object.keys(project).length === 0) {
    throw new Error('Invalid PLCopen XML: missing <project> root element')
  }
  return project
}
