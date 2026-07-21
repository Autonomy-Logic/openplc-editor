import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'
import { parseTypeXml } from './type-xml'
import { asRecord } from './xml-node'

// A bare `<xhtml:p>text</xhtml:p>` (no attributes) parses to a plain string;
// fast-xml-parser only wraps it in `{ $: text }` when attributes are present.
function extractXhtmlText(xml: unknown): string {
  const rec = asRecord(xml)
  const p = rec['xhtml:p']
  if (typeof p === 'string') return p
  const text = asRecord(p).$
  return typeof text === 'string' ? text : ''
}

// The generator writes a literal single space for an empty documentation
// string (`value === '' ? ' ' : value`, see oldEditorParseInterface/
// oldEditorParsePousToXML) — reverse that placeholder back to ''. ST/IL body
// text has no such placeholder, so callers reading a body use
// `extractXhtmlText` directly instead of this function.
export function parseDocumentationXml(xml: unknown): string {
  const text = extractXhtmlText(xml)
  return text === ' ' ? '' : text
}

export { extractXhtmlText }

// Reverse of the `VariableXML` shape built in oldEditorParseInterface /
// oldEditorInstanceToXml — shared by POU interface variables and
// configuration global variables (only `class` differs by call site).
export function parseVariableXml(varXml: unknown, variableClass: VariableClass): PLCVariable {
  const v = asRecord(varXml)
  const initialValueXml = asRecord(v.initialValue)
  const simpleValue = asRecord(initialValueXml.simpleValue)
  const initialValue = typeof simpleValue['@value'] === 'string' ? simpleValue['@value'] : null
  const location = v['@address']

  return {
    name: typeof v['@name'] === 'string' ? v['@name'] : '',
    class: variableClass,
    type: parseTypeXml(v.type),
    location: typeof location === 'string' ? location : '',
    initialValue,
    documentation: parseDocumentationXml(v.documentation),
  }
}
