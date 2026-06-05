/**
 * TS port of `plcopen/plcopen.py` LoadProject / LoadProjectXML.
 *
 * Mirrors the Python pipeline's *happy path*: XML namespace fix-up, CDATA
 * wrapping, parse via @xmldom. Returns a discriminated union mirroring
 * Python's `(tree, error)` tuple.
 *
 * Deliberate divergences from Python (tracked in fixtures/INVENTORY.md):
 *   - No runtime XSD validation. Browser cannot validate against XSD without
 *     a wasm-port; we rely on the Python oracle for schema correctness.
 *   - No PLCOpen v1 → v2 migration path. Real-world projects are already v2;
 *     porting the migration is deferred until a golden requires it.
 */

import type { Document as XmlDocument } from '@xmldom/xmldom'
import { DOMParser } from '@xmldom/xmldom'

const TC6_OLD_NS = 'http://www.plcopen.org/xml/tc6.xsd'
const TC6_NEW_NS = 'http://www.plcopen.org/xml/tc6_0201'

/**
 * Bare `<![CDATA[` not already wrapped in `<xhtml:p>`.
 * Matches Python's `re.compile(r"(?<!<xhtml:p>)(?:<!\[CDATA\[)")`.
 */
const CDATA_OPEN_BARE = /(?<!<xhtml:p>)<!\[CDATA\[/g
/**
 * Bare `]]>` not already followed by `</xhtml:p>`.
 * Matches Python's `re.compile(r"(?:]]>)(?!</xhtml:p>)")`.
 */
const CDATA_CLOSE_BARE = /]]>(?!<\/xhtml:p>)/g

/**
 * Document type returned on successful parse. Aliased so callers can
 * be transport-agnostic if we ever swap parsers.
 */
export type ProjectTree = XmlDocument

export type LoadResult = { tree: ProjectTree; error: null } | { tree: null; error: string }

/**
 * Apply the same string-level normalizations Python applies before parsing.
 * Exposed so tests can pin the normalization step independently of parsing.
 */
export function normalizePlcOpenXml(projectXml: string): string {
  // `String.prototype.replaceAll` is es2021 — web's tsconfig target lib
  // doesn't include it.  Use `split/join` for the global non-regex
  // replacement (TC6_OLD_NS contains no regex metacharacters anyway).
  let s = projectXml.split(TC6_OLD_NS).join(TC6_NEW_NS)
  s = s.replace(CDATA_OPEN_BARE, '<xhtml:p><![CDATA[')
  s = s.replace(CDATA_CLOSE_BARE, ']]></xhtml:p>')
  return s
}

/**
 * Parse a PLCOpen XML string into a Document.
 *
 * Matches the *signature* of Python's `LoadProjectXML(project_xml) -> (tree, error)`.
 * On parser failure, returns `{ tree: null, error }` so callers can distinguish
 * structural problems from schema problems (the latter being the Python
 * pipeline's concern, not ours).
 */
export function LoadProjectXML(projectXml: string): LoadResult {
  const normalized = normalizePlcOpenXml(projectXml)
  const errors: string[] = []
  try {
    const parser = new DOMParser({
      onError: (level, msg) => {
        if (level === 'error' || level === 'fatalError') {
          errors.push(String(msg))
        }
      },
    })
    const tree = parser.parseFromString(normalized, 'text/xml')
    if (errors.length > 0 || !tree.documentElement) {
      return { tree: null, error: errors.join('\n') || 'no documentElement' }
    }
    return { tree, error: null }
  } catch (e) {
    return { tree: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Node-only convenience: read a PLCOpen XML file and parse it.
 *
 * Browsers cannot use this — they should call `LoadProjectXML(stringContents)`
 * directly after reading the file via `FileReader` / `Blob.text()`.
 */
export async function LoadProject(filepath: string): Promise<LoadResult> {
  const { readFile } = await import('node:fs/promises')
  const projectXml = await readFile(filepath, 'utf8')
  return LoadProjectXML(projectXml)
}
