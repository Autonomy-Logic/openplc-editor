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
) => {
  const clone = structuredClone(original)
  clone.name = newName

  switch (clone.derivation) {
    case 'array':
      createDatatype({
        name: newName,
        derivation: 'array',
        baseType: clone.baseType,
        initialValue: clone.initialValue,
        dimensions: [...clone.dimensions],
      })
      break

    case 'enumerated':
      createDatatype({
        name: newName,
        derivation: 'enumerated',
        initialValue: clone.initialValue,
        values: [...clone.values],
      })
      break

    case 'structure':
      createDatatype({
        name: newName,
        derivation: 'structure',
        variable: [...clone.variable],
      })
      break
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
    clone.data.body.value.name = newName
  }

  createPou(clone)

  const cloneEditor = structuredClone(originalEditor)
  cloneEditor.meta.name = newName

  if ('path' in cloneEditor.meta && typeof cloneEditor.meta.path === 'string') {
    const parts = cloneEditor.meta.path.split('/')
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
) => {
  if (language === 'ld') {
    const originalFlow = ladderFlows.find((flow) => flow.name === label)
    if (originalFlow) {
      const flowClone = structuredClone(originalFlow)
      flowClone.name = newName
      flowClone.rungs = flowClone.rungs.map((rung) => ({
        ...structuredClone(rung),
        id: `rung_${newName}_${crypto.randomUUID()}`,
        selectedNodes: [],
      }))
      addLadderFlow(flowClone)
    }
  }

  if (language === 'fbd') {
    const originalFlow = fbdFlows.find((flow) => flow.name === label)
    if (originalFlow) {
      const flowClone = structuredClone(originalFlow)
      flowClone.name = newName
      flowClone.rung = {
        ...structuredClone(flowClone.rung),
        selectedNodes: [],
      }
      addFBDFlow(flowClone)
    }
  }
}
