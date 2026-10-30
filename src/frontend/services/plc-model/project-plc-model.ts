/**
 * Adapter: builds a PlcModelPort from a project store. Walks POU programs and the configuration's
 * global variables, flattens them into `ExportableVariable` for VPP screens to list. Scoped to
 * the RTOP-306 PoC — covers the top-level variables a Data Hub screen marks RO/RW.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import type { PlcModelPort } from '@root/middleware/shared/ports/plc-model-port'
import type { PLCPou, PLCVariable } from '@root/middleware/shared/ports/types'
import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'

function toExportable(qualifier: string, variable: PLCVariable): ExportableVariable {
  return {
    qualifier,
    type: variable.type.value.toUpperCase(),
    isWritable: true,
  }
}

function collectFromPou(pou: PLCPou): ExportableVariable[] {
  if (pou.pouType !== 'program') return []
  const variables = pou.interface?.variables ?? []
  return variables.map((variable) => toExportable(`${pou.name}.${variable.name}`, variable))
}

function collectGlobals(variables: PLCVariable[]): ExportableVariable[] {
  return variables.map((variable) => toExportable(`GVL.${variable.name}`, variable))
}

/**
 * Compact fingerprint of the model slice this port exposes. Compared string-wise on every store
 * commit; the subscription fires only when it changes, so edits in unrelated slices (editor tabs,
 * console, debugger) do not wake the VPP screens.
 */
function fingerprint(store: OpenPLCStore): string {
  const projectData = store.getState().project.data
  const pous = projectData.pous
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
      let last = fingerprint(store)
      return store.subscribe(() => {
        const next = fingerprint(store)
        if (next !== last) {
          last = next
          callback()
        }
      })
    },
  }
}
