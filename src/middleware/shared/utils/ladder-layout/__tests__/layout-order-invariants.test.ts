/**
 * The layout keeps the LD walker's statement order (BR41): sink bands, left-to-right order on a band and room below the
 * lowest sink survive the layout, so `ldSinkOrder` is unchanged, on the corpus, on crafted B12 rungs and on generated rungs.
 * @jest-environment node
 * @vitest-environment node
 */
import {
  CORPUS_PROJECTS,
  ldPouNames,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  corpusRungName,
  loadedRungs,
  relayout,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import {
  generatedLabelSource,
  generatedSeriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { RungLadderState } from '@root/middleware/shared/ports/types'

import { EMPTY_LABEL_SOURCE } from '../labels'
import { applyRungLayout, layoutRung } from '../layout'
import { ldSinkBuckets, ldSinkOrder } from '../sink-order'

const BAND = 10

interface Sink {
  id: string
  x: number
  y: number
}

/** The sinks of one rung as the walker reads them, with truncated coordinates. */
function sinksOf(rung: RungLadderState): Sink[] {
  const { ordered, others } = ldSinkBuckets([{ nodes: rung.nodes, reactFlowViewport: rung.reactFlowViewport }])
  return [...ordered, ...others].map((node) => ({
    id: node.id,
    x: Math.trunc(node.position.x),
    y: Math.trunc(node.position.y),
  }))
}

/**
 * Every broken invariant between a rung before and after its layout: (a) sinks 10 or more apart in Y stay so in the same
 * direction, sinks within 10 stay within 10; (b) sinks on one band keep their left-to-right order; (c) the rung's height
 * is at least the lowest sink's top + 10.
 */
function invariantBreaks(before: RungLadderState, after: RungLadderState): string[] {
  const breaks: string[] = []
  const was = new Map(sinksOf(before).map((sink) => [sink.id, sink]))
  const now = sinksOf(after)
  now.forEach((a, i) => {
    for (const b of now.slice(i + 1)) {
      const a0 = was.get(a.id)
      const b0 = was.get(b.id)
      if (a0 === undefined || b0 === undefined) continue
      const dyBefore = a0.y - b0.y
      const dyAfter = a.y - b.y
      if (Math.abs(dyBefore) >= BAND) {
        if (Math.abs(dyAfter) < BAND || Math.sign(dyAfter) !== Math.sign(dyBefore))
          breaks.push(`(a) ${a.id}/${b.id}: dy ${dyBefore} became ${dyAfter}`)
        continue
      }
      if (Math.abs(dyAfter) >= BAND) breaks.push(`(a) ${a.id}/${b.id}: on one band (dy ${dyBefore}), now dy ${dyAfter}`)
      const dxBefore = a0.x - b0.x
      const dxAfter = a.x - b.x
      if (dxBefore !== 0 && Math.sign(dxAfter) !== Math.sign(dxBefore))
        breaks.push(`(b) ${a.id}/${b.id}: dx ${dxBefore} became ${dxAfter}`)
    }
  })
  if (now.some((sink) => !was.has(sink.id)) || was.size !== now.length) breaks.push('the sinks changed')
  const lowest = Math.max(...now.map((sink) => sink.y))
  const height = after.reactFlowViewport[1]
  if (now.length > 0 && !(height >= lowest + BAND)) breaks.push(`(c) height ${height} < lowest sink top ${lowest} + 10`)
  return breaks
}

describe('BR41 invariants on every corpus rung', () => {
  for (const project of CORPUS_PROJECTS) {
    const data = loadCorpusProject(project)
    for (const pou of ldPouNames(data)) {
      const before = loadedRungs(data, pou)
      const after = relayout(before, corpusLabelSource(data, pou))
      before.forEach((rung, index) => {
        it(`${corpusRungName(project, pou, index + 1)}: (a)-(c) hold`, () => {
          expect(invariantBreaks(rung, after[index])).toEqual([])
        })
      })
      it(`${project}/${pou}: ldSinkOrder is unchanged`, () => {
        expect(ldSinkOrder(after)).toEqual(ldSinkOrder(before))
      })
    }
  }
})

/** A copy of the rungs whose `count` last coils and blocks in position order get execution orders 1, 2, ..., last first. */
function craftB12(rungs: readonly RungLadderState[], count: number): RungLadderState[] {
  const positional = ldSinkOrder(rungs).filter((id) =>
    rungs.some((rung) => rung.nodes.some((node) => node.id === id && (node.type === 'coil' || node.type === 'block'))),
  )
  const ordered = new Map(
    positional
      .slice(-count)
      .reverse()
      .map((id, index) => [id, index + 1]),
  )
  return rungs.map((rung) => ({
    ...rung,
    nodes: rung.nodes.map((node) => {
      const order = ordered.get(node.id)
      return order === undefined ? node : { ...node, data: { ...node.data, executionOrder: order } }
    }),
  }))
}

describe('BR41 invariants on crafted B12 rungs (execution order > 0)', () => {
  const crafted: readonly [string, 'ld-corpus-basic' | 'ld-corpus-hard', string][] = [
    ['B12 on B10 Aux rungs 1-4', 'ld-corpus-basic', 'Aux'],
    ['B12 on H05/H06/H09 Parallel rungs 1-3', 'ld-corpus-hard', 'Parallel'],
  ]
  for (const [name, project, pou] of crafted) {
    const data = loadCorpusProject(project)
    const saved = loadedRungs(data, pou)
    const before = craftB12(saved, 3)
    const after = relayout(before, corpusLabelSource(data, pou))

    it(`${name}: three sinks carry an execution order, against their position order`, () => {
      expect(ldSinkBuckets(before).ordered).toHaveLength(3)
      expect(ldSinkOrder(before)).not.toEqual(ldSinkOrder(saved))
    })

    before.forEach((rung, index) => {
      it(`${name}, rung ${index + 1}: (a)-(c) hold`, () => {
        expect(invariantBreaks(rung, after[index])).toEqual([])
      })
    })

    it(`${name}: ldSinkOrder is unchanged`, () => {
      expect(ldSinkOrder(after)).toEqual(ldSinkOrder(before))
    })
  }
})

describe('BR41 invariants on generated rungs', () => {
  const SEEDS = [1, 2, 3]
  for (const project of CORPUS_PROJECTS) {
    const data = loadCorpusProject(project)
    for (const pou of ldPouNames(data)) {
      for (const seed of SEEDS) {
        it(`${project}/${pou} with generated locations (seed ${seed}): (a)-(c) hold and ldSinkOrder is unchanged`, () => {
          const before = loadedRungs(data, pou)
          const after = relayout(before, generatedLabelSource(data, pou, seed))
          expect(before.map((rung, index) => invariantBreaks(rung, after[index]))).toEqual(before.map(() => []))
          expect(ldSinkOrder(after)).toEqual(ldSinkOrder(before))
        })
      }
    }
  }

  for (let seed = 101; seed <= 140; seed++) {
    it(`generated series rung ${seed}: locations move no sink across a band`, () => {
      const { rung, src } = generatedSeriesRung(seed)
      const before = applyRungLayout(rung, layoutRung(rung, EMPTY_LABEL_SOURCE))
      const after = applyRungLayout(before, layoutRung(before, src))
      expect(invariantBreaks(before, after)).toEqual([])
      expect(ldSinkOrder([after])).toEqual(ldSinkOrder([before]))
    })
  }
})
