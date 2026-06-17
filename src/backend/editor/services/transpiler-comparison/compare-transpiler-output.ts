/**
 * Pure comparison of the two transpiler engines' Structured Text output.
 *
 * Both editor transpile paths (the shared compile pipeline via the platform
 * port and the debug compile in `compiler-module`) run the legacy `xml2st`
 * subprocess and the new in-process TS engine on every compile while the new
 * engine is being validated. This helper turns the two ST strings into a
 * single comparison verdict + human-readable summary that each call site
 * logs through its own channel.
 *
 * Mirrors web's `middleware/adapters/web/services/st-transpiler/compare-transpiler-output.ts`
 * (the only difference is the old-engine label — editor runs xml2st locally,
 * web calls the remote compile service).
 */

export const TRANSPILER_LABEL_OLD = 'old (xml2st)'
export const TRANSPILER_LABEL_NEW = 'new (in-process TS)'

export interface TranspilerComparison {
  /**
   * `identical` — both engines produced byte-equal ST.
   * `different` — both succeeded but the ST diverges.
   * `incomparable` — at least one engine failed, so there is nothing to diff.
   */
  status: 'identical' | 'different' | 'incomparable'
  /** Human-readable one-line summary suitable for a log message. */
  message: string
}

/**
 * Compare the ST emitted by each engine. Pass `undefined` for an engine
 * that failed to produce output — the verdict is then `incomparable`.
 */
export function compareTranspilerOutput(oldSt: string | undefined, newSt: string | undefined): TranspilerComparison {
  if (typeof oldSt !== 'string' || typeof newSt !== 'string') {
    return {
      status: 'incomparable',
      message:
        `comparison skipped — ${TRANSPILER_LABEL_OLD}: ${typeof oldSt === 'string' ? 'ok' : 'failed'}, ` +
        `${TRANSPILER_LABEL_NEW}: ${typeof newSt === 'string' ? 'ok' : 'failed'}`,
    }
  }

  if (oldSt === newSt) {
    return { status: 'identical', message: `outputs identical (${oldSt.length} chars)` }
  }

  return { status: 'different', message: `outputs DIFFER — ${describeStDifference(oldSt, newSt)}` }
}

/**
 * Concise summary of where two ST outputs diverge: char and line counts
 * for each engine plus the first differing line shown verbatim.
 */
function describeStDifference(oldSt: string, newSt: string): string {
  const oldLines = oldSt.split('\n')
  const newLines = newSt.split('\n')
  const lineCount = Math.max(oldLines.length, newLines.length)

  let firstDiff = -1
  for (let i = 0; i < lineCount; i++) {
    if (oldLines[i] !== newLines[i]) {
      firstDiff = i
      break
    }
  }

  const parts = [
    `${TRANSPILER_LABEL_OLD} ${oldSt.length} chars / ${oldLines.length} lines`,
    `${TRANSPILER_LABEL_NEW} ${newSt.length} chars / ${newLines.length} lines`,
  ]
  if (firstDiff >= 0) {
    parts.push(`first difference at line ${firstDiff + 1}`)
    parts.push(`old: ${JSON.stringify(oldLines[firstDiff] ?? '<missing>')}`)
    parts.push(`new: ${JSON.stringify(newLines[firstDiff] ?? '<missing>')}`)
  }
  return parts.join('; ')
}
