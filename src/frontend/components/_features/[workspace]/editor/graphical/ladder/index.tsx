import type { UniqueIdentifier } from '@dnd-kit/core'
import {
  closestCenter,
  defaultDropAnimation,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import * as Portal from '@radix-ui/react-portal'
import { LADDER_STYLE, withLaidOutGeometry } from '@root/middleware/shared/utils/ladder-layout'
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'

import { useIsEditingLocked } from '../../../../../../hooks/use-editing-lock'
import { useGraphicalFocus } from '../../../../../../hooks/use-graphical-focus'
import { usePouSnapshot } from '../../../../../../hooks/use-pou-snapshot'
import { ladderSelectors } from '../../../../../../hooks/use-store-selectors'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../../../store'
import { RungLadderState } from '../../../../../../store/slices/ladder'
import { graphicalElementModalFor } from '../../../../../../store/slices/modal'
import { scheduleFlowWriteBack } from '../../../../../../store/slices/shared/flow-writeback'
import { cn } from '../../../../../../utils/cn'
import { hasLegacyInOutOutputHandle } from '../../../../../../utils/graphical/in-out-pin-rules'
import { BlockNode, BlockNodeData } from '../../../../../_atoms/graphical-editor/ladder/block'
import { CoilNode } from '../../../../../_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '../../../../../_atoms/graphical-editor/ladder/contact'
import { useLadderThemePalette } from '../../../../../_atoms/graphical-editor/ladder/rung-view'
import { BlockVariant } from '../../../../../_atoms/graphical-editor/types/block'
import { EndRung } from '../../../../../_molecules/graphical-editor/ladder/rung/end-rung'
import {
  LadderPouCanvasProvider,
  useLadderPouCanvasValue,
} from '../../../../../_molecules/graphical-editor/ladder/rung/pou-canvas'
import { Rung } from '../../../../../_organisms/graphical-editor/ladder/rung'
import { useBoundPou } from '../active-context'
import BlockElement from '../elements/ladder/block'
import CoilElement from '../elements/ladder/coil'
import ContactElement from '../elements/ladder/contact'
import { useGraphicalPlacement } from '../placement/placement-context'
import { moveRungs, nextRungSelection, type RungSelectOptions } from './rung-selection'

const EMPTY_DIVERGENCES: string[] = []

/** The visible width of the element in `ref`, followed as it resizes; 0 until it is measured. Display only. */

/**
 * Height of the space below a ladder diagram that lets its last rung scroll up to the top of the scroll container `ref`:
 * the container's height less the last rung's and the End row's, followed as either resizes. Display only.
 */
function useScrollPastEnd(ref: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const container = ref.current
    const diagram = content.current
    if (!container || !diagram) return
    const measure = () => {
      const rungs = diagram.querySelectorAll('[aria-label="Rung container"]')
      const last = rungs.length > 0 ? rungs[rungs.length - 1] : undefined
      const end = diagram.querySelector('[aria-label="Create new rung"]')
      const tail = (last?.getBoundingClientRect().height ?? 0) + (end?.getBoundingClientRect().height ?? 0)
      setHeight(Math.max(0, container.clientHeight - tail - DIAGRAM_GAP))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(diagram)
    return () => observer.disconnect()
  }, [ref, content])
  return height
}

/** Gap between the diagram and what follows it in the editor column (`gap-4`), in px. */
const DIAGRAM_GAP = 16

