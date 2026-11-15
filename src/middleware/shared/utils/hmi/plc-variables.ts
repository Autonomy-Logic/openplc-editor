/**
 * The PLC variables screens may use, named as screens write them: `<Instance>.<Program>.<Name>`, configuration
 * globals by name and `<List>.<Name>`; elementary types only, constants marked read-only.
 */
import type { HmiPlcVariable } from '../../ports/hmi-preview-types'
import type { PLCProjectData, PLCVariable } from '../../ports/types'

const HIDDEN_CLASSES = new Set(['temp', 'external'])

function asHmiVariable(path: string, variable: PLCVariable): HmiPlcVariable | null {
  if (variable.type.definition !== 'base-type') return null
  if (variable.class !== undefined && HIDDEN_CLASSES.has(variable.class)) return null
  const initial = variable.initialValue?.trim()
  return {
    path,
    type: variable.type.value.toUpperCase(),
    ...(initial ? { initialValue: initial } : {}),
    ...(variable.flag === 'constant' ? { constant: true as const } : {}),
  }
}

export function hmiPlcVariables(
  project: Pick<PLCProjectData, 'pous' | 'configurations'> & Partial<Pick<PLCProjectData, 'globalVariableLists'>>,
): HmiPlcVariable[] {
  const variables: HmiPlcVariable[] = []
  const add = (path: string, v: PLCVariable) => {
    const hmi = asHmiVariable(path, v)
    if (hmi) variables.push(hmi)
  }
  const { resource } = project.configurations
  for (const instance of resource.instances) {
    const pou = project.pous.find(
      (p) => p.pouType === 'program' && p.name.toUpperCase() === instance.program.toUpperCase(),
    )
    if (!pou) continue
    for (const v of pou.interface?.variables ?? []) add(`${instance.name}.${pou.name}.${v.name}`, v)
  }
  for (const v of resource.globalVariables) add(v.name, v)
  for (const list of project.globalVariableLists ?? []) for (const v of list.variables) add(`${list.name}.${v.name}`, v)
  return variables
}
