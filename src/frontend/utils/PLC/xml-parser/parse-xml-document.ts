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
