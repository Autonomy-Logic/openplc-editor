/**
 * PLCopen XML representation of the Execute ("ST Block") element.
 *
 * TC6 defines no element for inline Structured Text, so the snippet rides in
 * `<addData>` — the standard's own extension mechanism. The element itself is
 * an ordinary `<block typeName="EXECUTE">` with real `EN`/`ENO` formal
 * parameters, so its rung wiring stays fully standard.
 *
 * The two exports differ deliberately. "Export to PLCOpen XML" reproduces
 * Beremiz / the legacy OpenPLC Editor, which carries no vendor references, so
 * it uses an openplc.org URI. "Export to CODESYS XML" matches what CODESYS
 * writes, so it uses 3S's URI and their FBD-only descriptors. The importer
 * accepts either.
 */

/** `@typeName` on the `<block>` element — the same in both dialects. */
export const EXECUTE_TYPE_NAME = 'EXECUTE'

/** Our own extension URI, used by the neutral PLCOpen export. */
export const EXECUTE_STCODE_URI_OPENPLC = 'http://openplc.org/plcopenxml/stcode'

/** 3S's extension URI, used by the CODESYS export and accepted on import. */
export const EXECUTE_STCODE_URI_CODESYS = 'http://www.3s-software.com/plcopenxml/stcode'

/** Every URI the importer recognises as carrying an Execute snippet. */
const EXECUTE_STCODE_URIS: readonly string[] = [EXECUTE_STCODE_URI_OPENPLC, EXECUTE_STCODE_URI_CODESYS]

/** CODESYS-only descriptors, emitted in FBD bodies by that dialect alone. */
const CODESYS_FBD_CALLTYPE_URI = 'http://www.3s-software.com/plcopenxml/fbdcalltype'
const CODESYS_FBD_INPUT_PARAM_TYPES_URI = 'http://www.3s-software.com/plcopenxml/inputparamtypes'
const CODESYS_FBD_OUTPUT_PARAM_TYPES_URI = 'http://www.3s-software.com/plcopenxml/outputparamtypes'

export type ExecuteXmlDialect = 'openplc' | 'codesys'

/**
 * Node types that serialise as a `<block>`.
 *
 * A consumer's `<connection>` names the pin it reads via `@formalParameter`,
 * but only for block-shaped sources — a contact or variable has a single
 * anonymous output. An Execute element is a block in the XML while carrying
 * its own node type in the editor, so every such check has to admit it, or the
 * pin name is dropped and the importer cannot rebuild the edge.
 */
export function isBlockLikeNodeType(nodeType: string | undefined): boolean {
  return nodeType === 'block' || nodeType === 'execute'
}

/**
 * Build the `<addData>` payload. `handleUnknown` is required by the spec and
 * restricted to `preserve` / `discard` / `implementation`.
 */
export function buildExecuteAddData(code: string, dialect: ExecuteXmlDialect, language: 'ld' | 'fbd') {
  if (dialect === 'openplc') {
    return {
      data: {
        '@name': EXECUTE_STCODE_URI_OPENPLC,
        '@handleUnknown': 'preserve',
        STCode: { '#': code },
      },
    }
  }

  const stCode = {
    '@name': EXECUTE_STCODE_URI_CODESYS,
    '@handleUnknown': 'implementation',
    STCode: { '@xmlns': '', '#': code },
  }
  if (language === 'ld') return { data: stCode }

  return {
    data: [
      {
        '@name': CODESYS_FBD_CALLTYPE_URI,
        '@handleUnknown': 'implementation',
        CallType: { '@xmlns': '', '#': 'execute' },
      },
      {
        '@name': CODESYS_FBD_INPUT_PARAM_TYPES_URI,
        '@handleUnknown': 'implementation',
        InputParamTypes: { '@xmlns': '', '#': 'BOOL' },
      },
      {
        '@name': CODESYS_FBD_OUTPUT_PARAM_TYPES_URI,
        '@handleUnknown': 'implementation',
        OutputParamTypes: { '@xmlns': '', '#': 'BOOL' },
      },
      stCode,
    ],
  }
}

type MaybeRecord = Record<string, unknown> | undefined

function asRecord(value: unknown): MaybeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Pull the ST snippet out of a parsed `<block>`, or null if this block isn't
 * an Execute element.
 *
 * `@typeName` alone decides that: `EXECUTE` is the wire name CODESYS and
 * TwinCAT both reserve for this element, and the `addData` is only where the
 * payload rides. A block that says EXECUTE but carries no readable snippet is
 * still an Execute box — it imports empty, which the user can fix, rather than
 * as a nameless function block with pins nothing resolves to.
 *
 * Tolerates both shapes fast-xml-parser produces for `<STCode>`: a bare
 * string, or `{ '$': text }` when the element carries attributes (CODESYS
 * writes `xmlns=""` on it). `data` may be a single object or an array —
 * CODESYS emits four entries for an FBD block and one for an LD block.
 */
export function readExecuteStCode(blockXml: unknown): string | null {
  const block = asRecord(blockXml)
  if (!block) return null
  if (block['@typeName'] !== EXECUTE_TYPE_NAME) return null

  const addData = asRecord(block.addData)
  const entries = addData ? (Array.isArray(addData.data) ? addData.data : [addData.data]) : []
  for (const entry of entries) {
    const record = asRecord(entry)
    if (!record) continue
    const name = record['@name']
    if (typeof name !== 'string' || !EXECUTE_STCODE_URIS.includes(name)) continue
    const stCode = record.STCode
    if (typeof stCode === 'string') return stCode
    const wrapped = asRecord(stCode)
    if (wrapped && typeof wrapped['$'] === 'string') return wrapped['$']
    break
  }
  return ''
}
