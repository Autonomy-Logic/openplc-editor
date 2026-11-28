import type { PLCVariable } from '../../middleware/shared/ports/types'
import { buildGlobalCompositeKey, GLOBAL_CONFIG_NAME } from './debug-variable-finder'

/** Leading identifier of a variable expression: `g.a[1].b` gives `g`. */
const BASE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/

const GLOBAL_PREFIX = `${GLOBAL_CONFIG_NAME}:`

/** Upper-case name to declared name of each VAR_EXTERNAL of a POU. */
export function pouExternalNames(variables: readonly PLCVariable[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const v of variables) if (v.class === 'external') names.set(v.name.toUpperCase(), v.name)
  return names
}

/**
 * Debug composite key of a name used in a POU body. A name whose base identifier is one of the POU's VAR_EXTERNAL
 * globals keys under the canonical global key, as the debug tree does; any other name keys under `scope`
 * (`pou:` or `program:fbVariable.`).
 */
export function pouDebugKey(name: string, scope: string, externals: ReadonlyMap<string, string>): string {
  const base = BASE_IDENTIFIER.exec(name)?.[0]
  const declared = base === undefined ? undefined : externals.get(base.toUpperCase())
  return declared === undefined ? `${scope}${name}` : buildGlobalCompositeKey(`${declared}${name.slice(base!.length)}`)
}

/** Expressions a POU body can show a debug value for, each with the composite key that holds its value. */
export function pouDebugExpressions(
  keys: Iterable<string>,
  scope: string,
  externals: ReadonlyMap<string, string>,
): Map<string, string> {
  const expressions = new Map<string, string>()
  for (const key of keys) {
    if (key.startsWith(scope)) {
      expressions.set(key.slice(scope.length), key)
    } else if (key.startsWith(GLOBAL_PREFIX)) {
      const expression = key.slice(GLOBAL_PREFIX.length)
      const base = BASE_IDENTIFIER.exec(expression)?.[0]
      if (base !== undefined && externals.get(base.toUpperCase()) === base) expressions.set(expression, key)
    }
  }
  return expressions
}
