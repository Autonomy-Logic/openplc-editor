import type { Node } from '@xyflow/react'

import type { RungLadderState } from '@root/frontend/store/slices'

import { getPreviousElement } from '../index'

/**
 * Minimal node/rung factories — getPreviousElement only reads node.type,
 * node.id and node.data.branchContext.
 */
const node = (
  id: string,
  type: string,
  branchContext?: { blockId: string; handleId: string; direction: 'input' | 'output' },
): Node =>
  ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: branchContext ? { branchContext } : {},
  }) as unknown as Node

const rung = (nodes: Node[]): RungLadderState => ({ nodes }) as unknown as RungLadderState

describe('getPreviousElement', () => {
  // Regression: adding a coil to a counter block's primary output corrupted a
  // handle branch (e.g. a contact on the R input). Branch elements are
  // interleaved in the node array between the block and the right rail, so a
  // freshly-inserted main-line coil's placeholder sits AFTER the branch contact.
  // The old index-based walk picked the branch contact as the serial
  // predecessor and spliced the coil into the branch edge (dropping the coil and
  // breaking the branch). The predecessor must be the block, skipping the branch.
  it('returns the main-line predecessor, skipping handle-branch elements', () => {
    const r = rung([
      node('left-rail', 'powerRail'),
      node('cu-contact', 'contact'),
      node('block', 'block'),
      node('r-contact', 'contact', { blockId: 'block', handleId: 'R', direction: 'input' }),
      node('new-coil', 'coil'),
      node('right-rail', 'powerRail'),
    ])

    const previous = getPreviousElement(r, 'new-coil')

    expect(previous.id).toBe('block')
    expect(previous.id).not.toBe('r-contact')
  })

  it('skips placeholders and variables when resolving the predecessor', () => {
    const r = rung([
      node('left-rail', 'powerRail'),
      node('contact-1', 'contact'),
      node('a-variable', 'variable'),
      node('a-placeholder', 'placeholder'),
      node('new-contact', 'contact'),
      node('right-rail', 'powerRail'),
    ])

    expect(getPreviousElement(r, 'new-contact').id).toBe('contact-1')
  })

  it('skips multiple consecutive branch elements before the inserted node', () => {
    const r = rung([
      node('left-rail', 'powerRail'),
      node('block', 'block'),
      node('cd-contact', 'contact', { blockId: 'block', handleId: 'CD', direction: 'input' }),
      node('r-contact', 'contact', { blockId: 'block', handleId: 'R', direction: 'input' }),
      node('new-coil', 'coil'),
      node('right-rail', 'powerRail'),
    ])

    expect(getPreviousElement(r, 'new-coil').id).toBe('block')
  })
})
