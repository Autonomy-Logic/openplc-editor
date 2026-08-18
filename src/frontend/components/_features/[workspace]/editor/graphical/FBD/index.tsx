import { useEffect, useMemo } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { scheduleFlowWriteBack } from '../../../../../../store/slices/shared/flow-writeback'
import { hasLegacyInOutOutputHandle } from '../../../../../../utils/graphical/in-out-pin-rules'
import { BlockNodeData } from '../../../../../_atoms/graphical-editor/fbd/block'
import { BlockVariant } from '../../../../../_atoms/graphical-editor/types/block'
import { FBDBody } from '../../../../../_molecules/graphical-editor/fbd'
import { useBoundPou } from '../active-context'

const EMPTY_DIVERGENCES: string[] = []

export default function FbdEditor() {
  // Bound POU comes from the `GraphicalEditorActiveProvider` set up
  // in the wrapper one level up.  With multi-mount, every open FBD
  // POU has its own FbdEditor instance — the context is what tells
  // each instance which POU's flow to operate on, instead of all of
  // them collapsing to the globally-active editor.
  const pouName = useBoundPou()
  const fbdFlows = useOpenPLCStore((state) => state.fbdFlows)
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const userLibraries = useOpenPLCStore((state) => state.libraries.user)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const flow = fbdFlows.find((flow) => flow.name === pouName)
  const flowUpdated = flow?.updated || false

  const nodeDivergences = useMemo(() => {
    if (!flow) return EMPTY_DIVERGENCES

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
        !originalInOut?.every((variable) => currentMap.has(formatVariable(variable))) ||
        // The declarations can agree while the persisted GEOMETRY is stale: a diagram saved
        // before a VAR_IN_OUT pin became input-only still carries the pin's output side. The
        // interface never changed, so the comparison above cannot see it.
        hasLegacyInOutOutputHandle(node)

      if (hasDivergence) {
        divergences.push(node.id)
      }
    }

    return divergences.length > 0 ? divergences : EMPTY_DIVERGENCES
  }, [flow?.rung.nodes, userLibraries, pous])

  /**
   * Queue the flow → project JSON write-back. The scheduler debounces it
   * (edits inside the window coalesce), persists the raw flow object, and
   * clears the `updated` flag; save paths flush it so a save landing inside
   * the window still serializes the fresh body. Validation and the DOPE-477
   * raw-object policy live in store/slices/shared/flow-writeback.ts.
   */
  useEffect(() => {
    if (!flowUpdated) return
    scheduleFlowWriteBack(useOpenPLCStore.getState, pouName, 'fbd')
  }, [flowUpdated])

  return (
    <div className='h-full w-full'>
      {flow?.rung ? (
        <FBDBody rung={flow?.rung} nodeDivergences={nodeDivergences} isDebuggerActive={isDebuggerVisible} />
      ) : (
        <span>No rung found for editor</span>
      )}
    </div>
  )
}
