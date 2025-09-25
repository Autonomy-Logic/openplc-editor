import { BlockNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
import { FBDBody } from '@root/renderer/components/_molecules/graphical-editor/fbd'
import { useOpenPLCStore } from '@root/renderer/store'
import { zodFBDFlowSchema } from '@root/renderer/store/slices'
import { useEffect } from 'react'

export default function FbdEditor() {
  const {
    editor,
    fbdFlows,
    project: {
      data: { pous },
    },
    libraries: { user: userLibraries },
    fbdFlowActions,
    projectActions: { updatePou },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const flow = fbdFlows.find((flow) => flow.name === editor.meta.name)
  const flowUpdated = flow?.updated || false
  const nodeDivergences = getLibraryDivergences()

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    if (!flowUpdated) return

    const flowSchema = zodFBDFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: editor.meta.name,
      content: {
        language: 'fbd',
        value: flowSchema.data,
      },
    })

    fbdFlowActions.setFlowUpdated({ editorName: editor.meta.name, updated: false })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }, [flowUpdated])

  function getLibraryDivergences() {
    if (!flow) return []

    const divergences = []

    for (const node of flow.rung.nodes) {
      const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
      if (!variant) continue

      const libMatch = userLibraries.find((lib) => lib.name === variant.name && lib.type === variant.type)
      if (!libMatch) continue

      const original = pous.find((pou) => pou.data.name === libMatch.name)?.data?.variables
      const currentVariables = variant.variables.filter((variable) => !['OUT', 'EN', 'ENO'].includes(variable.name))

      const formatVariable = (variable: {
        name: string
        class?: string
        type: { definition: string; value: string }
      }) => `${variable.name}|${variable.class}|${variable.type.definition}|${variable.type.value?.toLowerCase()}`

      const currentMap = new Map(currentVariables.map((variable) => [formatVariable(variable), true]))

      const hasDivergence =
        original?.length !== currentVariables.length ||
        !original?.every((variable) => currentMap.has(formatVariable(variable)))

      if (hasDivergence) {
        divergences.push(node.id)
      }
    }

    return divergences
  }

  return (
    <div className='h-full w-full'>
      {flow?.rung ? (
        <FBDBody rung={flow?.rung} nodeDivergences={nodeDivergences} />
      ) : (
        <span>No rung found for editor</span>
      )}
    </div>
  )
}
