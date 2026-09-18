import type { RungLadderState } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import { renderLadderPou } from '../ladder-renderer'
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

function makeRung(overrides: Partial<RungLadderState> = {}): RungLadderState {
  return {
    id: 'rung-0',
    comment: '',
    defaultBounds: [0, 0],
    reactFlowViewport: [0, 200],
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

const WIDE_CONTENT_PT = 750 // contentWidthPx = 1000 at scale 1 -> a single ~100px-wide node fits in one band.
const NARROW_CONTENT_PT = 300 // contentWidthPx = 400 -> forces a multi-band split for far-apart nodes.
const TALL_CONTENT_PT = 1000 // comfortably taller than any rung in these tests — never the constraint unless a test says so.

describe('renderLadderPou', () => {
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
      const rung = makeRung({ nodes: [block] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))

      expect(textOf(ops, 'ADD')).toBeDefined()
      expect(textOf(ops, '<-> IO1')).toBeDefined()
      expect(textOf(ops, 'IN1')).toBeDefined() // IN1 isn't inOut, so it's rendered plain (no arrow prefix)
      expect(textOf(ops, 'OUT')).toBeDefined()
      expect(textOf(ops, 'ADD0')).toBeUndefined() // function kind: instance name is not drawn
    })

    it('draws the instance name for a non-function/non-generic block, and falls back to "???" with no variant name', () => {
      const block = makeNode({
        id: 'b1',
        type: 'block',
        data: {
          variant: { name: 'TON', type: 'function-block', variables: [] },
          variable: { name: 'TON0' },
        },
      })
      const noNameBlock = makeNode({
        id: 'b2',
        type: 'block',
        position: { x: 500, y: 0 },
        data: { variant: { type: 'function-block', variables: [] } },
      })
      const rung = makeRung({ nodes: [block, noNameBlock] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))

      expect(textOf(ops, 'TON0')).toBeDefined()
      expect(textOf(ops, '???')).toBeDefined()
    })
  })

  describe('coil nodes', () => {
    it('renders every coil variant glyph and the variable name label', () => {
      const variants = ['default', 'negated', 'set', 'reset', 'risingEdge', 'fallingEdge'] as const
      const nodes = variants.map((variant, i) =>
        makeNode({
          id: `coil-${variant}`,
          type: 'coil',
          position: { x: i * 200, y: 0 },
          data: { variant, variable: { name: `Q_${variant}` } },
        }),
      )
      const rung = makeRung({ nodes })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))

      for (const variant of variants) {
        expect(textOf(ops, `Q_${variant}`)).toBeDefined()
      }
      // 'S'/'R'/'P'/'N' glyphs for set/reset/risingEdge/fallingEdge
      expect(ops.some((op) => op.kind === 'text' && op.text === 'S')).toBe(true)
      expect(ops.some((op) => op.kind === 'text' && op.text === 'R')).toBe(true)
      expect(ops.some((op) => op.kind === 'text' && op.text === 'P')).toBe(true)
      expect(ops.some((op) => op.kind === 'text' && op.text === 'N')).toBe(true)
      // negated coil draws its negation line
      expect(ops.some((op) => op.kind === 'line' && op.color === '#0464FB')).toBe(true)
    })

    it('renders a coil with no variable name (no label op)', () => {
      const coil = makeNode({ id: 'c1', type: 'coil', data: {} })
      const rung = makeRung({ nodes: [coil] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))
      expect(ops.filter((op) => op.kind === 'path').length).toBeGreaterThan(0)
    })
  })

  describe('contact nodes', () => {
    it('renders every contact variant glyph and the variable name label', () => {
      const variants = ['default', 'negated', 'risingEdge', 'fallingEdge'] as const
      const nodes = variants.map((variant, i) =>
        makeNode({
          id: `contact-${variant}`,
          type: 'contact',
          position: { x: i * 200, y: 0 },
          data: { variant, variable: { name: `I_${variant}` } },
        }),
      )
      const rung = makeRung({ nodes })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))

      for (const variant of variants) {
        expect(textOf(ops, `I_${variant}`)).toBeDefined()
      }
      expect(ops.some((op) => op.kind === 'line' && op.color === '#0464FB')).toBe(true)
    })

    it('renders a contact with no variable name (no label op)', () => {
      const contact = makeNode({ id: 'ct1', type: 'contact', data: {} })
      const rung = makeRung({ nodes: [contact] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))
      expect(ops.filter((op) => op.kind === 'line').length).toBeGreaterThan(0)
    })
  })

  describe('variable nodes', () => {
    it('aligns input/output/other variants and falls back to the placeholder type or empty text', () => {
      const input = makeNode({
        id: 'v-in',
        type: 'variable',
        position: { x: 0, y: 0 },
        data: { variant: 'input', variable: { name: 'myVar' } },
      })
      const output = makeNode({
        id: 'v-out',
        type: 'variable',
        position: { x: 200, y: 0 },
        data: { variant: 'output', variable: { name: 'result' } },
      })
      const other = makeNode({
        id: 'v-other',
        type: 'variable',
        position: { x: 400, y: 0 },
        data: { variant: 'inOut', block: { variableType: { type: { value: 'INT' } } } },
      })
      const empty = makeNode({
        id: 'v-empty',
        type: 'variable',
        position: { x: 600, y: 0 },
        data: {},
      })
      const rung = makeRung({ nodes: [input, output, other, empty] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))

      expect(textOf(ops, 'myVar')).toBeDefined()
      expect(textOf(ops, 'result')).toBeDefined()
      expect(textOf(ops, '(*INT*)')).toBeDefined()
      expect(ops.some((op) => op.kind === 'text' && op.text === '')).toBe(true)
    })
  })

  it('renders a power rail as a filled rect', () => {
    const rail = makeNode({ id: 'pr1', type: 'powerRail', width: 4, height: 200 })
    const rung = makeRung({ nodes: [rail] })
    const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))
    expect(ops.some((op) => op.kind === 'rect' && op.fill === '#030303')).toBe(true)
  })

  it('ignores nodes with an unrecognized type and filters out placeholder/parallelPlaceholder/mockNode nodes', () => {
    const unknown = makeNode({ id: 'u1', type: 'somethingElse' })
    const placeholder = makeNode({ id: 'p1', type: 'placeholder', position: { x: 100, y: 0 } })
    const parallelPlaceholder = makeNode({ id: 'p2', type: 'parallelPlaceholder', position: { x: 200, y: 0 } })
    const mockNode = makeNode({ id: 'p3', type: 'mockNode', position: { x: 300, y: 0 } })
    const rung = makeRung({ nodes: [unknown, placeholder, parallelPlaceholder, mockNode] })
    const blocks = renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT)
    expect(allOps(blocks)).toEqual([])
  })

  describe('edges', () => {
    it('draws a visible edge between two resolvable nodes, and skips a hidden or unresolvable edge', () => {
      const a = makeNode({ id: 'a', type: 'contact', position: { x: 0, y: 0 }, data: {} })
      const b = makeNode({ id: 'b', type: 'coil', position: { x: 300, y: 0 }, data: {} })
      const hidden = makeNode({ id: 'hidden', type: 'placeholder', position: { x: 600, y: 0 } })
      const visibleEdge = makeEdge({ id: 'e1', source: 'a', target: 'b' })
      const hiddenEdge = makeEdge({ id: 'e2', source: 'a', target: 'hidden' })
      const missingEdge = makeEdge({ id: 'e3', source: 'a', target: 'does-not-exist' })
      const rung = makeRung({ nodes: [a, b, hidden], edges: [visibleEdge, hiddenEdge, missingEdge] })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))
      expect(ops.some((op) => op.kind === 'path' && op.stroke === '#030303')).toBe(true)
    })
  })

  describe('layout / pagination', () => {
    it('keeps a narrow rung in a single band under normal mode', () => {
      const node = makeNode({ id: 'n1', type: 'contact', data: {} })
      const rung = makeRung({ nodes: [node], comment: '' })
      const blocks = renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT)
      expect(blocks).toHaveLength(1)
    })

    it('splits a wide rung into multiple gap-aligned bands under normal mode', () => {
      const nodes = [0, 500, 1000].map((x, i) =>
        makeNode({ id: `n${i}`, type: 'contact', position: { x, y: 0 }, data: {} }),
      )
      const rung = makeRung({ nodes, comment: 'wide rung' })
      const blocks = renderLadderPou([rung], 'normal', NARROW_CONTENT_PT, TALL_CONTENT_PT)
      expect(blocks.length).toBeGreaterThan(1)
    })

    it('scales the whole rung to fit under scale-to-fit mode', () => {
      const nodes = [0, 500, 1000].map((x, i) =>
        makeNode({ id: `n${i}`, type: 'contact', position: { x, y: 0 }, data: {} }),
      )
      const rung = makeRung({ nodes })
      const blocks = renderLadderPou([rung], 'scale-to-fit', NARROW_CONTENT_PT, TALL_CONTENT_PT)
      expect(blocks).toHaveLength(1)
    })

    it('draws a comment block above a rung that has one', () => {
      const node = makeNode({ id: 'n1', type: 'contact', data: {} })
      const rung = makeRung({ nodes: [node], comment: 'Rung comment' })
      const ops = allOps(renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, TALL_CONTENT_PT))
      expect(textOf(ops, 'Rung comment')).toBeDefined()
    })

    it('shrinks a rung taller than the page instead of letting it draw past the page and get clipped', () => {
      // Regression: a rung's elements sit on one horizontal line — unlike an
      // FBD diagram there's no way to split one across pages — so a rung this
      // tall used to come out with a `heightPt` bigger than the whole page,
      // drawing everything past the top mostly off-page.
      const nodes = [
        makeNode({ id: 'top', position: { x: 0, y: 0 } }),
        makeNode({ id: 'bottom', position: { x: 0, y: 2000 } }),
      ]
      const rung = makeRung({ nodes })
      const shortPageHeightPt = 200

      const blocks = renderLadderPou([rung], 'normal', WIDE_CONTENT_PT, shortPageHeightPt)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].heightPt).toBeLessThanOrEqual(shortPageHeightPt)
    })

    it('shrinks each band of a wide-AND-tall rung so every band still fits the page height', () => {
      const nodes = [0, 500, 1000].map((x) => makeNode({ id: `n${x}`, position: { x, y: x === 500 ? 2000 : 0 } }))
      const rung = makeRung({ nodes })
      // Mild relative to the rung's ~1530pt natural height — the resulting
      // height-safety-scale only nudges things down a little, which isn't
      // enough on its own to also let the whole (still wide) rung fit in one
      // band, so the width split below still needs to happen too.
      const shortPageHeightPt = 1400

      const blocks = renderLadderPou([rung], 'normal', NARROW_CONTENT_PT, shortPageHeightPt)

      expect(blocks.length).toBeGreaterThan(1)
      for (const block of blocks) {
        expect(block.heightPt).toBeLessThanOrEqual(shortPageHeightPt)
      }
    })

    it('falls back to shrinking the rung only when elements truly have no gap to cut at', () => {
      // Three touching (zero-gap) nodes can't be split without bisecting one
      // of them, so `gapAlignedCuts` lets the whole chain overflow its band —
      // the last resort here is a further shrink, not a cut through an element.
      const nodes = [0, 100, 200].map((x) => makeNode({ id: `n${x}`, position: { x, y: 0 }, width: 100 }))
      const rung = makeRung({ nodes })
      const narrowPageWidthPt = 100 // contentWidthPx ≈ 133 — well under the 300px touching chain

      const blocks = renderLadderPou([rung], 'normal', narrowPageWidthPt, TALL_CONTENT_PT)

      expect(blocks).toHaveLength(1)
      const clipOp = blocks[0].ops.find((op) => op.kind === 'clipPush')
      expect(clipOp?.kind).toBe('clipPush')
      if (clipOp?.kind === 'clipPush') {
        expect(clipOp.width).toBeLessThanOrEqual(narrowPageWidthPt + 0.01)
      }
    })

    it('merges the closing power rail into the previous band instead of splitting it off alone', () => {
      // Regression: main content ends at x=800, the closing (right) power
      // rail sits at x=830 — a small, real gap. Once the rung is wide enough,
      // `gapAlignedCuts` picks that exact gap as its cut point, which used to
      // leave the bare rail alone in its own band — and, once placed, its own
      // near-blank page.
      const contact = makeNode({ id: 'c1', type: 'contact', position: { x: 0, y: 0 }, width: 100, data: {} })
      const block = makeNode({ id: 'b1', type: 'block', position: { x: 600, y: 0 }, width: 200, data: {} })
      const rail = makeNode({ id: 'rail', type: 'powerRail', position: { x: 830, y: 0 }, width: 4, height: 200 })
      const rung = makeRung({ nodes: [contact, block, rail] })

      // contentWidthPx = 615 / PX_TO_PT ≈ 820 — bigger than the 800px main
      // content, smaller than the full 834px including the rail, so a split
      // is forced but the only real gap available is the one before the rail.
      const blocks = renderLadderPou([rung], 'normal', 615, TALL_CONTENT_PT)

      expect(blocks).toHaveLength(1)
    })

    it('continues a wire cut by a band split onto the next band, instead of dropping the far side', () => {
      // A variable box wired sideways into a block's pin (e.g. a "T_Max" box
      // feeding a TON's PT input) leaves a real gap between the two boxes
      // with nothing in it but the wire itself — a cut is allowed to land
      // there (only node boxes are off-limits), but the wire must then be
      // drawn, clipped, in BOTH resulting bands so it visually continues
      // instead of vanishing on the far side of the cut.
      const variableBox = makeNode({ id: 'v1', type: 'variable', position: { x: 0, y: 0 }, width: 100, data: {} })
      const block = makeNode({ id: 'b1', type: 'block', position: { x: 500, y: 0 }, width: 100, data: {} })
      const edge = makeEdge({ id: 'e1', source: 'v1', target: 'b1' })
      const rung = makeRung({ nodes: [variableBox, block], edges: [edge] })

      // contentWidthPx = 375 / PX_TO_PT = 500 — bigger than the variable box
      // alone (100px), smaller than the full 600px span including the block,
      // so a split is forced right in the gap the wire runs through.
      const blocks = renderLadderPou([rung], 'normal', 375, TALL_CONTENT_PT)

      expect(blocks).toHaveLength(2)
      const pathOpsByBlock = blocks.map((b) => b.ops.filter((op) => op.kind === 'path'))
      expect(pathOpsByBlock[0]).toHaveLength(1)
      expect(pathOpsByBlock[1]).toHaveLength(1)
      // Same wire (identical path data), each copy shifted to its own band's origin.
      const [first, second] = pathOpsByBlock.map((ops) => ops[0])
      expect(first?.kind).toBe('path')
      expect(second?.kind).toBe('path')
      if (first?.kind === 'path' && second?.kind === 'path') {
        expect(first.d).toBe(second.d)
        expect(first.x).not.toBe(second.x)
      }
    })
  })
})
