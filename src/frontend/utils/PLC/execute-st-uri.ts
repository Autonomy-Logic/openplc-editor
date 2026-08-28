/**
 * URI scheme for an Execute ("ST Block") element's snippet.
 *
 * The same string is the Monaco model URI of the node's editing surface AND
 * the LSP document URI the snippet is opened under. `attachDiagnosticsBridge`
 * matches diagnostics to models by comparing URI strings, so the two must
 * agree exactly — hence one helper, imported by both sides.
 *
 * Lives in `utils/` rather than beside the LSP service so the components layer
 * can reach it without violating the layer rules.
 */

const EXECUTE_URI_SCHEME = 'inmemory'
const EXECUTE_URI_AUTHORITY = 'execute'

/**
 * Build the document URI for one Execute node. Both segments are
 * percent-encoded, so a POU name containing a space or slash still yields a
 * well-formed URI.
 */
export function executeStDocumentUri(pouName: string, nodeId: string): string {
  return `${EXECUTE_URI_SCHEME}://${EXECUTE_URI_AUTHORITY}/${encodeURIComponent(pouName)}/${encodeURIComponent(nodeId)}.st`
}

/** Reverse of {@link executeStDocumentUri}; null when `uri` is not one of ours. */
export function parseExecuteStDocumentUri(uri: string): { pouName: string; nodeId: string } | null {
  const match = new RegExp(`^${EXECUTE_URI_SCHEME}://${EXECUTE_URI_AUTHORITY}/([^/]+)/(.+)\\.st$`).exec(uri)
  if (!match) return null
  try {
    return { pouName: decodeURIComponent(match[1]), nodeId: decodeURIComponent(match[2]) }
  } catch {
    // Malformed percent-encoding — treat as "not ours" rather than throwing
    // into whatever notification handler is walking open documents.
    return null
  }
}

/**
 * Stable `uniqueId` for the throwaway POU shell wrapping a snippet (see
 * `serializePouScopeForBody`). Sanitised because node ids may contain
 * characters that are illegal in an IEC identifier; stable because that is
 * what keeps an edit a `didChange` rather than a close/reopen pair.
 */
export function executeStScopeId(nodeId: string): string {
  return `execute_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}