/** Stroke width of the POU's power rails, as each rung draws them. */
const RAIL_STROKE = 2.5
function useVisibleWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export default function LadderEditor() {
  const store = useOpenPLCStoreApi()
  const pouName = useBoundPou()
  const flow = useOpenPLCStore((state) => state.ladderFlows.find((f) => f.name === pouName))
  const ladderFlowActions = useOpenPLCStore((state) => state.ladderFlowActions)
  const searchNodePosition = useOpenPLCStore((state) => state.searchNodePosition)
  const blockElementModal = useOpenPLCStore((state) => state.modals['block-ladder-element'])
  const contactElementModal = useOpenPLCStore((state) => state.modals['contact-ladder-element'])
  const coilElementModal = useOpenPLCStore((state) => state.modals['coil-ladder-element'])
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const closeModal = useOpenPLCStore((state) => state.modalActions.closeModal)
  const userLibraries = useOpenPLCStore((state) => state.libraries.user)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const blockElement = graphicalElementModalFor(blockElementModal, pouName)
  const contactElement = graphicalElementModalFor(contactElementModal, pouName)
  const coilElement = graphicalElementModalFor(coilElementModal, pouName)

  const { captureAndPush } = usePouSnapshot()
  const placement = useGraphicalPlacement()

  const updateModelLadder = ladderSelectors.useUpdateModelLadder()

  const rungs = useMemo(() => flow?.rungs ?? [], [flow?.rungs])
  const flowUpdated = flow?.updated || false

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [activeItem, setActiveItem] = useState<RungLadderState | null>(null)
  const [selectedRungIds, setSelectedRungIds] = useState<string[]>([])
  // The rung whose elements are selected, if any: selecting an element selects its rung alone.
  const elementRungId = useOpenPLCStore(
    (state) =>
      state.ladderFlows
        .find((candidate) => candidate.name === pouName)
        ?.rungs.find((rung) => (rung.selectedNodes?.length ?? 0) > 0)?.id ?? null,
  )
  useEffect(() => {
    if (elementRungId === null) return
    setSelectedRungIds((current) => (current.length === 1 && current[0] === elementRungId ? current : [elementRungId]))
  }, [elementRungId])
  const [editingCommentRungId, setEditingCommentRungId] = useState<string | null>(null)
  const isEditingLocked = useIsEditingLocked()
  const palette = useLadderThemePalette()
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const getIsRungOpen = useOpenPLCStore((state) => state.editorActions.getIsRungOpen)

  const nodeDivergences = useMemo(() => {
    if (!flow) return EMPTY_DIVERGENCES

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
          !originalInOut?.every((variable) => currentMap.has(formatVariable(variable))) ||
          hasLegacyInOutOutputHandle(node)

        if (hasDivergence) {
          divergences.push(`${rung.id}:${node.id}`)
        }
      }
    }

    return divergences.length > 0 ? divergences : EMPTY_DIVERGENCES
  }, [flow?.rungs, userLibraries, pous])

  const selectSearchedNode = useCallback(
    ({ nodeId, rungId }: { nodeId: string; rungId?: string }) => {
      const rung =
        rungs.find((candidate) => candidate.id === rungId) ??
        rungs.find((candidate) => candidate.nodes.some((node) => node.id === nodeId))
      const node = rung?.nodes.find((candidate) => candidate.id === nodeId)
      if (!rung || !node) return false

      ladderFlowActions.setSelectedNodes({ nodes: [node], rungId: rung.id, editorName: pouName })
      return true
    },
    [rungs, ladderFlowActions, pouName],
  )
  useGraphicalFocus(pouName, selectSearchedNode)

  const scrollableRef = useRef<HTMLDivElement>(null)
  const viewportWidth = useVisibleWidth(scrollableRef)
  const diagramRef = useRef<HTMLDivElement>(null)
  const scrollPastEnd = useScrollPastEnd(scrollableRef, diagramRef)
  const pouCanvas = useLadderPouCanvasValue(pouName, rungs, viewportWidth)
  // A rung drag starts after 4 px, so a click on the gutter still selects the rung.
  const rungDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  // Stored coordinates are engine output: a rename, an instance name or a changed location re-lays the rung out.
  useLayoutEffect(() => {
    if (isDebuggerVisible) return
    const laidOut = withLaidOutGeometry(rungs, pouCanvas.layouts)
    if (laidOut !== rungs) ladderFlowActions.setRungs({ editorName: pouName, rungs: [...laidOut] })
  }, [rungs, pouCanvas.layouts, isDebuggerVisible, ladderFlowActions, pouName])

  useEffect(() => {
    if (scrollableRef.current) {
      scrollableRef.current.scrollTo({
        top: searchNodePosition.y,
        left: searchNodePosition.x,
        behavior: 'smooth',
      })
    }
  }, [searchNodePosition])

  useEffect(() => {
    if (!flowUpdated) return
    scheduleFlowWriteBack(store.getState, pouName, 'ld')
  }, [store, flowUpdated])

  const handleDragStart = (event: DragStartEvent) => {
    if (isDebuggerVisible) return

    const { active } = event
    setActiveId(active.id)
    setActiveItem(rungs.find((rung) => rung.id === active.id) || null)
  }

  const handleAddNewRung = () => {
    if (isDebuggerVisible) return

    captureAndPush(pouName)

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

    const moved = moveRungs(flow.rungs, new Set(selectedRungIds), String(active.id), String(over.id))
    if (moved.every((rung, index) => rung === flow.rungs[index])) return
    const originalRungs = [...flow.rungs]
    try {
      captureAndPush(pouName)
      ladderFlowActions.setRungs({ editorName: pouName, rungs: moved })
    } catch (error) {
      console.error('Failed to update rungs:', error)
      ladderFlowActions.setRungs({ editorName: pouName, rungs: originalRungs })
      console.error('Failed to reorder rungs. The operation has been reverted.')
    }
  }

  const handleModalClose = () => {
    closeModal()
  }

  /**
   * Selects rung `rungId` (Shift adds or removes it) and clears the element selection of every rung left unselected; a
   * click on the only selected rung's number clears the selection, a right click never does.
   */
  const selectRung = useCallback(
    (rungId: string, options?: RungSelectOptions) => {
      const next = nextRungSelection(selectedRungIds, rungId, options)
      setSelectedRungIds(next)
      if (elementRungId !== null && !next.includes(elementRungId)) {
        ladderFlowActions.setSelectedNodes({ editorName: pouName, rungId: elementRungId, nodes: [] })
      }
      scrollableRef.current?.focus({ preventScroll: true })
    },
    [selectedRungIds, elementRungId, ladderFlowActions, pouName],
  )

  const setEditingComment = useCallback((rungId: string, editing: boolean) => {
    setEditingCommentRungId(editing ? rungId : null)
  }, [])

  /** The rung shortcuts: they act on the selected rung while the canvas itself has the focus. */
  const handleRungShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || selectedRungIds.length === 0) return
    const selected = rungs.filter((candidate) => selectedRungIds.includes(candidate.id))
    const rung = selected.length === 1 ? selected[0] : undefined
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (event.key === 'Escape') setSelectedRungIds([])
    else if (mod && key === '.')
      selected.forEach((each) =>
        updateModelLadder({ openRung: { rungId: each.id, open: !getIsRungOpen({ rungId: each.id }) } }),
      )
    else if (isEditingLocked) return
    else if (mod && key === 'd')
      selected.forEach((each) => ladderFlowActions.duplicateRung({ editorName: pouName, rungId: each.id }))
    else if (rung === undefined) return
    else if ((event.key === 'Delete' || event.key === 'Backspace') && !mod) openModal('confirm-delete-element', rung)
    else if (mod && key === '/') setEditingCommentRungId(rung.id)
    else return
    event.preventDefault()
  }

  return (
    <div
      data-testid='ld-pou-canvas'
      className='h-full w-full overflow-auto'
      ref={scrollableRef}
      style={{ scrollbarGutter: 'stable' }}
      tabIndex={-1}
      onKeyDown={handleRungShortcut}
      onContextMenu={placement?.handleContextMenu}
    >
      <div
        className='flex flex-1 flex-col gap-4'
        style={{ width: LADDER_STYLE.gutter + pouCanvas.presentation.widthPx, minWidth: '100%' }}
      >
        <LadderPouCanvasProvider value={pouCanvas}>
          <DndContext
            sensors={rungDragSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
          >
            <div ref={diagramRef} className='relative h-fit'>
              {/* One pair of power rails for the whole POU, so the rungs read as one continuous flow. */}
              {[0, pouCanvas.presentation.railX].map((x) => (
                <div
                  key={x}
                  aria-hidden
                  className='pointer-events-none absolute bottom-0 top-0'
                  style={{
                    left: LADDER_STYLE.gutter + x - RAIL_STROKE / 2,
                    width: RAIL_STROKE,
                    background: palette.rail,
                  }}
                />
              ))}
              <SortableContext items={rungs} strategy={verticalListSortingStrategy}>
                {rungs.map((rung, index) => (
                  <Rung
                    key={rung.id}
                    id={rung.id}
                    index={index}
                    rung={rung}
                    className={cn({
                      'opacity-35':
                        activeId === rung.id ||
                        (activeId !== null &&
                          selectedRungIds.includes(String(activeId)) &&
                          selectedRungIds.includes(rung.id)),
                    })}
                    nodeDivergences={nodeDivergences}
                    isDebuggerActive={isDebuggerVisible}
                    selected={selectedRungIds.includes(rung.id)}
                    onSelect={selectRung}
                    editingComment={editingCommentRungId === rung.id}
                    onEditingCommentChange={setEditingComment}
                  />
                ))}
              </SortableContext>
              <EndRung railX={pouCanvas.presentation.railX} onCreate={handleAddNewRung} />
              {createPortal(
                <DragOverlay dropAnimation={defaultDropAnimation} modifiers={[restrictToParentElement]}>
                  {activeId && activeItem ? (
                    <div className='relative'>
                      <Rung key={activeItem.id} id={activeItem.id} rung={activeItem} index={-1} />
                      {selectedRungIds.length > 1 && selectedRungIds.includes(String(activeId)) && (
                        <span
                          aria-label='Dragged rungs'
                          className='absolute left-12 top-1 rounded bg-brand px-1.5 py-0.5 text-xs font-medium text-white'
                        >
                          {selectedRungIds.length} rungs
                        </span>
                      )}
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
            </div>
          </DndContext>
        </LadderPouCanvasProvider>
        <div aria-hidden className='shrink-0' style={{ height: scrollPastEnd }} />
        <Portal.Root>
          {blockElement && (
            <BlockElement
              onClose={handleModalClose}
              selectedNode={blockElement.node as BlockNode<BlockVariant>}
              isOpen={blockElementModal.open}
            />
          )}
          {contactElement && (
            <ContactElement
              onClose={handleModalClose}
              node={contactElement.node as ContactNode}
              isOpen={contactElementModal.open}
            />
          )}
          {coilElement && (
            <CoilElement
              onClose={handleModalClose}
              node={coilElement.node as CoilNode}
              isOpen={coilElementModal.open}
            />
          )}
        </Portal.Root>
      </div>
    </div>
  )
}
