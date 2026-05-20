import { useEffect, useMemo } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { zodFBDFlowSchema } from '../../../../../../store/slices/fbd'
import { BlockNodeData } from '../../../../../_atoms/graphical-editor/fbd/block'
import { BlockVariant } from '../../../../../_atoms/graphical-editor/types/block'
import { FBDBody } from '../../../../../_molecules/graphical-editor/fbd'

interface FbdEditorProps {
  /**
   * POU name this FbdEditor instance is bound to.  With multi-mount,
   * every open FBD POU has its own FbdEditor that must look up its
   * OWN flow — not whichever POU happens to be active in the store.
   * Without this prop the ReactFlow inside would render the active
   * POU's nodes inside every hidden FbdEditor too, and the viewport
   * the user set while a POU was visible would get clobbered on
   * subsequent tab switches.  Defaults to the active editor's name
   * for legacy callers.
   */
  name?: string
}

export default function FbdEditor({ name: propName }: FbdEditorProps = {}) {
  const activeEditorName = useOpenPLCStore((state) => state.editor.meta.name)
  const pouName = propName ?? activeEditorName
  const fbdFlows = useOpenPLCStore((state) => state.fbdFlows)
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const userLibraries = useOpenPLCStore((state) => state.libraries.user)
  const fbdFlowActions = useOpenPLCStore((state) => state.fbdFlowActions)
  const updatePou = useOpenPLCStore((state) => state.projectActions.updatePou)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (state) => state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const flow = fbdFlows.find((flow) => flow.name === pouName)
  const flowUpdated = flow?.updated || false

  const nodeDivergences = useMemo(() => {
    if (!flow) return []

    const divergences = []

    for (const node of flow.rung.nodes) {
      const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
      if (!variant) continue

      const libMatch = userLibraries.find((lib) => lib.name === variant.name && lib.type === variant.type)
      if (!libMatch) continue

      const originalPou = pous.find((pou) => pou.name === libMatch.name)
      if (!originalPou) continue

      const originalVariables = originalPou.interface?.variables ?? []
      const originalInOut = originalVariables.filter((variable) =>
        ['input', 'output', 'inOut'].includes(variable.class || ''),
      )

      const currentVariables = variant.variables.filter(
        (variable) =>
          ['input', 'output', 'inOut'].includes(variable.class || '') && !['OUT', 'EN', 'ENO'].includes(variable.name),
      )

      const formatVariable = (variable: {
        name: string
        class?: string
        type: { definition: string; value: string }
      }) => `${variable.name}|${variable.class}|${variable.type.definition}|${variable.type.value?.toLowerCase()}`

      if (originalPou.pouType === 'function') {
        const outVariable = variant.variables.find((v) => v.name === 'OUT')
        const outType = outVariable?.type?.value?.toUpperCase()
        const returnType = originalPou.interface?.returnType?.toUpperCase()
        if (!outType || !returnType || outType !== returnType) {
          divergences.push(node.id)
          continue
        }
      }

      const currentMap = new Map(currentVariables.map((variable) => [formatVariable(variable), true]))
      const hasDivergence =
        originalInOut?.length !== currentVariables.length ||
        !originalInOut?.every((variable) => currentMap.has(formatVariable(variable)))

      if (hasDivergence) {
        divergences.push(node.id)
      }
    }

    return divergences
  }, [flow?.rung.nodes, userLibraries, pous])

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    if (!flowUpdated) return

    const flowSchema = zodFBDFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: pouName,
      content: {
        language: 'fbd',
        value: flowSchema.data,
      },
    })

    fbdFlowActions.setFlowUpdated({ editorName: pouName, updated: false })

    if (!isDebuggerVisible) {
      handleFileAndWorkspaceSavedState(pouName)
    }
  }, [flowUpdated])

  return (
    <div className='h-full w-full'>
      {flow?.rung ? (
        <FBDBody
          pouName={pouName}
          rung={flow?.rung}
          nodeDivergences={nodeDivergences}
          isDebuggerActive={isDebuggerVisible}
        />
      ) : (
        <span>No rung found for editor</span>
      )}
    </div>
  )
}
