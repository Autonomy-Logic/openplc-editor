/**
 * Adapter: builds a PlcModelPort from a project store. Walks POU programs and the configuration's
 * global variables, flattens them into `ExportableVariable` for VPP screens to list. Covers the
 * top-level variables a Data Hub screen marks RO/RW.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import type { ExportableScope, ExportableVariable, PlcModelPort } from '@root/middleware/shared/ports/plc-model-port'
import type { PLCPou, PLCVariable, VariableClass } from '@root/middleware/shared/ports/types'

/** Reserved identifier for the Data Hub's flat global namespace. See the `createPou` guard. */
const GVL_SCOPE_NAME = 'GVL'

/** Variable classes that are inherently read-only to the Data Hub provider: VAR_INPUT is driven
 *  by the caller / IEC input area, VAR_EXTERNAL mirrors a global owned elsewhere, VAR_TEMP is
 *  recomputed each scan. VAR_CONSTANT (via `flag`) also pins to RO regardless of class. */
const READ_ONLY_VARIABLE_CLASSES = new Set<VariableClass>(['input', 'external', 'temp'])

function isVariableWritable(variable: PLCVariable): boolean {
  if (variable.flag === 'constant') return false
  const cls = variable.class ?? 'local'
  return !READ_ONLY_VARIABLE_CLASSES.has(cls)
}

function toExportable(scope: ExportableScope, variable: PLCVariable): ExportableVariable {
  const identifier = scope.kind === 'program' ? scope.programName : scope.listName
  return {
    qualifier: `${identifier}.${variable.name}`,
    scope,
    variable: variable.name,
    type: variable.type.value.toUpperCase(),
    isWritable: isVariableWritable(variable),
  }
}

function collectFromPou(pou: PLCPou): ExportableVariable[] {
  if (pou.pouType !== 'program') return []
  const variables = pou.interface?.variables ?? []
  return variables.map((variable) => toExportable({ kind: 'program', programName: pou.name }, variable))
}

function collectGlobals(variables: PLCVariable[]): ExportableVariable[] {
  return variables.map((variable) => toExportable({ kind: 'gvl', listName: GVL_SCOPE_NAME }, variable))
}

/**
 * Compact fingerprint of the model slice this port exposes. Walks only POU **programs** (the
 * picker never lists function / function-block locals) and the configuration's flat global
 * variables, so edits elsewhere in the project do not force a selector-level change.
 */
function fingerprintState(state: ReturnType<OpenPLCStore['getState']>): string {
  const projectData = state.project.data
  const pous = projectData.pous
    .filter((p) => p.pouType === 'program')
    .map(
      (p) =>
        `${p.name}:${(p.interface?.variables ?? []).map((v) => `${v.name}|${v.type.value}|${v.location}`).join(',')}`,
    )
    .join(';')
  const globals = (projectData.configurations.resource.globalVariables ?? [])
    .map((v) => `${v.name}|${v.type.value}|${v.location}`)
    .join(',')
  return pous + '||' + globals
}

/** Build an in-memory PlcModelPort that reads straight from the store state. Cheap on each call. */
export function createProjectPlcModel(store: OpenPLCStore): PlcModelPort {
  return {
    listExportableVariables(): ReadonlyArray<ExportableVariable> {
      const projectData = store.getState().project.data
      const fromPous = projectData.pous.flatMap(collectFromPou)
      const fromGlobals = collectGlobals(projectData.configurations.resource.globalVariables ?? [])
      return [...fromPous, ...fromGlobals]
    },
    resolveAddress(qualifier: string): string {
      const projectData = store.getState().project.data
      if (qualifier.startsWith('GVL.')) {
        const name = qualifier.slice('GVL.'.length)
        const match = (projectData.configurations.resource.globalVariables ?? []).find((v) => v.name === name)
        return match?.location ?? ''
      }
      const [pouName, variableName] = qualifier.split('.')
      if (!pouName || !variableName) return ''
      const pou = projectData.pous.find((p) => p.name === pouName)
      if (!pou || pou.pouType !== 'program') return ''
      const variable = (pou.interface?.variables ?? []).find((v) => v.name === variableName)
      return variable?.location ?? ''
    },
    onModelChanged(callback) {
      // `subscribeWithSelector` is wired into the store factory: a selector-returning subscribe
      // only calls back when the projection changes (strict equality on the fingerprint string),
      // so unrelated store commits do not wake VPP screen hosts.
      return store.subscribe(fingerprintState, () => callback())
    },
  }
}
