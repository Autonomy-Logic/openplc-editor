/**
 * Pin resolution on an FBD block, and the one block that numbers its inputs
 * from zero.
 *
 * Extensible blocks are grown to fit a wired `IN<n>`. The growth index used to
 * be derived from how MANY `IN` pins a block declared, which is the same number
 * as the next index only while the block is 1-based. `MUX` declares
 * `K`, `IN0`, `IN1`, so `IN2` was accepted as legal and then never added — the
 * connection survived to a pin that did not exist — and `IN3` left a hole at
 * `IN2` that the transpiler emits as a missing argument.
 *
 * The catalogue has 15 extensible blocks and `MUX` is the only 0-based one, so
 * nothing else would have caught it.
 */

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

/**
 * `build-graph` reaches the FBD component modules, which do not load under jest.
 * The stand-in also RECORDS the nodes it is handed: "no error" is not enough
 * evidence here, because the bug this file exists for accepted a pin and then
 * failed to add it. The grown pin list is the thing to assert on.
 */
const handed: { nodes: unknown[] } = { nodes: [] }
jest.mock('@root/frontend/store/slices/fbd/utils/build-graph', () => ({
  buildFbdGraph: (nodes: unknown[]) => {
    handed.nodes = nodes
    return { nodes: [], edges: [], brokenCycles: [], errors: [] }
  },
}))

import { openPLCStoreBase } from '@root/frontend/store'

import { applyFbdBody } from '../apply/fbd'
import type { SpecFbdBody } from '../apply/schema'

const input = (name: string) => ({ name, class: 'input', type: { definition: 'base-type', value: 'INT' } })
const output = (name: string) => ({ name, class: 'output', type: { definition: 'base-type', value: 'INT' } })

const LIB: SystemLibrary = {
  name: 'iec-std-functions',
  version: '1.0.0',
  pous: [
    // 1-based, the common shape.
    { name: 'ADD', type: 'function', extensible: true, variables: [input('IN1'), input('IN2'), output('OUT')] },
    // 0-based — the whole point of this file.
    {
      name: 'MUX',
      type: 'function',
      extensible: true,
      variables: [input('K'), input('IN0'), input('IN1'), output('OUT')],
    },
    // Not extensible: a pin it does not declare is an error.
    { name: 'SEL', type: 'function', variables: [input('G'), input('IN0'), output('OUT')] },
  ],
} as unknown as SystemLibrary

beforeEach(() => {
  openPLCStoreBase.getState().libraryActions.setSystemLibraries([LIB])
})

const wire = (call: string, pin: string): SpecFbdBody =>
  ({
    nodes: [
      { label: 'src', kind: 'input-variable', variable: 'a' },
      { label: 'blk', kind: 'block', call },
    ],
    connections: [{ from: 'src', to: `blk.${pin}` }],
  }) as unknown as SpecFbdBody

const errorsFor = (call: string, pin: string) => applyFbdBody('Main', wire(call, pin))

/** The input pins the block ended up with, as handed to the graph builder. */
const grownPins = (call: string, pin: string): string[] => {
  handed.nodes = []
  applyFbdBody('Main', wire(call, pin))
  const block = (handed.nodes as { kind: string; variant?: { variables?: { name: string; class?: string }[] } }[]).find(
    (node) => node.kind === 'block',
  )
  return (block?.variant?.variables ?? []).filter((v) => v.class === 'input').map((v) => v.name)
}

describe('a 1-based extensible block', () => {
  it('accepts a declared pin', () => {
    expect(errorsFor('system/iec-std-functions/ADD', 'IN2')).toEqual([])
  })

  it('grows to the next pin', () => {
    expect(grownPins('system/iec-std-functions/ADD', 'IN3')).toEqual(['IN1', 'IN2', 'IN3'])
  })

  it('grows across a jump without leaving a hole', () => {
    expect(grownPins('system/iec-std-functions/ADD', 'IN6')).toEqual(['IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6'])
  })
})

describe('MUX, which numbers its inputs from zero', () => {
  it('accepts its declared pins', () => {
    expect(errorsFor('system/iec-std-functions/MUX', 'IN0')).toEqual([])
    expect(errorsFor('system/iec-std-functions/MUX', 'K')).toEqual([])
  })

  it('ADDS IN2 — the next pin after IN1, not IN3', () => {
    // The original bug: `IN2` was reported legal and never created, so the
    // connection pointed at a pin the block did not have.
    expect(grownPins('system/iec-std-functions/MUX', 'IN2')).toEqual(['K', 'IN0', 'IN1', 'IN2'])
  })

  it('fills the gap rather than leaving a hole at IN2', () => {
    expect(grownPins('system/iec-std-functions/MUX', 'IN4')).toEqual(['K', 'IN0', 'IN1', 'IN2', 'IN3', 'IN4'])
  })
})

describe('a block that is not extensible', () => {
  it('refuses a pin it does not declare, and lists the ones it has', () => {
    const errors = errorsFor('system/iec-std-functions/SEL', 'IN5')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('has no input pin "IN5"')
    expect(errors[0]).toContain('G, IN0, OUT')
  })

  it('accepts EN and ENO, which the editor adds itself', () => {
    expect(errorsFor('system/iec-std-functions/SEL', 'EN')).toEqual([])
  })
})
