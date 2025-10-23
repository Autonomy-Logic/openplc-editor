import type { FBDFlowState, LadderFlowState } from '@root/renderer/store/slices'
import type { PLCPou, PLCVariable } from '@root/types/PLC/open-plc'
import type { Node } from '@xyflow/react'

export type VariableReferenceLocation = {
  pouName: string
  editorType: 'ladder' | 'fbd' | 'st' | 'il' | 'python' | 'cpp'
  nodeId?: string
  rungId?: string
  elementType?: 'contact' | 'coil' | 'block-instance' | 'block-connection' | 'variable'
  connectionIndex?: number
  lineNumber?: number
  columnStart?: number
  columnEnd?: number
}

export type ReferenceImpactAnalysis = {
  totalReferences: number
  byPou: Map<string, number>
  byEditorType: Map<string, number>
  references: VariableReferenceLocation[]
}

export function findAllReferencesToVariable(
  variableName: string,
  _variableType: PLCVariable['type'],
  pouName: string,
  pous: PLCPou[],
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  scope?: 'local' | 'global',
): ReferenceImpactAnalysis {
  const normalizedName = variableName.toLowerCase()
  const references: VariableReferenceLocation[] = []

  const isGlobalScope = scope === 'global'

  if (!isGlobalScope) {
    const pou = pous.find((p) => p.data.name === pouName)
    if (!pou) {
      return {
        totalReferences: 0,
        byPou: new Map(),
        byEditorType: new Map(),
        references: [],
      }
    }

    searchWithinPou(pou, pouName, normalizedName, variableName, ladderFlows, fbdFlows, references)
  } else {
    pous.forEach((pou) => {
      const hasExternalVar = pou.data.variables.some(
        (v) => v.class === 'external' && v.name.toLowerCase() === normalizedName,
      )

      if (hasExternalVar) {
        searchWithinPou(pou, pou.data.name, normalizedName, variableName, ladderFlows, fbdFlows, references)
      }
    })
  }

  const byPou = new Map<string, number>()
  const byEditorType = new Map<string, number>()

  references.forEach((ref) => {
    byPou.set(ref.pouName, (byPou.get(ref.pouName) || 0) + 1)
    byEditorType.set(ref.editorType, (byEditorType.get(ref.editorType) || 0) + 1)
  })

  return {
    totalReferences: references.length,
    byPou,
    byEditorType,
    references,
  }
}

function searchWithinPou(
  pou: PLCPou,
  pouName: string,
  normalizedName: string,
  variableName: string,
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  references: VariableReferenceLocation[],
): void {
  const ladderFlow = ladderFlows.find((f) => f.name === pouName)
  if (ladderFlow) {
    ladderFlow.rungs.forEach((rung) => {
      rung.nodes.forEach((node) => {
        if (node.type === 'contact' || node.type === 'coil') {
          const data = node.data as { variable?: PLCVariable | { name?: string } }
          if (data.variable?.name?.toLowerCase() === normalizedName) {
            references.push({
              pouName,
              editorType: 'ladder',
              nodeId: node.id,
              rungId: rung.id,
              elementType: node.type,
            })
          }
        }

        if (node.type === 'block') {
          const data = node.data as {
            variable?: PLCVariable | { name?: string }
            connectedVariables?: Array<{
              handleId: string
              variable?: PLCVariable
            }>
          }

          if (data.variable?.name?.toLowerCase() === normalizedName) {
            references.push({
              pouName,
              editorType: 'ladder',
              nodeId: node.id,
              rungId: rung.id,
              elementType: 'block-instance',
            })
          }

          data.connectedVariables?.forEach((conn, index) => {
            if (conn.variable?.name?.toLowerCase() === normalizedName) {
              references.push({
                pouName,
                editorType: 'ladder',
                nodeId: node.id,
                rungId: rung.id,
                elementType: 'block-connection',
                connectionIndex: index,
              })
            }
          })
        }

        if (node.type === 'variable') {
          const data = node.data as { variable?: PLCVariable | { name?: string } }
          if (data.variable?.name?.toLowerCase() === normalizedName) {
            references.push({
              pouName,
              editorType: 'ladder',
              nodeId: node.id,
              rungId: rung.id,
              elementType: 'variable',
            })
          }
        }
      })
    })
  }

  const fbdFlow = fbdFlows.find((f) => f.name === pouName)
  if (fbdFlow) {
    fbdFlow.rung.nodes.forEach((node) => {
      if (node.type === 'contact' || node.type === 'coil') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable?.name?.toLowerCase() === normalizedName) {
          references.push({
            pouName,
            editorType: 'fbd',
            nodeId: node.id,
            elementType: node.type,
          })
        }
      }

      if (node.type === 'block') {
        const data = node.data as {
          variable?: PLCVariable | { name?: string }
          connectedVariables?: Array<{
            handleId: string
            variable?: PLCVariable
          }>
        }

        if (data.variable?.name?.toLowerCase() === normalizedName) {
          references.push({
            pouName,
            editorType: 'fbd',
            nodeId: node.id,
            elementType: 'block-instance',
          })
        }

        data.connectedVariables?.forEach((conn, index) => {
          if (conn.variable?.name?.toLowerCase() === normalizedName) {
            references.push({
              pouName,
              editorType: 'fbd',
              nodeId: node.id,
              elementType: 'block-connection',
              connectionIndex: index,
            })
          }
        })
      }

      if (node.type === 'variable') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable?.name?.toLowerCase() === normalizedName) {
          references.push({
            pouName,
            editorType: 'fbd',
            nodeId: node.id,
            elementType: 'variable',
          })
        }
      }
    })
  }

  if (
    pou.data.body.language === 'st' ||
    pou.data.body.language === 'il' ||
    pou.data.body.language === 'python' ||
    pou.data.body.language === 'cpp'
  ) {
    const bodyValue = pou.data.body.value
    const lines = bodyValue.split('\n')
    const variablePattern = new RegExp(`\\b${variableName}\\b`, 'gi')

    lines.forEach((line, lineIndex) => {
      let match
      while ((match = variablePattern.exec(line)) !== null) {
        references.push({
          pouName,
          editorType: pou.data.body.language as 'st' | 'il' | 'python' | 'cpp',
          lineNumber: lineIndex + 1,
          columnStart: match.index,
          columnEnd: match.index + variableName.length,
        })
      }
    })
  }
}

