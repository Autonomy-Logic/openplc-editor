/**
 * Explain - This is a workaround to avoid the following error:
 * The ```@dnd-kit``` package is not correctly asserted by the lint tool.
 */

import type { UniqueIdentifier } from '@dnd-kit/core'
import {
  closestCenter,
  defaultDropAnimation,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import * as Portal from '@radix-ui/react-portal'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'

import { ladderSelectors } from '../../../../../../hooks/use-store-selectors'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../../../store'
import { RungLadderState, zodLadderFlowSchema } from '../../../../../../store/slices/ladder'
import type { PouHistorySnapshot } from '../../../../../../store/slices/shared/types'
import { cn } from '../../../../../../utils/cn'
import { BlockNode, BlockNodeData } from '../../../../../_atoms/graphical-editor/ladder/block'
import { CoilNode } from '../../../../../_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '../../../../../_atoms/graphical-editor/ladder/contact'
import { BlockVariant } from '../../../../../_atoms/graphical-editor/types/block'
import { CreateRung } from '../../../../../_molecules/graphical-editor/ladder/rung/create-rung'
import { Rung } from '../../../../../_organisms/graphical-editor/ladder/rung'
import { useBoundPou } from '../active-context'
import BlockElement from '../elements/ladder/block'
import CoilElement from '../elements/ladder/coil'
import ContactElement from '../elements/ladder/contact'

export default function LadderEditor() {
  // Bound POU comes from the `GraphicalEditorActiveProvider` set up
  // in the wrapper one level up.  Mirrors `FbdEditor` — see that
  // file for the multi-mount rationale.
  const pouName = useBoundPou()
  const {
    ladderFlows,
    ladderFlowActions,
    searchNodePosition,
    modals,
    project: {
      data: { pous },
    },
    projectActions: { updatePou },
    modalActions: { closeModal },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    snapshotActions: { pushToHistory },
    libraries: { user: userLibraries },
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()

  const captureSnapshot = useCallback(
    (pouName: string): PouHistorySnapshot | null => {
      const pou = pous.find((p) => p.name === pouName)
      if (!pou) return null
      return {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: openPLCStoreBase.getState().project.data.configurations.resource.globalVariables,
      }
    },
    [pous],
  )

  const updateModelLadder = ladderSelectors.useUpdateModelLadder()

  const flow = ladderFlows.find((flow) => flow.name === pouName)
  const rungs = flow?.rungs || []
  const flowUpdated = flow?.updated || false

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [activeItem, setActiveItem] = useState<RungLadderState | null>(null)
  const nodeDivergences = getLibraryDivergences()

  const scrollableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollableRef.current) {
      scrollableRef.current.scrollTo({
        top: searchNodePosition.y,
        left: searchNodePosition.x,
        behavior: 'smooth',
      })
    }
  }, [searchNodePosition])

  /**
   * Update the flow state to project JSON.
   *
   * Validate the flow with Zod but persist the raw object (minus the
   * transient `updated` flag). Using the parsed result would silently strip
   * every field not declared in `zodLadderFlowSchema` (e.g. `handleBranches`,
   * `positionAbsolute`, `zIndex`) and reorder keys to schema order, which
   * makes `serializeGraphicalPouToString` produce byte-drift vs. the loaded
   * disk copy — surfacing as phantom "Modified" entries in Source Control
   * for POUs the user never edited.
   */
  useEffect(() => {
    if (!flowUpdated || !flow) return

    const flowSchema = zodLadderFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    const { updated: _updated, ...flowBody } = flow
    updatePou({
      name: pouName,
      content: {
        language: 'ld',
        value: structuredClone(flowBody),
      },
    })

    ladderFlowActions.setFlowUpdated({ editorName: pouName, updated: false })

    if (!isDebuggerVisible) {
      handleFileAndWorkspaceSavedState(pouName)
    }
  }, [flowUpdated])

  const getRungPos = (rungId: UniqueIdentifier) => rungs.findIndex((rung) => rung.id === rungId)

  const handleDragStart = (event: DragStartEvent) => {
    if (isDebuggerVisible) return

    const { active } = event
    setActiveId(active.id)
    setActiveItem(rungs.find((rung) => rung.id === active.id) || null)
  }

  const handleAddNewRung = () => {
    if (isDebuggerVisible) return

    const snapshot = captureSnapshot(pouName)
    if (snapshot) pushToHistory(pouName, snapshot)

    const defaultViewport: [number, number] = [300, 100]

    const rungIdToBeAdded = `rung_${pouName}_${uuidv4()}`

    ladderFlowActions.startLadderRung({
      editorName: pouName,
      rungId: rungIdToBeAdded,
      defaultBounds: defaultViewport,
      reactFlowViewport: defaultViewport,
    })
    updateModelLadder({ openRung: { rungId: rungIdToBeAdded, open: true } })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    if (isDebuggerVisible) {
      setActiveId(null)
      setActiveItem(null)
      return
    }

    const { active, over } = event

    setActiveId(null)
    setActiveItem(null)

    if (!flow) {
      console.error('Flow is undefined')
      return
    }

    if (!active || !over) {
      console.error('Active or over is undefined')
      return
    }

    if (active.id === over.id) return

    const sourceIndex = getRungPos(active.id)
    const destinationIndex = getRungPos(over.id)

    if (
      sourceIndex < 0 ||
      destinationIndex < 0 ||
      sourceIndex >= flow.rungs.length ||
      destinationIndex >= flow.rungs.length
    ) {
      console.error('Invalid source or destination index')
      return
    }

    const auxRungs = [...(flow?.rungs || [])]
    // Store the original state for recovery
    const originalRungs = [...auxRungs]
    const [removed] = auxRungs.splice(sourceIndex, 1)
    auxRungs.splice(destinationIndex, 0, removed)

    try {
      const snapshot = captureSnapshot(pouName)
      if (snapshot) pushToHistory(pouName, snapshot)
      ladderFlowActions.setRungs({ editorName: pouName, rungs: auxRungs })
    } catch (error) {
      console.error('Failed to update rungs:', error)
      // Recover the original state
      ladderFlowActions.setRungs({ editorName: pouName, rungs: originalRungs })
      // Notify the user
      console.error('Failed to reorder rungs. The operation has been reverted.')
    }
  }

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    closeModal()
  }

  function getLibraryDivergences() {
    if (!flow) return []

    const divergences = []

    for (const rung of flow.rungs) {
      for (const node of rung.nodes) {
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
            ['input', 'output', 'inOut'].includes(variable.class || '') &&
            !['OUT', 'EN', 'ENO'].includes(variable.name),
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
            divergences.push(`${rung.id}:${node.id}`)
            continue
          }
        }

        const currentMap = new Map(currentVariables.map((variable) => [formatVariable(variable), true]))
        const hasDivergence =
          originalInOut?.length !== currentVariables.length ||
          !originalInOut?.every((variable) => currentMap.has(formatVariable(variable)))

        if (hasDivergence) {
          divergences.push(`${rung.id}:${node.id}`)
        }
      }
    }

    return divergences
  }

  return (
    <div className='h-full w-full overflow-y-auto' ref={scrollableRef} style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 px-2'>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
          <div
            className={cn({
              'h-fit rounded-lg border dark:border-neutral-800': rungs.length > 0,
            })}
          >
            <SortableContext items={rungs} strategy={verticalListSortingStrategy}>
              {rungs.map((rung, index) => (
                <Rung
                  key={rung.id}
                  id={rung.id}
                  index={index}
                  rung={rung}
                  className={cn({
                    'opacity-35': activeId === rung.id,
                  })}
                  nodeDivergences={nodeDivergences}
                  isDebuggerActive={isDebuggerVisible}
                />
              ))}
            </SortableContext>
            {createPortal(
              <DragOverlay dropAnimation={defaultDropAnimation} modifiers={[restrictToParentElement]}>
                {activeId && activeItem ? (
                  <Rung key={activeItem.id} id={activeItem.id} rung={activeItem} index={-1} />
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </div>
        </DndContext>
        <CreateRung onClick={handleAddNewRung} />
        <Portal.Root>
          {modals['block-ladder-element']?.open && (
            <BlockElement
              onClose={handleModalClose}
              selectedNode={modals['block-ladder-element'].data as BlockNode<BlockVariant>}
              isOpen={modals['block-ladder-element'].open}
            />
          )}
          {modals['contact-ladder-element']?.open && (
            <ContactElement
              onClose={handleModalClose}
              node={modals['contact-ladder-element'].data as ContactNode}
              isOpen={modals['contact-ladder-element'].open}
            />
          )}
          {modals['coil-ladder-element']?.open && (
            <CoilElement
              onClose={handleModalClose}
              node={modals['coil-ladder-element'].data as CoilNode}
              isOpen={modals['coil-ladder-element'].open}
            />
          )}
        </Portal.Root>
      </div>
    </div>
  )
}
