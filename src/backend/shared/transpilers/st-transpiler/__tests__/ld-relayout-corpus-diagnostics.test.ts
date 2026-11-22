/**
 * Failure messages of the corpus guard name the project, POU, rung and the first moved sink.
 * @jest-environment node
 * @vitest-environment node
 */
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import { describeStDifference } from './ld-relayout-corpus/diagnostics'

const rail = (id: string, variant: 'left' | 'right', x: number, y = 30): Node => ({
  id,
  type: 'powerRail',
  position: { x, y },
  data: { variant },
})
const contact = (id: string, name: string, x: number, y = 38): Node => ({
  id,
  type: 'contact',
  position: { x, y },
  data: { variant: 'default', variable: { name } },
})
const coil = (id: string, name: string, x: number, y = 38): Node => ({
  id,
  type: 'coil',
  position: { x, y },
  data: { variant: 'default', variable: { name }, executionOrder: 0 },
})
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target })
const rung = (id: string, comment: string, nodes: Node[], edges: Edge[]): RungLadderState => ({
  id,
  comment,
  defaultBounds: [300, 100],
  reactFlowViewport: [600, 200],
  selectedNodes: [],
  nodes,
  edges,
})

/** A rung `left -> contact -> coil -> right`, with ids suffixed by `tag` and the coil at `coilX`. */
function simpleRung(tag: string, comment: string, input: string, output: string, coilX = 300): RungLadderState {
  return rung(
    tag,
    comment,
    [
      rail(`L${tag}`, 'left', 0),
      contact(`c${tag}`, input, 100),
      coil(`k${tag}`, output, coilX),
      rail(`R${tag}`, 'right', 500),
    ],
    [edge(`L${tag}`, `c${tag}`), edge(`c${tag}`, `k${tag}`), edge(`k${tag}`, `R${tag}`)],
  )
}

/** Two rungs of `Main`: `x := a` then `y := b`. */
function mainRungs(): RungLadderState[] {
  return [
    simpleRung('1', 'B01 series-contacts-coil', 'a', 'x'),
    simpleRung('2', 'B02 nested-parallel-branches', 'b', 'y'),
  ]
}

/** One rung with two independent paths: contact `a` to coil `x` at `yX`, contact `b` to coil `y` at `yY`. */
function twoPathRung(yX: number, yY: number): RungLadderState {
  return rung(
    'r1',
    'H07 block-feeds-block',
    [
      rail('L', 'left', 0),
      contact('ca', 'a', 100, yX),
      coil('kx', 'x', 300, yX),
      contact('cb', 'b', 100, yY),
      coil('ky', 'y', 300, yY),
      rail('R', 'right', 500),
    ],
    [edge('L', 'ca'), edge('ca', 'kx'), edge('kx', 'R'), edge('L', 'cb'), edge('cb', 'ky'), edge('ky', 'R')],
  )
}

describe('describeStDifference', () => {
  it('returns an empty string when nothing differs', () => {
    expect(describeStDifference('ld-corpus-basic', 'Main', mainRungs(), mainRungs())).toBe('')
  })

  it('names the project, POU, rung number and rung comment of the one rung whose statements changed', () => {
    const after = [mainRungs()[0], simpleRung('2', 'B02 nested-parallel-branches', 'c', 'y')]
    expect(describeStDifference('ld-corpus-basic', 'Main', mainRungs(), after)).toBe(
      'ld-corpus-basic/Main/rung 2 (B02 nested-parallel-branches): emitted statements differ',
    )
  })

  it('names the first moved sink and its rung when the statement order inside a rung changes', () => {
    const message = describeStDifference('ld-corpus-hard', 'Chains', [twoPathRung(38, 138)], [twoPathRung(138, 38)])
    expect(message.split('\n')).toContain(
      'ld-corpus-hard/Chains: statement order differs; first moved sink ky (rung 1)',
    )
  })

  it('reports a cross-rung order change on its own when every rung alone emits the same statements', () => {
    const body = (firstRungHeight: number): RungLadderState[] => [
      { ...simpleRung('1', 'B10 multi-rung-boundary-sinks', 'a', 'x', 300), reactFlowViewport: [600, firstRungHeight] },
      simpleRung('2', 'B10 multi-rung-boundary-sinks', 'b', 'y', 200),
    ]
    expect(describeStDifference('ld-corpus-basic', 'Aux', body(200), body(0))).toBe(
      'ld-corpus-basic/Aux: statement order differs; first moved sink k2 (rung 2)',
    )
  })

  it('names a sink that is gone with the rung it had before', () => {
    const after = [mainRungs()[0], { ...mainRungs()[1], nodes: [], edges: [] }]
    expect(describeStDifference('ld-corpus-basic', 'Main', mainRungs(), after).split('\n')).toEqual([
      'ld-corpus-basic/Main/rung 2 (B02 nested-parallel-branches): emitted statements differ',
      'ld-corpus-basic/Main: statement order differs; first moved sink k2 (rung 2)',
    ])
  })
})
