import type { Node } from '@xyflow/react'

import { buildVariableNode } from '../../buildNodes'
import {
  VARIABLE_ELEMENT_MAX_WIDTH,
  VARIABLE_ELEMENT_MIN_WIDTH,
  VARIABLE_ELEMENT_SIZE,
  VARIABLE_WIDTH_GRID,
} from '../constants'
import {
  getVariableElementWidth,
  getVariableNodeWidth,
  isVariableNameTruncated,
  resizeFbdNodeToVariableName,
  resizeVariableNodeToName,
} from '../variable-size'

// jsdom has no canvas, so these run on the fixed-width fallback measurement.
// Stub getContext so jsdom does not log "not implemented" for it.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })

const LONG_NAME = 'MotorConveyorBeltRunFeedbackFromTheSecondaryLine'
const MEDIUM_NAME = 'MotorRunFeedbackSignal'

describe('getVariableElementWidth', () => {
  it('keeps the default width for an empty name so the type placeholder fits', () => {
    expect(getVariableElementWidth('')).toBe(VARIABLE_ELEMENT_SIZE)
    expect(getVariableElementWidth('   ')).toBe(VARIABLE_ELEMENT_SIZE)
  })

  it('makes a short name narrower than a long one', () => {
    expect(getVariableElementWidth('x')).toBeLessThan(getVariableElementWidth(MEDIUM_NAME))
  })

  it('never goes below the minimum or above the maximum', () => {
    expect(getVariableElementWidth('x')).toBe(VARIABLE_ELEMENT_MIN_WIDTH)
    expect(getVariableElementWidth(LONG_NAME.repeat(4))).toBe(VARIABLE_ELEMENT_MAX_WIDTH)
  })

  it('always lands on the snap grid', () => {
    for (const name of ['a', 'ab', 'abc', MEDIUM_NAME, LONG_NAME]) {
      expect(getVariableElementWidth(name) % VARIABLE_WIDTH_GRID).toBe(0)
    }
  })

  it('is stable: the same name always yields the same width', () => {
    expect(getVariableElementWidth(MEDIUM_NAME)).toBe(getVariableElementWidth(MEDIUM_NAME))
  })
})

describe('isVariableNameTruncated', () => {
  it('flags only names wider than the box can show', () => {
    expect(isVariableNameTruncated('x', VARIABLE_ELEMENT_SIZE)).toBe(false)
    expect(isVariableNameTruncated(LONG_NAME.repeat(4), VARIABLE_ELEMENT_MAX_WIDTH)).toBe(true)
  })
})

describe('getVariableNodeWidth', () => {
  it('falls back to the legacy width when the node carries none', () => {
    expect(getVariableNodeWidth({})).toBe(VARIABLE_ELEMENT_SIZE)
    expect(getVariableNodeWidth({ width: 0 })).toBe(VARIABLE_ELEMENT_SIZE)
    expect(getVariableNodeWidth({ width: 200 })).toBe(200)
  })
})

describe('resizeVariableNodeToName', () => {
  const position = { x: 320, y: 160 }

  it('grows an input variable to the left so its output pin stays on the block', () => {
    const node = buildVariableNode({ id: 'in', position, variant: 'input-variable' })
    const resized = resizeVariableNodeToName(node, LONG_NAME)
    const delta = (resized.width ?? 0) - VARIABLE_ELEMENT_SIZE

    expect(delta).toBeGreaterThan(0)
    expect(resized.position).toEqual({ x: position.x - delta, y: position.y })
    expect(resized.measured?.width).toBe(resized.width)
    // The pin keeps its place on the canvas and moves with the right edge inside the node.
    expect(resized.data.outputConnector?.glbPosition).toEqual(node.data.outputConnector?.glbPosition)
    expect(resized.data.outputConnector?.relPosition.x).toBe((node.data.outputConnector?.relPosition.x ?? 0) + delta)
    expect(resized.data.handles[0]).toEqual(resized.data.outputConnector)
    expect(resized.data.outputHandles[0]).toEqual(resized.data.outputConnector)
  })

  it('grows an output variable to the right and leaves its input pin untouched', () => {
    const node = buildVariableNode({ id: 'out', position, variant: 'output-variable' })
    const resized = resizeVariableNodeToName(node, LONG_NAME)

    expect(resized.position).toEqual(position)
    expect(resized.data.inputConnector).toEqual(node.data.inputConnector)
  })

  it('moves the output pin of an in-out variable with its right edge', () => {
    const node = buildVariableNode({ id: 'inout', position, variant: 'inout-variable' })
    const resized = resizeVariableNodeToName(node, LONG_NAME)
    const delta = (resized.width ?? 0) - VARIABLE_ELEMENT_SIZE

    expect(resized.position).toEqual(position)
    expect(resized.data.inputConnector).toEqual(node.data.inputConnector)
    expect(resized.data.outputConnector?.glbPosition.x).toBe((node.data.outputConnector?.glbPosition.x ?? 0) + delta)
  })

  it('shrinks back and returns the node unchanged when the width already fits', () => {
    const node = buildVariableNode({ id: 'in', position, variant: 'input-variable' })
    const grown = resizeVariableNodeToName(node, LONG_NAME)
    const shrunk = resizeVariableNodeToName(grown, '')

    expect(shrunk.width).toBe(VARIABLE_ELEMENT_SIZE)
    expect(shrunk.position).toEqual(position)
    expect(shrunk.data.outputConnector).toEqual(node.data.outputConnector)
    expect(resizeVariableNodeToName(shrunk, '')).toBe(shrunk)
  })
})

describe('resizeFbdNodeToVariableName', () => {
  it('leaves non-variable nodes alone', () => {
    const connector: Node = { id: 'c', type: 'connector', position: { x: 0, y: 0 }, width: 112, data: {} }
    expect(resizeFbdNodeToVariableName(connector, LONG_NAME)).toBe(connector)
  })

  it('resizes variable nodes', () => {
    const node = buildVariableNode({ id: 'out', position: { x: 0, y: 0 }, variant: 'output-variable' })
    expect(resizeFbdNodeToVariableName(node, LONG_NAME).width).toBeGreaterThan(VARIABLE_ELEMENT_SIZE)
  })
})
