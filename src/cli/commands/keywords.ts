/**
 * `openplc-cli keywords` — the names an identifier may not take.
 *
 * Exists because getting this wrong is silent until it is expensive: a POU,
 * variable, data type or enumeration value that collides with a keyword is
 * refused by `apply`, and one that slips through a gap in the list compiles
 * into a generated file that will not parse, with the error pointing at code
 * nobody wrote. An agent authoring a spec can read this first instead.
 *
 * The list is the one `apply` checks against, not a copy of it, so the two
 * cannot drift.
 */

import { reservedWords } from '@root/frontend/utils/keywords'

import { boolFlag, type ParsedArgs } from '../args'
import type { CliResult, Reporter } from '../output'

export function runKeywords(args: ParsedArgs, reporter: Reporter): CliResult {
  // Deduplicated: the two source lists overlap on a few names, and a caller
  // diffing against this should not see one twice.
  const words = [...new Set(reservedWords)].sort((a, b) => a.localeCompare(b))

  // A name is also refused for its SHAPE, and a caller checking a candidate
  // needs both rules or it will pass something the command would refuse.
  const rules = [
    'must start with a letter or underscore',
    'may contain only letters, digits and underscores',
    'must not be a literal (TRUE, FALSE, T#1s, 16#FF, …)',
    'must not be one of the reserved words below, in any case',
  ]

  if (boolFlag(args, 'names-only')) {
    return reporter.success({ ok: true, keywords: words }, () => words.join('\n'))
  }

  return reporter.success({ ok: true, rules, keywords: words }, () =>
    [
      `An identifier — a POU, variable, data type, enumeration value or task:`,
      ...rules.map((rule) => `  - ${rule}`),
      '',
      `${words.length} reserved words:`,
      ...chunk(words, 6).map(
        (row) =>
          '  ' +
          row
            .map((word) => word.padEnd(20))
            .join('')
            .trimEnd(),
      ),
    ].join('\n'),
  )
}

function chunk(words: string[], perRow: number): string[][] {
  const rows: string[][] = []
  for (let i = 0; i < words.length; i += perRow) rows.push(words.slice(i, i + perRow))
  return rows
}
