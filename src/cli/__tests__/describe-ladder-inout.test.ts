/**
 * An in-out pin has to survive `describe`.
 *
 * `apply` reads an in-out from the block's `inputs` — it accepts both the
 * `input` and `inOut` classes there — so `describe` has to put it there too.
 * It did not, and because IEC refuses a call that leaves an in-out unassigned,
 * a `describe | apply` round trip turned a building project into one that
 * would not compile.
 */

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

import { describeLadderBody } from '../describe/ladder'

const libraries = [{ name: 'net', pous: [{ name: 'HELPER' }] }] as unknown as SystemLibrary[]

/** One rung: left rail -> HELPER -> right rail, with `pins` hung off the block. */
const rung = (pins: Array<{ pin: string; name: string; class: string }>) => ({
  rungs: [
    {
      comment: '',
      nodes: [
        { id: 'left-rail-1', type: 'powerRail' },
        { id: 'right-rail-1', type: 'powerRail' },
        { id: 'blk', type: 'block', data: { variant: { name: 'HELPER' }, variable: { name: 'h0' } } },
        ...pins.map((p, i) => ({
          id: `var${i}`,
          type: 'variable',
          data: {
            block: { id: 'blk', handleId: p.pin, variableType: { class: p.class } },
            variable: { name: p.name },
          },
        })),
      ],
      edges: [
        { source: 'left-rail-1', target: 'blk' },
        { source: 'blk', target: 'right-rail-1' },
      ],
    },
  ],
})

const blockOf = (value: unknown) => {
  const result = describeLadderBody(value, libraries)
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`)
  const [first] = result.body.rungs as Array<{ outputs: Array<{ block: Record<string, unknown> }> }>
  return first.outputs[0].block
}

describe('describing a ladder block', () => {
  it('reports an in-out under inputs, where apply reads it', () => {
    const block = blockOf(rung([{ pin: 'NODE', name: 'NET.node', class: 'inOut' }]))

    expect(block.inputs).toEqual({ NODE: 'NET.node' })
  })

  it('keeps plain inputs and outputs on their own sides', () => {
    const block = blockOf(
      rung([
        { pin: 'NODE', name: 'NET.node', class: 'inOut' },
        { pin: 'PEER', name: '20', class: 'input' },
        { pin: 'STATUS', name: 'st', class: 'output' },
      ]),
    )

    expect(block.inputs).toEqual({ NODE: 'NET.node', PEER: '20' })
    expect(block.outputs).toEqual({ STATUS: 'st' })
  })

  it('still ignores a pin of no known class', () => {
    const block = blockOf(
      rung([
        { pin: 'PEER', name: '20', class: 'input' },
        { pin: 'ODD', name: 'x', class: 'local' },
      ]),
    )

    expect(block.inputs).toEqual({ PEER: '20' })
  })
})
