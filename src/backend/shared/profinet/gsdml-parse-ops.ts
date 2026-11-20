import type {
  GsdmlParseRequest,
  GsdmlParseResponse,
  GsdmlSummaryResult,
} from '@root/middleware/shared/ports/gsdml-repository-mechanisms'

import { parseGsdml, summarizeGsdmlCatalog } from './gsdml-parser'

/**
 * The single entry every GSDML parsing thread runs. Never throws.
 *
 * @param request - `catalog` for the full catalog, `summary` for the repository summary.
 * @returns The answer tagged with the op of the request; plain data, safe to structured-clone.
 */
export function runGsdmlParseOp(request: GsdmlParseRequest): GsdmlParseResponse {
  const parsed = parseGsdml(request.xml)
  if (request.op === 'catalog') return { op: 'catalog', result: parsed }
  const result: GsdmlSummaryResult = parsed.success
    ? { success: true, summary: summarizeGsdmlCatalog(parsed.catalog) }
    : { success: false, error: parsed.error }
  return { op: 'summary', result }
}
