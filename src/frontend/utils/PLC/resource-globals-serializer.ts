// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
import type { PLCInstance, PLCTask, PLCVariable } from '../../../middleware/shared/ports/types'
import { resolveLocation } from '../../../middleware/shared/utils/iec-address/registry'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'

/** The configuration and resource names the compiler emits (`st-transpiler/emit/configuration.ts`). */
const GLOBALS_CONFIG_NAME = 'Config0'
const GLOBALS_RESOURCE_NAME = 'Res0'

/** An ST identifier, which a task or instance name must be to appear in the document. */
const IDENTIFIER = /^[A-Za-z_]\w*$/

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
 * The resource lists the tasks and program instances, so HMI screens resolve instance paths
 * (`instance0.Main.Run`) against the same configuration the compiler emits. Only instances of an
 * existing program (`programs`) with identifier names are listed, so a row being filled in or one
 * left by a deleted program adds no error to every document.
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
  resource: { tasks: readonly PLCTask[]; instances: readonly PLCInstance[]; programs: readonly string[] } = {
    tasks: [],
    instances: [],
    programs: [],
  },
): string {
  const programs = new Set(resource.programs.map((p) => p.toUpperCase()))
  const tasks = resource.tasks.filter((t) => IDENTIFIER.test(t.name))
  const instances = resource.instances.filter(
    (i) => IDENTIFIER.test(i.name) && programs.has(i.program.trim().toUpperCase()),
  )
  if ((!globals || globals.length === 0) && instances.length === 0) return ''
  const taskNames = new Set(tasks.map((t) => t.name.toUpperCase()))
  // Force the global class so the shared formatter always emits a single
  // VAR_GLOBAL block, regardless of any stray class on the stored variable.
  const varBlock =
    (globals ?? []).length === 0
      ? ''
      : generateIecVariablesToString(
          globals.map((g) => ({
            ...g,
            class: 'global',
            location: g.location ? resolveLocation(g.location, aliasIndex) : '',
          })),
        )
  return [
    `CONFIGURATION ${GLOBALS_CONFIG_NAME}`,
    ...(varBlock ? [varBlock] : []),
    `  RESOURCE ${GLOBALS_RESOURCE_NAME} ON PLC`,
    ...tasks.map(
      (t) => `    TASK ${t.name}(${t.interval ? `INTERVAL := ${t.interval}, ` : ''}PRIORITY := ${t.priority});`,
    ),
    ...instances.map((i) =>
      i.task && taskNames.has(i.task.toUpperCase())
        ? `    PROGRAM ${i.name} WITH ${i.task} : ${i.program};`
        : `    PROGRAM ${i.name} : ${i.program};`,
    ),
    '  END_RESOURCE',
    'END_CONFIGURATION',
    '',
  ].join('\n')
}
