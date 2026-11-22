import {
  EMPTY_LABEL_SOURCE,
  type LabelBox,
  LADDER_PALETTE,
  type LadderLabelSource,
  type LadderPalette,
  type NodeGeometry,
  type RungLayout,
} from '@root/middleware/shared/utils/ladder-layout'
import type { Node } from '@xyflow/react'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { useOpenPLCStore } from '../../../../store'

/** What the LD node atoms of one rung draw from: the engine layout, the label source and the theme palette. */
export interface LadderRungView {
  layout: RungLayout
  labelSource: LadderLabelSource
  palette: LadderPalette
}

/** A node's view: its labels relative to its own origin, its engine geometry, the label source and the palette. */
export interface LadderNodeView {
  labels: readonly LabelBox[]
  geometry: NodeGeometry | undefined
  labelSource: LadderLabelSource
  palette: LadderPalette
}

/** Colour of an element whose variable does not resolve or does not fit, on screen. */
export const LADDER_ERROR_COLOUR = '#ef4444'

/** Colours of a variable forced true and forced false in a debug session. */
export const LADDER_FORCED_COLOURS = { high: '#80c000', low: '#4080ff' } as const

const RungViewContext = createContext<LadderRungView | null>(null)
const PoweredBlocksContext = createContext<ReadonlySet<string>>(new Set())

/** Provides the rung view, and the blocks receiving power in a debug session, to the LD node atoms below it. */
export function LadderRungViewProvider({
  view,
  poweredBlockIds,
  children,
}: {
  view: LadderRungView
  poweredBlockIds?: ReadonlySet<string>
  children: ReactNode
}) {
  const powered = useMemo(() => poweredBlockIds ?? new Set<string>(), [poweredBlockIds])
  return (
    <RungViewContext.Provider value={view}>
      <PoweredBlocksContext.Provider value={powered}>{children}</PoweredBlocksContext.Provider>
    </RungViewContext.Provider>
  )
}

/** The palette of the app theme: dark or light. */
export function useLadderThemePalette(): LadderPalette {
  const dark = useOpenPLCStore((state) => state.workspace.systemConfigs.shouldUseDarkMode)
  return dark ? LADDER_PALETTE.dark : LADDER_PALETTE.light
}

/** The labels of a node moved from rung canvas coordinates to the node's own origin. */
export function relativeLabels(labels: readonly LabelBox[], geometry: NodeGeometry | undefined): LabelBox[] {
  const x = geometry?.position.x ?? 0
  const y = geometry?.position.y ?? 0
  return labels.map((label) => ({ ...label, x: label.x - x, y: label.y - y }))
}

/** The view of node `nodeId` in the enclosing rung; empty labels and the light palette outside a rung view. */
export function useLadderNodeView(nodeId: string): LadderNodeView {
  const view = useContext(RungViewContext)
  return useMemo(() => {
    if (view === null) {
      return { labels: [], geometry: undefined, labelSource: EMPTY_LABEL_SOURCE, palette: LADDER_PALETTE.light }
    }
    const geometry = view.layout.nodes.get(nodeId)
    return {
      labels: relativeLabels(view.layout.labels.get(nodeId) ?? [], geometry),
      geometry,
      labelSource: view.labelSource,
      palette: view.palette,
    }
  }, [view, nodeId])
}

/** True while power reaches block `nodeId`'s input on the rung wire in a debug session. */
export function useLadderBlockPowered(nodeId: string): boolean {
  return useContext(PoweredBlocksContext).has(nodeId)
}

/** The first label of `role` among `labels`. */
export function labelOfRole(labels: readonly LabelBox[], role: LabelBox['role']): LabelBox | undefined {
  return labels.find((label) => label.role === role)
}

/** A node as React Flow draws it: a stored zero width or height, as a junction or rail has, is drawn 1 px wide. */
export function ladderDisplayNode<T extends Node>(node: T): T {
  const width = typeof node.width === 'number' && node.width < 1 ? 1 : node.width
  const height = typeof node.height === 'number' && node.height < 1 ? 1 : node.height
  if (width === node.width && height === node.height) return node
  return { ...node, width, height, measured: { width, height } }
}
