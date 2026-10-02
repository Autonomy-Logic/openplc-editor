import type { Node } from '@xyflow/react'

import { openPLCStoreBase } from '../../../../index'
import { needsPositionRecovery } from '../../slice'
import { buildLadderRung, type RungLogic } from '../build-rung'

/**
 * The handoff, end to end: a rung built with no geometry goes through
 * `addLadderFlow` and comes back laid out by the editor's own solver.
 *
 * This is the post-condition that matters most. `updateDiagramElementsPosition`
 * runs inside a try with guards that silently return the rung unchanged, and the
 * LD walker sorts sinks by y-position — so a rung that quietly failed to lay out
 * does not look broken, it transpiles to the wrong statement order.
 */

const contact = (variable: string): RungLogic => ({ contact: { variable, variant: 'default' } })
const coil = (variable: string) => ({ coil: { variable, variant: 'default' as const } })

function addAndRead(name: string, rungs: ReturnType<typeof buildLadderRung>[]) {
  openPLCStoreBase.getState().ladderFlowActions.addLadderFlow({ name, updated: true, rungs } as never)
  return openPLCStoreBase.getState().ladderFlows.find((flow) => flow.name === name)
}

describe('buildLadderRung through addLadderFlow', () => {
  it('is laid out by the store, not left at the origin', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('Start'), outputs: [coil('Run')] })
    expect(needsPositionRecovery(rung)).toBe(true)

    const flow = addAndRead('LaidOut', [rung])

    expect(flow).toBeDefined()
    expect(flow?.rungs).toHaveLength(1)
    // The whole point: the solver ran, so nothing is at the origin any more.
    expect(needsPositionRecovery(flow!.rungs[0])).toBe(false)
  })

  it('lays out a rung carrying a parallel branch', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { series: [{ parallel: [contact('Start'), contact('Run')] }, contact('Stop')] },
      outputs: [coil('Run')],
    })

    const flow = addAndRead('WithBranch', [rung])

    expect(needsPositionRecovery(flow!.rungs[0])).toBe(false)
  })

  it('orders the elements left to right, which is what the walker reads', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { series: [contact('A'), contact('B'), contact('C')] },
      outputs: [coil('Run')],
    })

    const flow = addAndRead('Ordered', [rung])
    const placed = (flow!.rungs[0].nodes as Node[]).filter((node) => node.type === 'contact')
    const xs = placed.map((node) => node.position.x)

    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(new Set(xs).size).toBe(3)
  })

  it('keeps every rung of a multi-rung flow laid out', () => {
    const rungs = [
      buildLadderRung({ rungId: 'r1', logic: contact('A'), outputs: [coil('X')] }),
      buildLadderRung({ rungId: 'r2', logic: contact('B'), outputs: [coil('Y')] }),
    ]

    const flow = addAndRead('TwoRungs', rungs)

    expect(flow?.rungs).toHaveLength(2)
    for (const rung of flow!.rungs) expect(needsPositionRecovery(rung)).toBe(false)
  })
})
