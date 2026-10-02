/**
 * Two blocks in one POU that declare the same pin name.
 *
 * The pin map used to be keyed on the pin name alone, for the whole POU, so
 * three SoftMotion blocks each declaring `POSITION` collided and the last entry
 * in the document silently won on all of them — a homing move and an index move
 * both went to the current position. The diagram drew correctly and the project
 * compiled; only the generated ST showed it.
 */

import { openPLCStoreBase } from '@root/frontend/store'

import { applyLadderBody } from '../apply/ladder'
import type { SpecLadderBody } from '../apply/schema'

const TON = 'system/iec-standard-fb/TON'

/** Both timers in ONE rung: power runs through the first and on into the second. */
const body: SpecLadderBody = {
  rungs: [
    {
      comment: 'two timers in series, each with its own preset',
      logic: { contact: { variable: 'A', variant: 'default' } },
      outputs: [
        { block: { call: TON, instance: 't1', inputs: { PT: 'FirstPreset' } } },
        { block: { call: TON, instance: 't2', inputs: { PT: 'SecondPreset' } } },
      ],
    },
    {
      comment: 'a third, in a rung of its own',
      logic: { contact: { variable: 'B', variant: 'default' } },
      outputs: [{ block: { call: TON, instance: 't3', inputs: { PT: 'ThirdPreset' } } }],
    },
  ],
}

describe('applyLadderBody — a pin name shared by two blocks', () => {
  it('gives each block the variable the spec asked for', () => {
    const state = openPLCStoreBase.getState()
    state.pouActions.create({ name: 'Timers', type: 'program', language: 'ld' } as never)

    const errors = applyLadderBody('Timers', body)
    expect(errors).toEqual([])

    const flow = openPLCStoreBase.getState().ladderFlows.find((entry) => entry.name === 'Timers')

    /** Every `PT` element in a rung, in the order its owning block was placed. */
    const presetsIn = (rung: number) => {
      const nodes = flow?.rungs[rung].nodes ?? []
      const blocks = nodes.filter((node) => node.type === 'block').map((node) => node.id)
      return blocks.map((blockId) => {
        const element = nodes.find((node) => {
          const data = node.data as { block?: { id?: string; handleId?: string } }
          return node.type === 'variable' && data.block?.id === blockId && data.block.handleId === 'PT'
        })
        return (element?.data as { variable?: { name?: string } } | undefined)?.variable?.name
      })
    }

    // Two blocks in the same rung, each keeping its own preset.
    expect(presetsIn(0)).toEqual(['FirstPreset', 'SecondPreset'])
    // And a block in another rung is not reached by either.
    expect(presetsIn(1)).toEqual(['ThirdPreset'])
  })
})

/**
 * Naming a pin's variable is only half of what the GUI does: it also records the
 * connection on the BLOCK, in `data.connectedVariables`. That list is what tells
 * the editor a pin already shows its own value — `BlockOutputDebugBadges` skips
 * an output it finds there. Leaving it empty drew the debug value twice on every
 * named output pin, once from the element and once from the block.
 */
describe('applyLadderBody — the connection recorded on the block', () => {
  it('records each named pin, so the editor knows the pin shows its own value', () => {
    const state = openPLCStoreBase.getState()
    state.pouActions.create({ name: 'Recorded', type: 'program', language: 'ld' } as never)

    const errors = applyLadderBody('Recorded', {
      rungs: [
        {
          logic: { contact: { variable: 'A', variant: 'default' } },
          outputs: [{ block: { call: TON, instance: 't1', inputs: { PT: 'Preset' }, outputs: { ET: 'Elapsed' } } }],
        },
      ],
    } as SpecLadderBody)
    expect(errors).toEqual([])

    const flow = openPLCStoreBase.getState().ladderFlows.find((entry) => entry.name === 'Recorded')
    const block = (flow?.rungs[0].nodes ?? []).find((node) => node.type === 'block')
    const recorded = (block?.data as { connectedVariables?: Array<{ handleId: string; type: string }> })
      .connectedVariables

    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handleId: 'PT', type: 'input' }),
        // The output is the one that matters: without it the value is drawn twice.
        expect.objectContaining({ handleId: 'ET', type: 'output' }),
      ]),
    )
  })
})
