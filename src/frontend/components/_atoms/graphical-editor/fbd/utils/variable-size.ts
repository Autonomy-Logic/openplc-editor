import type { Node } from '@xyflow/react'

import type { CustomHandleProps } from '../handle'
import {
  DEFAULT_VARIABLE_WIDTH,
  FBD_VARIABLE_NODE_TYPES,
  VARIABLE_ELEMENT_MAX_WIDTH,
  VARIABLE_ELEMENT_MIN_WIDTH,
  VARIABLE_ELEMENT_SIZE,
  VARIABLE_WIDTH_GRID,
} from './constants'
import type { VariableNode } from './types'

// Border + padding between the node's outer edge and the text area.
const VARIABLE_ELEMENT_INSET = VARIABLE_ELEMENT_SIZE - DEFAULT_VARIABLE_WIDTH
// Breathing room so the text does not touch the border.
const VARIABLE_TEXT_GUTTER = 8
// The box renders its name with `text-xs` (12px).
const VARIABLE_FONT_SIZE = 12
// Rough average glyph width, used when no canvas is available (tests / SSR).
const FALLBACK_CHAR_WIDTH = 7

let measureContext: CanvasRenderingContext2D | null | undefined

const measureTextWidth = (text: string): number => {
  if (measureContext === undefined) {
    measureContext = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    // The family string is stable; the canvas re-resolves the glyphs on each
    // measure, so a webfont that loads later is still picked up.
    if (measureContext) measureContext.font = `${VARIABLE_FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`
  }
  if (!measureContext) return text.length * FALLBACK_CHAR_WIDTH
  return measureContext.measureText(text).width
}

/**
 * Outer width of an FBD variable box for the given name, rounded up to the
 * snap grid and clamped so an empty box stays clickable and a pathological
 * name cannot span the canvas. An empty name keeps the default width so the
 * type placeholder still fits.
 */
export const getVariableElementWidth = (name: string): number => {
  if (!name.trim()) return VARIABLE_ELEMENT_SIZE

  const needed = measureTextWidth(name) + VARIABLE_ELEMENT_INSET + VARIABLE_TEXT_GUTTER
  const snapped = Math.ceil(needed / VARIABLE_WIDTH_GRID) * VARIABLE_WIDTH_GRID
  return Math.min(VARIABLE_ELEMENT_MAX_WIDTH, Math.max(VARIABLE_ELEMENT_MIN_WIDTH, snapped))
}

/** Whether the name is wider than a box of the given outer width can show. */
export const isVariableNameTruncated = (name: string, elementWidth: number): boolean =>
  measureTextWidth(name) > elementWidth - VARIABLE_ELEMENT_INSET

/** Outer width a variable node renders at; falls back to the default for legacy nodes. */
export const getVariableNodeWidth = (node: { width?: number }): number =>
  node.width && node.width > 0 ? node.width : VARIABLE_ELEMENT_SIZE

/**
 * Resize a variable node to fit `name`, keeping the pin that faces a block in
 * place: an input variable grows to the left (its output pin is on the right),
 * output and in-out variables grow to the right. An input variable's new left
 * edge is snapped to the grid, so a box imported with an off-grid width lands
 * back on it.
 */
export const resizeVariableNodeToName = (node: VariableNode, name: string): VariableNode => {
  const currentWidth = getVariableNodeWidth(node)
  const width = getVariableElementWidth(name)
  const delta = width - currentWidth
  if (delta === 0) return node

  const anchorRight = node.data.variant === 'input-variable'
  const x = anchorRight
    ? Math.round((node.position.x - delta) / VARIABLE_WIDTH_GRID) * VARIABLE_WIDTH_GRID
    : node.position.x
  // How far the right edge, and so the output pin, moves on the canvas.
  const rightEdgeShift = x + width - (node.position.x + currentWidth)

  const shiftOutputHandle = <T extends CustomHandleProps | undefined>(handle: T): T => {
    if (!handle || handle.type !== 'source') return handle
    return {
      ...handle,
      glbPosition: { ...handle.glbPosition, x: handle.glbPosition.x + rightEdgeShift },
      relPosition: { ...handle.relPosition, x: handle.relPosition.x + delta },
    }
  }

  return {
    ...node,
    position: { ...node.position, x },
    width,
    measured: { ...node.measured, width },
    data: {
      ...node.data,
      handles: node.data.handles.map(shiftOutputHandle),
      inputHandles: node.data.inputHandles.map(shiftOutputHandle),
      outputHandles: node.data.outputHandles.map(shiftOutputHandle),
      inputConnector: shiftOutputHandle(node.data.inputConnector),
      outputConnector: shiftOutputHandle(node.data.outputConnector),
    },
  }
}

const isVariableNode = (node: Node): node is VariableNode =>
  FBD_VARIABLE_NODE_TYPES.some((variableType) => variableType === node.type)

/** `resizeVariableNodeToName` for any FBD node; non-variable nodes are returned as is. */
export const resizeFbdNodeToVariableName = (node: Node, name: string): Node =>
  isVariableNode(node) ? resizeVariableNodeToName(node, name) : node
