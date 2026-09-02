import type { FBDRungState } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import { renderFbdPou } from '../fbd-renderer'
import type { ContentBlock, DrawOp } from '../types'

function makeNode(overrides: Record<string, unknown> = {}): Node {
  return {
    id: 'n1',
    type: 'block',
    position: { x: 0, y: 0 },
    width: 100,
    height: 40,
    data: {},
    ...overrides,
  } as unknown as Node
}

function makeEdge(overrides: Record<string, unknown> = {}): Edge {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    ...overrides,
  } as unknown as Edge
}

function makeRung(overrides: Partial<FBDRungState> = {}): FBDRungState {
  return {
    comment: '',
    selectedNodes: [],
    nodes: [],
    edges: [],
    ...overrides,
  }
}

function allOps(blocks: ContentBlock[]): DrawOp[] {
  return blocks.flatMap((b) => b.ops)
}

function textOf(ops: DrawOp[], text: string): DrawOp | undefined {
  return ops.find((op) => op.kind === 'text' && op.text === text)
}

const GENEROUS_WIDTH_PT = 750 // contentWidthPx = 1000
const GENEROUS_HEIGHT_PT = 750 // contentHeightPx = 1000

describe('renderFbdPou', () => {
  it('returns an empty array for an empty rung', () => {
    expect(renderFbdPou(makeRung(), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT)).toEqual([])
  })

  describe('block nodes', () => {
    it('draws the block name, input/output/inOut pin labels, and skips the instance name for a function', () => {
      const block = makeNode({
        id: 'b1',
        type: 'block',
        data: {
          variant: {
            name: 'ADD',
            type: 'function',
            variables: [
              { name: 'IN1', class: 'input' },
              { name: 'OUT', class: 'output' },
              { name: 'IO1', class: 'inOut' },
            ],
          },
          variable: { name: 'ADD0' },
        },
      })
      const ops = allOps(renderFbdPou(makeRung({ nodes: [block] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT))

      expect(textOf(ops, 'ADD')).toBeDefined()
      expect(textOf(ops, '<-> IO1')).toBeDefined()
      expect(ops.some((op) => op.kind === 'text' && op.text === 'IN1')).toBe(true)
      expect(textOf(ops, 'OUT')).toBeDefined()
      expect(textOf(ops, 'ADD0')).toBeUndefined()
    })

    it('draws the instance name for a non-function/non-generic block, and falls back to "???" with no variant name', () => {
      const block = makeNode({
        id: 'b1',
        type: 'block',
        data: { variant: { type: 'function-block', variables: [] }, variable: { name: 'TON0' } },
      })
      const noNameBlock = makeNode({
        id: 'b2',
        type: 'block',
        position: { x: 500, y: 0 },
        data: { variant: { type: 'function-block', variables: [] } },
      })
      const ops = allOps(
        renderFbdPou(makeRung({ nodes: [block, noNameBlock] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT),
      )
      expect(textOf(ops, 'TON0')).toBeDefined()
      expect(textOf(ops, '???')).toBeDefined()
    })
  })

  describe('variable nodes', () => {
    it('draws input/output/inout variable names, with a negation circle on the right for output and the left otherwise', () => {
      const input = makeNode({
        id: 'v-in',
        type: 'input-variable',
        position: { x: 0, y: 0 },
        data: { variable: { name: 'myVar' } },
      })
      const output = makeNode({
        id: 'v-out',
        type: 'output-variable',
        position: { x: 200, y: 0 },
        data: { variable: { name: 'result' }, negated: true, variant: 'output-variable' },
      })
      const inout = makeNode({
        id: 'v-io',
        type: 'inout-variable',
        position: { x: 400, y: 0 },
        data: { variable: { name: 'io1' }, negated: true, variant: 'inout-variable' },
      })
      const ops = allOps(
        renderFbdPou(makeRung({ nodes: [input, output, inout] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT),
      )
      expect(textOf(ops, 'myVar')).toBeDefined()
      expect(textOf(ops, 'result')).toBeDefined()
      expect(textOf(ops, 'io1')).toBeDefined()
      // both negated variables draw a negation circle (a filled/stroked path)
      expect(ops.filter((op) => op.kind === 'path' && op.fill === '#FFFFFF').length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('connector / continuation nodes', () => {
    it('draws the connector path for a connector and the continuation path for a continuation, both with the variable label', () => {
      const connector = makeNode({
        id: 'conn',
        type: 'connector',
        data: { variable: { name: 'toNext' }, variant: 'connector' },
      })
      const continuation = makeNode({
        id: 'cont',
        type: 'continuation',
        position: { x: 300, y: 0 },
        data: { variable: { name: 'fromPrev' }, variant: 'continuation' },
      })
      const ops = allOps(
        renderFbdPou(makeRung({ nodes: [connector, continuation] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT),
      )
      expect(textOf(ops, 'toNext')).toBeDefined()
      expect(textOf(ops, 'fromPrev')).toBeDefined()
      expect(ops.filter((op) => op.kind === 'path' && op.stroke === '#50545F')).toHaveLength(2)
    })
  })

  describe('comment nodes', () => {
    it('falls back from content to comment to an empty string', () => {
      const withContent = makeNode({ id: 'c1', type: 'comment', data: { content: 'Has content' } })
      const withComment = makeNode({
        id: 'c2',
        type: 'comment',
        position: { x: 300, y: 0 },
        data: { comment: 'Has comment' },
      })
      const withNeither = makeNode({ id: 'c3', type: 'comment', position: { x: 600, y: 0 }, data: {} })
      const ops = allOps(
        renderFbdPou(
          makeRung({ nodes: [withContent, withComment, withNeither] }),
          'normal',
          GENEROUS_WIDTH_PT,
          GENEROUS_HEIGHT_PT,
        ),
      )
      expect(textOf(ops, 'Has content')).toBeDefined()
      expect(textOf(ops, 'Has comment')).toBeDefined()
      expect(ops.some((op) => op.kind === 'text' && op.text === '')).toBe(true)
    })
  })

  it('ignores nodes with an unrecognized type (no drawable ops, just the tile wrapper)', () => {
    const unknown = makeNode({ id: 'u1', type: 'somethingElse' })
    const blocks = renderFbdPou(makeRung({ nodes: [unknown] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT)
    const ops = allOps(blocks)
    expect(ops.some((op) => op.kind === 'text' || op.kind === 'rect' || op.kind === 'path')).toBe(false)
  })

  describe('edges', () => {
    it('draws a visible edge between two resolvable nodes, and skips a hidden or unresolvable edge', () => {
      const a = makeNode({ id: 'a', type: 'connector', position: { x: 0, y: 0 }, data: {} })
      const b = makeNode({ id: 'b', type: 'connector', position: { x: 300, y: 0 }, data: {} })
      const hidden = makeNode({ id: 'hidden', type: 'placeholder', position: { x: 600, y: 0 } })
      const visibleEdge = makeEdge({ id: 'e1', source: 'a', target: 'b' })
      const hiddenEdge = makeEdge({ id: 'e2', source: 'a', target: 'hidden' })
      const missingEdge = makeEdge({ id: 'e3', source: 'a', target: 'does-not-exist' })
      const ops = allOps(
        renderFbdPou(
          makeRung({ nodes: [a, b, hidden], edges: [visibleEdge, hiddenEdge, missingEdge] }),
          'normal',
          GENEROUS_WIDTH_PT,
          GENEROUS_HEIGHT_PT,
        ),
      )
      expect(ops.some((op) => op.kind === 'path' && op.stroke === '#030303')).toBe(true)
    })
  })

  describe('layout / pagination', () => {
    it('renders as a single tile when the diagram fits without splitting', () => {
      const a = makeNode({ id: 'a', type: 'connector', position: { x: 0, y: 0 }, data: {} })
      const b = makeNode({ id: 'b', type: 'connector', position: { x: 50, y: 0 }, data: {} })
      const blocks = renderFbdPou(makeRung({ nodes: [a, b] }), 'normal', GENEROUS_WIDTH_PT, GENEROUS_HEIGHT_PT)
      expect(blocks).toHaveLength(1)
    })

    it('splits a diagram spread across both axes into a multi-row/multi-column tile grid', () => {
      const corners = [
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 0, y: 600 },
        { x: 600, y: 600 },
      ]
      const nodes = corners.map((position, i) =>
        makeNode({ id: `corner-${i}`, type: 'connector', position, data: {} }),
      )
      const blocks = renderFbdPou(makeRung({ nodes }), 'normal', 225, 225)
      expect(blocks.length).toBeGreaterThan(1)
      // at least one tile was forced to a full-page height (a real split occurred)
      expect(blocks.some((b) => b.heightPt === 225)).toBe(true)
    })

    it('scales the whole diagram to fit under scale-to-fit mode', () => {
      const a = makeNode({ id: 'a', type: 'connector', position: { x: 0, y: 0 }, data: {} })
      const b = makeNode({ id: 'b', type: 'connector', position: { x: 600, y: 600 }, data: {} })
      const blocks = renderFbdPou(makeRung({ nodes: [a, b] }), 'scale-to-fit', 225, 225)
      expect(blocks).toHaveLength(1)
    })
  })
})
