/**
 * GraphicalDiffViewer — Side-by-side LD/FBD flow comparison between two versions.
 *
 * Computes diffs via VersionControlPort.computeGraphicalDiff() (backend utility),
 * then renders read-only ReactFlow instances with diff-colored nodes and edges.
 *
 * Shared by the history page, the merge page, and the source-control diff tab.
 */

import type { Edge, Node, NodeProps } from '@xyflow/react'
import { Background, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type {
  DiffStatus,
  FlowData,
  GraphicalDiffResult,
  VarDiffEntry,
} from '../../../../../../middleware/shared/ports/version-control-port'
import { useVersionControl } from '../../../../../../middleware/shared/providers'
import { cn } from '../../../../../utils/cn'
import {
  EDGE_DIFF_STROKE,
  fbdDiffNodeTypes,
  ladderDiffNodeTypes,
  VAR_DIFF_COLORS,
} from '../../../../_atoms/graphical-editor/diff'

// ---------------------------------------------------------------------------
// Hidden edge node types (edges to/from these are filtered out)
// ---------------------------------------------------------------------------

const HIDDEN_EDGE_NODE_TYPES = new Set(['placeholder', 'parallelPlaceholder', 'mockNode'])

// ---------------------------------------------------------------------------
// Prepare flow data for ReactFlow rendering
// ---------------------------------------------------------------------------

function prepareFlowForRender(
  flow: FlowData,
  diffMap: Map<string, DiffStatus>,
  edgeDiffMap?: Map<string, DiffStatus>,
  isLadder?: boolean,
) {
  const nodes: Node[] = (flow.nodes as Node[]).map((node) => ({
    ...node,
    data: { ...node.data, diffStatus: diffMap.get(node.id) ?? 'unchanged', nodeType: node.type },
    draggable: false,
    selectable: false,
    connectable: false,
  }))

  const flowNodes = flow.nodes as Node[]
  const edges: Edge[] = (flow.edges as Edge[])
    .filter((edge) => {
      const src = flowNodes.find((n) => n.id === edge.source)
      const tgt = flowNodes.find((n) => n.id === edge.target)
      return src && tgt && !HIDDEN_EDGE_NODE_TYPES.has(src.type ?? '') && !HIDDEN_EDGE_NODE_TYPES.has(tgt.type ?? '')
    })
    .map((edge) => {
      const edgeStatus = edgeDiffMap?.get(edge.id) ?? 'unchanged'
      const strokeColor = EDGE_DIFF_STROKE[edgeStatus]
      return {
        ...edge,
        type: 'smoothstep',
        selectable: false,
        focusable: false,
        style: strokeColor ? { stroke: strokeColor, strokeWidth: 2.5 } : isLadder ? { stroke: '#50545f' } : {},
      }
    })

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Variable diff section
// ---------------------------------------------------------------------------

function VariableDiffSection({ entries, collapsible = false }: { entries: VarDiffEntry[]; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible)
  if (entries.length === 0) return null

  return (
    <div className='border-b border-neutral-200 dark:border-neutral-700'>
      {collapsible ? (
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          className='flex w-full items-center gap-1 bg-neutral-100/50 px-2 py-0.5 text-[9px] text-neutral-400 transition-colors hover:bg-neutral-200/50 dark:bg-neutral-800/50 dark:text-neutral-500 dark:hover:bg-neutral-700/50'
        >
          {open ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
          Variables ({entries.length})
        </button>
      ) : (
        <div className='bg-neutral-100/50 px-2 py-0.5 text-[9px] text-neutral-400 dark:bg-neutral-800/50 dark:text-neutral-500'>
          Variables
        </div>
      )}
      {open && (
        <div className='space-y-0.5 px-3 py-2'>
          {entries.map((entry) => {
            const v = entry.current ?? entry.original!
            const prefix = entry.status === 'added' ? '+ ' : entry.status === 'removed' ? '- ' : '~ '
            const detail = `${v.name} : ${v.type}${v.initialValue ? ` := ${v.initialValue}` : ''}${v.location ? ` AT ${v.location}` : ''}`
            return (
              <div
                key={entry.name}
                className={cn('rounded px-2 py-0.5 font-mono text-[10px]', VAR_DIFF_COLORS[entry.status])}
              >
                {prefix}
                {detail}
                {entry.status === 'modified' && entry.original && (
                  <span className='ml-2 text-neutral-400 dark:text-neutral-500'>
                    (was: {entry.original.type}
                    {entry.original.initialValue ? ` := ${entry.original.initialValue}` : ''})
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single rung cell (one ReactFlow instance)
// ---------------------------------------------------------------------------

function RungCell({
  flow,
  diffMap,
  edgeDiffMap,
  nodeTypes,
  isDark,
  height,
  minWidth,
  className,
  isLadder,
}: {
  flow: FlowData | null
  diffMap: Map<string, DiffStatus>
  edgeDiffMap?: Map<string, DiffStatus>
  nodeTypes: Record<string, React.ComponentType<NodeProps>>
  isDark: boolean
  height: number
  minWidth?: number
  className?: string
  isLadder?: boolean
}) {
  const { nodes, edges } = useMemo(
    () => (flow ? prepareFlowForRender(flow, diffMap, edgeDiffMap, isLadder) : { nodes: [], edges: [] }),
    [flow, diffMap, edgeDiffMap, isLadder],
  )

  // Block labels are rendered with `-top-[16px]` absolute positioning, so we
  // need extra top padding in the ladder cell to keep them visible.
  const ladderTopPadding = isLadder ? 20 : 0

  // FBD: render at natural scale (zoom 1) and scroll, mirroring the editable FBD
  // editor (which renders nodes at their saved positions, no fitView). fitView
  // scaled the graph down to the narrow column width — leaving a huge vertical
  // gap, and clipping the top once large nodes (e.g. comment blocks) were
  // measured. Instead we size the cell to the content bounds and offset the
  // viewport so the diagram's top-left sits at the top-left of the cell.
  const FBD_PAD = 24
  const fbd = useMemo(() => {
    if (isLadder || nodes.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const x = n.position?.x ?? 0
      const y = n.position?.y ?? 0
      const w = (n.measured?.width as number) ?? (n.width as number) ?? 100
      const h = (n.measured?.height as number) ?? (n.height as number) ?? 40
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    }
    return {
      width: maxX - minX + FBD_PAD * 2,
      height: maxY - minY + FBD_PAD * 2,
      viewport: { x: -minX + FBD_PAD, y: -minY + FBD_PAD, zoom: 1 },
    }
  }, [isLadder, nodes])

  const outerStyle: React.CSSProperties = isLadder
    ? { height: height + ladderTopPadding, paddingTop: ladderTopPadding }
    : { height: Math.min(Math.max(fbd?.height ?? height, 120), 700) }

  const innerMinWidth = isLadder ? minWidth : fbd?.width

  return (
    <div className={cn('w-full', isLadder ? 'overflow-x-auto' : 'overflow-auto', className)} style={outerStyle}>
      <div style={innerMinWidth ? { minWidth: innerMinWidth } : undefined} className='h-full'>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView={false}
            defaultViewport={fbd?.viewport}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            panActivationKeyCode={null}
            zoomActivationKeyCode={null}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            {!isLadder && <Background color={isDark ? '#333' : '#ddd'} gap={16} size={1} />}
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function GraphicalDiffViewer({
  originalContent,
  currentContent,
  filePath,
  isDark,
  originalLabel = 'Previous',
  currentLabel = 'Current',
  showOriginalSide = true,
}: {
  originalContent: string
  currentContent: string
  filePath: string
  isDark: boolean
  originalLabel?: string
  currentLabel?: string
  /** When false, render only the "current" side with diff coloring (no before/after). */
  showOriginalSide?: boolean
}) {
  const versionControl = useVersionControl()

  const diffResult: GraphicalDiffResult | null = useMemo(() => {
    if (!versionControl) return null
    return versionControl.computeGraphicalDiff(originalContent, currentContent, filePath)
  }, [originalContent, currentContent, filePath, versionControl])

  const isLadder = diffResult?.isLadder ?? filePath.endsWith('.ld')
  const nodeTypes = useMemo(() => (isLadder ? ladderDiffNodeTypes : fbdDiffNodeTypes), [isLadder])

  if (!diffResult) {
    return (
      <div className='flex h-full items-center justify-center'>
        <p className='text-sm text-neutral-400 dark:text-neutral-500'>Could not parse graphical data for diff view</p>
      </div>
    )
  }

  const { flows, changedIndexes, variableDiff, nodeDiffMaps, edgeDiffMaps } = diffResult

  return (
    <div className={cn('flex flex-col', showOriginalSide ? 'h-full' : '')}>
      {/* FBD: side-by-side header */}
      {!isLadder && showOriginalSide && (
        <div className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <div className='flex-1 bg-neutral-50 px-2 py-1 text-[10px] font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400'>
            {originalLabel}
          </div>
          <div className='w-px bg-neutral-200 dark:bg-neutral-700' />
          <div className='flex-1 bg-neutral-50 px-2 py-1 text-[10px] font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400'>
            {currentLabel}
          </div>
        </div>
      )}

      {/* Scrollable content (only when we own the viewport — otherwise the parent scrolls) */}
      <div className={cn('min-h-0 overflow-x-auto', showOriginalSide && 'flex-1 overflow-y-auto')}>
        {/* Variables render BEFORE rungs in history mode, AFTER in merge mode
            (focus on rungs when resolving conflicts). */}
        {showOriginalSide && variableDiff.length > 0 && <VariableDiffSection entries={variableDiff} />}

        {changedIndexes.length === 0 && variableDiff.length === 0 && (
          <div className='flex items-center justify-center py-8'>
            <p className='text-xs text-neutral-400 dark:text-neutral-500'>No graphical changes detected</p>
          </div>
        )}

        {changedIndexes.map((i) => {
          const { original, current, originalHeight, currentHeight, originalWidth, currentWidth } = flows[i]
          const rungEdgeDiff = edgeDiffMaps[i]

          return (
            <div key={i} className='border-b border-neutral-200 dark:border-neutral-700'>
              <div className='border-b border-neutral-300 bg-neutral-200/60 px-3 py-1 text-[11px] font-semibold text-neutral-600 dark:border-neutral-600 dark:bg-neutral-700/60 dark:text-neutral-300'>
                {isLadder ? `Rung ${i + 1}` : 'Diagram'}
              </div>

              {isLadder ? (
                <>
                  {showOriginalSide &&
                    (original ? (
                      <>
                        <div className='bg-red-500/5 px-2 py-0.5 text-[9px] font-medium text-red-400 dark:text-red-500'>
                          {originalLabel}
                        </div>
                        <RungCell
                          flow={original}
                          diffMap={nodeDiffMaps.original}
                          nodeTypes={nodeTypes as Record<string, React.ComponentType<NodeProps>>}
                          isDark={isDark}
                          height={originalHeight}
                          minWidth={originalWidth}
                          isLadder
                        />
                      </>
                    ) : (
                      <div className='flex items-center justify-center bg-green-500/5 py-4'>
                        <p className='text-[10px] text-green-500'>New rung</p>
                      </div>
                    ))}
                  {current ? (
                    <>
                      {showOriginalSide && (
                        <div className='bg-green-500/5 px-2 py-0.5 text-[9px] font-medium text-green-400 dark:text-green-500'>
                          {currentLabel}
                        </div>
                      )}
                      <RungCell
                        flow={current}
                        diffMap={nodeDiffMaps.current}
                        nodeTypes={nodeTypes as Record<string, React.ComponentType<NodeProps>>}
                        isDark={isDark}
                        height={currentHeight}
                        minWidth={currentWidth}
                        isLadder
                      />
                    </>
                  ) : (
                    <div className='flex items-center justify-center bg-red-500/5 py-4'>
                      <p className='text-[10px] text-red-500'>Rung removed</p>
                    </div>
                  )}
                </>
              ) : (
                <div className='flex items-start'>
                  {showOriginalSide &&
                    (original ? (
                      <RungCell
                        flow={original}
                        diffMap={nodeDiffMaps.original}
                        edgeDiffMap={rungEdgeDiff?.original}
                        nodeTypes={nodeTypes as Record<string, React.ComponentType<NodeProps>>}
                        isDark={isDark}
                        height={originalHeight}
                        className='min-w-0 flex-1'
                      />
                    ) : (
                      <div className='flex min-w-0 flex-1 items-center justify-center bg-green-500/5'>
                        <p className='text-[10px] text-green-500'>New diagram</p>
                      </div>
                    ))}
                  {showOriginalSide && <div className='w-px shrink-0 bg-neutral-200 dark:bg-neutral-700' />}
                  {current ? (
                    <RungCell
                      flow={current}
                      diffMap={nodeDiffMaps.current}
                      edgeDiffMap={rungEdgeDiff?.current}
                      nodeTypes={nodeTypes as Record<string, React.ComponentType<NodeProps>>}
                      isDark={isDark}
                      height={currentHeight}
                      className='min-w-0 flex-1'
                    />
                  ) : (
                    <div className='flex min-w-0 flex-1 items-center justify-center bg-red-500/5'>
                      <p className='text-[10px] text-red-500'>Diagram removed</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* In merge mode, variables show collapsed AFTER the rungs so the user's focus stays on the diagrams. */}
        {!showOriginalSide && variableDiff.length > 0 && <VariableDiffSection entries={variableDiff} collapsible />}
      </div>
    </div>
  )
}

export function isGraphicalFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'ld' || ext === 'fbd'
}
