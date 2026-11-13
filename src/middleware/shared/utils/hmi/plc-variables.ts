/**
 * The PLC variables a project's screens may use, as the HMI build and the designer name them: a program's variables
 * as `Program.Name` and the resource's globals as `GVL.Name`, with elementary types only.
 */
import type { HmiPlcVariable } from '../../ports/hmi-preview-types'
import type { PLCProjectData, PLCVariable } from '../../ports/types'

const HIDDEN_CLASSES = new Set(['temp', 'external'])

function asHmiVariable(owner: string, variable: PLCVariable): HmiPlcVariable | null {
  if (variable.type.definition !== 'base-type') return null
  const initial = variable.initialValue?.trim()
  return {
    path: `${owner}.${variable.name}`,
    type: variable.type.value.toUpperCase(),
    ...(initial ? { initialValue: initial } : {}),
  }
}

export function hmiPlcVariables(project: Pick<PLCProjectData, 'pous' | 'configurations'>): HmiPlcVariable[] {
  const variables: HmiPlcVariable[] = []
  for (const pou of project.pous) {
    if (pou.pouType !== 'program') continue
    for (const v of pou.interface?.variables ?? []) {
      if (v.class !== undefined && HIDDEN_CLASSES.has(v.class)) continue
      const hmi = asHmiVariable(pou.name, v)
      if (hmi) variables.push(hmi)
    }
  }
  for (const v of project.configurations.resource.globalVariables) {
    const hmi = asHmiVariable('GVL', v)
    if (hmi) variables.push(hmi)
  }
  return variables
}