export function propagateVariableTypeChange(
  variableName: string,
  newType: PLCVariable['type'],
  pous: PLCPou[],
  projectActions: {
    updateVariable: (params: {
      scope: 'local' | 'global'
      rowId: number
      associatedPou?: string
      data: Partial<PLCVariable>
    }) => void
  },
): void {
  pous.forEach((pou) => {
    pou.data.variables.forEach((variable, varIndex) => {
      if (variable.class === 'external' && variable.name.toLowerCase() === variableName.toLowerCase()) {
        projectActions.updateVariable({
          scope: 'local',
          rowId: varIndex,
          associatedPou: pou.data.name,
          data: { type: newType },
        })
      }
    })
  })
}

export function propagateVariableRename(
  oldName: string,
  newName: string,
  references: VariableReferenceLocation[],
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
  pous: PLCPou[],
  ladderFlowActions: {
    updateNode: (params: { editorName: string; rungId: string; nodeId: string; node: Node }) => void
  },
  fbdFlowActions: {
    updateNode: (params: { editorName: string; nodeId: string; node: Node }) => void
  },
  projectActions: {
    updatePou: (params: { name: string; content: PLCPou['data']['body'] }) => void
    updateVariable: (params: {
      scope: 'local' | 'global'
      rowId: number
      associatedPou?: string
      data: Partial<PLCVariable>
    }) => void
  },
  scope?: 'local' | 'global',
): void {
  if (scope === 'global') {
    pous.forEach((pou) => {
      pou.data.variables.forEach((variable, varIndex) => {
        if (variable.class === 'external' && variable.name.toLowerCase() === oldName.toLowerCase()) {
          projectActions.updateVariable({
            scope: 'local',
            rowId: varIndex,
            associatedPou: pou.data.name,
            data: { name: newName },
          })
        }
      })
    })
  }

  const textBasedRefsByPou = new Map<string, VariableReferenceLocation[]>()
  const graphicalRefs: VariableReferenceLocation[] = []

  references.forEach((ref) => {
    if (ref.editorType === 'st' || ref.editorType === 'il' || ref.editorType === 'python' || ref.editorType === 'cpp') {
      const pouRefs = textBasedRefsByPou.get(ref.pouName) || []
      pouRefs.push(ref)
      textBasedRefsByPou.set(ref.pouName, pouRefs)
    } else {
      graphicalRefs.push(ref)
    }
  })

  textBasedRefsByPou.forEach((_refs, pouName) => {
    const pou = pous.find((p) => p.data.name === pouName)
    if (!pou) return

    const bodyValue = pou.data.body.value
    if (typeof bodyValue !== 'string') return

    const language = pou.data.body.language
    if (language !== 'st' && language !== 'il' && language !== 'python' && language !== 'cpp') return

    try {
      const variablePattern = new RegExp(`\\b${oldName}\\b`, 'g')
      const updatedBody = bodyValue.replace(variablePattern, newName)

      projectActions.updatePou({
        name: pouName,
        content: {
          language,
          value: updatedBody,
        },
      })
    } catch (error) {
      console.error('Error updating POU body:', error)
    }
  })

  graphicalRefs.forEach((ref) => {
    if (ref.editorType === 'ladder' && ref.nodeId && ref.rungId) {
      const flow = ladderFlows.find((f) => f.name === ref.pouName)
      if (!flow) return

      const rung = flow.rungs.find((r) => r.id === ref.rungId)
      if (!rung) return

      const node = rung.nodes.find((n) => n.id === ref.nodeId)
      if (!node) return

      if (ref.elementType === 'contact' || ref.elementType === 'coil' || ref.elementType === 'variable') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable) {
          ladderFlowActions.updateNode({
            editorName: ref.pouName,
            rungId: ref.rungId,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...data.variable, name: newName },
              },
            },
          })
        }
      } else if (ref.elementType === 'block-instance') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable) {
          ladderFlowActions.updateNode({
            editorName: ref.pouName,
            rungId: ref.rungId,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...data.variable, name: newName },
              },
            },
          })
        }
      } else if (ref.elementType === 'block-connection' && ref.connectionIndex !== undefined) {
        const data = node.data as {
          connectedVariables?: Array<{
            handleId: string
            variable?: PLCVariable
          }>
        }
        if (
          data.connectedVariables &&
          data.connectedVariables[ref.connectionIndex] &&
          data.connectedVariables[ref.connectionIndex].variable
        ) {
          const updatedConnectedVariables = [...data.connectedVariables]
          const currentVariable = updatedConnectedVariables[ref.connectionIndex].variable as PLCVariable
          updatedConnectedVariables[ref.connectionIndex] = {
            ...updatedConnectedVariables[ref.connectionIndex],
            variable: {
              ...currentVariable,
              name: newName,
            },
          }
          ladderFlowActions.updateNode({
            editorName: ref.pouName,
            rungId: ref.rungId,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                connectedVariables: updatedConnectedVariables,
              },
            },
          })
        }
      }
    } else if (ref.editorType === 'fbd' && ref.nodeId) {
      const flow = fbdFlows.find((f) => f.name === ref.pouName)
      if (!flow) return

      const node = flow.rung.nodes.find((n) => n.id === ref.nodeId)
      if (!node) return

      if (ref.elementType === 'contact' || ref.elementType === 'coil' || ref.elementType === 'variable') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable) {
          fbdFlowActions.updateNode({
            editorName: ref.pouName,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...data.variable, name: newName },
              },
            },
          })
        }
      } else if (ref.elementType === 'block-instance') {
        const data = node.data as { variable?: PLCVariable | { name?: string } }
        if (data.variable) {
          fbdFlowActions.updateNode({
            editorName: ref.pouName,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...data.variable, name: newName },
              },
            },
          })
        }
      } else if (ref.elementType === 'block-connection' && ref.connectionIndex !== undefined) {
        const data = node.data as {
          connectedVariables?: Array<{
            handleId: string
            variable?: PLCVariable
          }>
        }
        if (
          data.connectedVariables &&
          data.connectedVariables[ref.connectionIndex] &&
          data.connectedVariables[ref.connectionIndex].variable
        ) {
          const updatedConnectedVariables = [...data.connectedVariables]
          const currentVariable = updatedConnectedVariables[ref.connectionIndex].variable as PLCVariable
          updatedConnectedVariables[ref.connectionIndex] = {
            ...updatedConnectedVariables[ref.connectionIndex],
            variable: {
              ...currentVariable,
              name: newName,
            },
          }
          fbdFlowActions.updateNode({
            editorName: ref.pouName,
            nodeId: ref.nodeId,
            node: {
              ...node,
              data: {
                ...node.data,
                connectedVariables: updatedConnectedVariables,
              },
            },
          })
        }
      }
    }
  })
}

export function validateVariableReference(
  variableName: string,
  expectedType: PLCVariable['type'],
  variables: PLCVariable[],
): { isValid: boolean; variable?: PLCVariable; error?: string } {
  const normalizedName = variableName.toLowerCase()
  const variable = variables.find((v) => v.name.toLowerCase() === normalizedName)

  if (!variable) {
    return {
      isValid: false,
      error: `Variable '${variableName}' not found`,
    }
  }

  const typeMatches =
    variable.type.definition === expectedType.definition &&
    variable.type.value.toUpperCase() === expectedType.value.toUpperCase()

  if (!typeMatches) {
    return {
      isValid: false,
      variable,
      error: `Type mismatch: expected ${expectedType.value}, got ${variable.type.value}`,
    }
  }

  return {
    isValid: true,
    variable,
  }
}
