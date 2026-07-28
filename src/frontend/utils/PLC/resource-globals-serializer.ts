// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { resolveLocation } from '../../../middleware/shared/utils/iec-address/registry'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'

const GLOBALS_CONFIG_NAME = '__globals_cfg__'
const GLOBALS_RESOURCE_NAME = '__globals_res__'

/**
 * Serialize the project's resource-level global variables as a standalone
 * `CONFIGURATION` document for the language server, so a POU's `VAR_EXTERNAL`
 * resolves against a matching `VAR_GLOBAL` instead of being flagged as having no
 * global declaration.
 *
 * Two things pin the shape:
 *   - strucpp only matches a `VAR_EXTERNAL` against a global declared inside a
 *     `CONFIGURATION` — a bare top-level `VAR_GLOBAL` block does NOT satisfy it.
 *   - the compiler itself emits user globals at the `CONFIGURATION` level (see
 *     `st-transpiler/emit/configuration.ts`), so validating against this shape
 *     matches exactly what gets generated.
 *
 * The `VAR_GLOBAL` block is produced by `generateIecVariablesToString` — the
 * same formatter the variables editor uses — so declarations stay in lockstep
 * with how variables render everywhere else. Returns '' when there are none.
 *
 * `aliasIndex` resolves alias-bound locations to literal `%…` addresses. A
 * global bound to an IO alias would otherwise serialize as `AT my_alias`,
 * which strucpp rejects — taking the whole VAR_GLOBAL block (and thus every
 * `VAR_EXTERNAL` resolution) down with it. Defaults to an empty index, which
 * drops unresolvable locations rather than emitting invalid ST.
 */
export function serializeResourceGlobalsToST(
  globals: PLCVariable[],
  aliasIndex: ReadonlyMap<string, string> = new Map(),
): string {
  if (!globals || globals.length === 0) return ''
  // Force the global class so the shared formatter always emits a single
  // VAR_GLOBAL block, regardless of any stray class on the stored variable.
  const varBlock = generateIecVariablesToString(
    globals.map((g) => ({
      ...g,
      class: 'global',
      location: g.location ? resolveLocation(g.location, aliasIndex) : '',
    })),
  )
  return [
    `CONFIGURATION ${GLOBALS_CONFIG_NAME}`,
    varBlock,
    `  RESOURCE ${GLOBALS_RESOURCE_NAME} ON PLC`,
    '  END_RESOURCE',
    'END_CONFIGURATION',
    '',
  ].join('\n')
}
