/**
 * @jest-environment node
 * @vitest-environment node
 */
import { loadCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  loadedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import { layoutRung } from '@root/middleware/shared/utils/ladder-layout/layout'
import { LADDER_PALETTE } from '@root/middleware/shared/utils/ladder-layout/style'
import type { Node } from '@xyflow/react'

import { renderLadderPou } from '../ladder-painter'
import type { DrawOp } from '../types'

describe('renderLadderPou', () => {
  it('draws one block per rung and the End row, in the paper palette, with every label and the whole comment', () => {
    const data = loadCorpusProject('ld-corpus-parallel-width')
    const labels = corpusLabelSource(data, 'Blocks')
    const comment = `First line\nA second line long enough to wrap: ${'conveyor infeed ready '.repeat(12)}${'x'.repeat(120)}`
    const variants = (node: Node): Node =>
      node.type === 'coil' || node.type === 'contact'
        ? { ...node, data: { ...node.data, variant: node.type === 'coil' ? 'set' : 'negated' } }
        : node
    const rungs = loadedRungs(data, 'Blocks').map((rung, index) => ({
      ...rung,
      comment: index === 0 ? comment : rung.comment,
      nodes: rung.nodes.map(variants),
    }))
    const blocks = renderLadderPou({ name: 'Blocks', kind: 'ld', rungs, variables: [], labels }, 'normal', 220, 770)

    expect(blocks).toHaveLength(rungs.length + 1)
    const ops: DrawOp[] = blocks.flatMap((block) => block.ops)
    const paper = new Set(Object.values(LADDER_PALETTE.paper))
    const colours = ops.flatMap((op) =>
      op.kind === 'line' || op.kind === 'text'
        ? [op.color]
        : [op.kind === 'clipPop' || op.kind === 'clipPush' ? undefined : (op.fill ?? op.stroke)],
    )
    expect(colours.filter((colour) => colour !== undefined && !paper.has(colour))).toEqual([])

    expect(ops.some((op) => op.kind === 'path' && op.fill === LADDER_PALETTE.paper.bg)).toBe(true)
    const texts = ops.filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text')
    const labelTexts = rungs.flatMap((rung) => [...layoutRung(rung, labels).labels.values()].flat().map((l) => l.text))
    const drawn = new Set(texts.map((op) => op.text))
    expect(labelTexts.filter((text) => text !== '' && !drawn.has(text))).toEqual([])
    expect(texts.every((op) => op.font === 'ldMono' || op.font === 'ldMonoSemibold')).toBe(true)

    const labelSet = new Set(labelTexts)
    const commentLines = blocks[0].ops.filter(
      (op) => op.kind === 'text' && op.align === 'left' && !labelSet.has(op.text),
    )
    const printed = commentLines.map((op) => (op.kind === 'text' ? op.text : '')).join(' ')
    expect(commentLines.length).toBeGreaterThan(2)
    expect(printed.replace(/\s+/g, '')).toBe(comment.replace(/\s+/g, ''))
  })
})
