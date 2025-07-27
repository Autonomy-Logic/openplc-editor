// utils/duplicate.ts

import { EditorModel, FBDFlowType, LadderFlowType, PouDTO } from '@root/renderer/store/slices'
import {
  PLCArrayDatatype,
  PLCDataType,
  PLCEnumeratedDatatype,
  PLCPou,
  PLCStructureDatatype,
} from '@root/types/PLC/open-plc'

export const generatePOUUniqueName = (label: string, existingNames: string[]) => {
  const baseName = label.replace(/ copy(?: \d+)?$/, '')
  let newName = `${baseName} copy`

  if (existingNames.includes(newName)) {
    let counter = 2
    while (existingNames.includes(`${baseName} copy ${counter}`)) {
      counter++
    }
    newName = `${baseName} copy ${counter}`
  }

  return newName
}

export const duplicateDataType = (
  original: PLCDataType,
  newName: string,
  createDatatype: (propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype) => boolean,
): boolean => {
  const clone = structuredClone(original)
  clone.name = newName

  switch (clone.derivation) {
    case 'array':
      return createDatatype({
        name: newName,
        derivation: 'array',
        baseType: clone.baseType,
        initialValue: clone.initialValue,
        dimensions: [...clone.dimensions],
      })

    case 'enumerated':
      return createDatatype({
        name: newName,
        derivation: 'enumerated',
        initialValue: clone.initialValue,
        values: [...clone.values],
      })

    case 'structure':
      return createDatatype({
        name: newName,
        derivation: 'structure',
        variable: [...clone.variable],
      })

    default:
      console.error(`Unknown derivation type: ${(clone as PLCDataType).derivation}`)
      return false
  }
}

export const duplicatePouAndEditor = (
  original: PLCPou,
  originalEditor: EditorModel,
  newName: string,
  createPou: (clone: PouDTO) => void,
  addModel: (model: EditorModel) => void,
  setEditor: (model: EditorModel) => void,
) => {
  const clone = structuredClone(original)
  clone.data.name = newName

  if (typeof clone.data.body.value === 'object' && 'name' in clone.data.body.value) {
    ;(clone.data.body.value as { name: string }).name = newName
  }

  createPou(clone)

  const cloneEditor = structuredClone(originalEditor)
  cloneEditor.meta.name = newName

  if ('path' in cloneEditor.meta && typeof cloneEditor.meta.path === 'string') {
    const parts = cloneEditor.meta.path.split('/')
    if (parts.length === 0) {
      console.warn('Invalid editor path format, cannot update path')
      return
    }
    parts[parts.length - 1] = newName
    cloneEditor.meta.path = parts.join('/')
  }

  addModel(cloneEditor)
  setEditor(cloneEditor)
}

export const duplicateGraphicalFlow = (
  label: string,
  newName: string,
  language: string,
  ladderFlows: LadderFlowType[],
  fbdFlows: FBDFlowType[],
  addLadderFlow: (flow: LadderFlowType) => void,
  addFBDFlow: (flow: FBDFlowType) => void,
): boolean => {
  switch (language) {
    case 'ld': {
      const originalFlow = ladderFlows.find((flow) => flow.name === label)
      if (!originalFlow) {
        console.error(`Ladder flow '${label}' not found`)
        return false
      }
      const flowClone = structuredClone(originalFlow)
      flowClone.name = newName
      flowClone.rungs = flowClone.rungs.map((rung) => ({
        ...structuredClone(rung),
        id: `rung_${newName}_${crypto.randomUUID()}`,
        selectedNodes: [],
      }))
      addLadderFlow(flowClone)
      return true
    }

    case 'fbd': {
      const originalFlow = fbdFlows.find((flow) => flow.name === label)
      if (!originalFlow) {
        console.error(`FBD flow '${label}' not found`)
        return false
      }
      const flowClone = structuredClone(originalFlow)
      flowClone.name = newName
      flowClone.rung = {
        ...structuredClone(flowClone.rung),
        selectedNodes: [],
      }
      addFBDFlow(flowClone)
      return true
    }

    default:
      console.error(`Unsupported language: ${language}`)
      return false
  }
}
