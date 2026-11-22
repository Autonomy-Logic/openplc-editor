import type { PLCVariable } from '../../ports/types'
import { isLiteralLocation } from '../iec-address/registry/resolve'

/** Variables a ladder POU's location labels are read from; plain arrays only, so it survives a structured clone. */
export interface LadderLabelSource {
  pouVariables: readonly PLCVariable[]
  globalVariables: readonly PLCVariable[]
}

export const EMPTY_LABEL_SOURCE: LadderLabelSource = { pouVariables: [], globalVariables: [] }

/** The location line of an element: nothing, a literal `%` address or an alias name, both drawn verbatim. */
export type LocationLabel = { kind: 'none' } | { kind: 'address'; text: string } | { kind: 'alias'; text: string }

const NO_LABEL: LocationLabel = { kind: 'none' }

/** The variable whose name equals `name`, ignoring case; the first one wins. */
function findByName(variables: readonly PLCVariable[], name: string): PLCVariable | undefined {
  const wanted = name.toLowerCase()
  return variables.find((variable) => variable.name.toLowerCase() === wanted)
}

/** The label of a stored location field: empty gives none, a `%` literal an address, anything else an alias. */
function labelOfLocation(location: string): LocationLabel {
  if (!location) return NO_LABEL
  return isLiteralLocation(location) ? { kind: 'address', text: location } : { kind: 'alias', text: location }
}

/**
 * The location label of the variable an element refers to. Only a declared POU variable has one; a VAR_EXTERNAL takes
 * the location of the resource global of the same name. Array elements, member access, literals and undeclared names
 * match no declared name and give none.
 */
export function resolveLocationLabel(name: string, src: LadderLabelSource): LocationLabel {
  const variable = findByName(src.pouVariables, name)
  if (!variable) return NO_LABEL
  if (variable.class !== 'external') return labelOfLocation(variable.location)
  const resourceGlobal = findByName(src.globalVariables, variable.name)
  return resourceGlobal ? labelOfLocation(resourceGlobal.location) : NO_LABEL
}

/** The tooltip of an alias label, `"<alias> -> <address>"` or `"<alias> -> unresolved"`; undefined for other labels. */
export function aliasTooltip(label: LocationLabel, aliasIndex: ReadonlyMap<string, string>): string | undefined {
  switch (label.kind) {
    case 'alias':
      return `${label.text} -> ${aliasIndex.get(label.text) ?? 'unresolved'}`
    case 'address':
    case 'none':
      return undefined
    default: {
      const unreachable: never = label
      return unreachable
    }
  }
}

/** A string that changes only when a drawn location text can change: the name, class and location of each variable. */
export function labelSourceSignature(src: LadderLabelSource): string {
  const fields = (variable: PLCVariable): [string, string | null, string] => [
    variable.name,
    variable.class ?? null,
    variable.location,
  ]
  return JSON.stringify([src.pouVariables.map(fields), src.globalVariables.map(fields)])
}
