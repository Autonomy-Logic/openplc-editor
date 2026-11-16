import type { Node } from '@xyflow/react'

import { graphicalElementModalFor } from '../slices/modal'
import type { GraphicalElementModalData } from '../slices/modal/types'

const NODE: Node = { id: 'CONTACT_1', type: 'contact', position: { x: 0, y: 0 }, data: { variant: 'default' } }

const payloadFor = (pouName: string): GraphicalElementModalData => ({ pouName, node: NODE })

describe('graphicalElementModalFor returns the payload only to the editor that owns the node', () => {
  it('returns the payload when the modal is open and its pouName equals the bound POU', () => {
    expect(graphicalElementModalFor({ open: true, data: payloadFor('lda') }, 'lda')).toEqual({
      pouName: 'lda',
      node: NODE,
    })
  })

  it('returns null for a payload that names another POU', () => {
    expect(graphicalElementModalFor({ open: true, data: payloadFor('ldb') }, 'lda')).toBeNull()
  })

  it('compares the POU name exactly, so a name differing only in case is another POU', () => {
    expect(graphicalElementModalFor({ open: true, data: payloadFor('LDA') }, 'lda')).toBeNull()
  })

  it('returns null for a closed modal even when the payload names the bound POU', () => {
    expect(graphicalElementModalFor({ open: false, data: payloadFor('lda') }, 'lda')).toBeNull()
  })

  it('returns null when there is no modal state', () => {
    expect(graphicalElementModalFor(undefined, 'lda')).toBeNull()
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'lda'],
  ])('returns null for %s data', (_label, data) => {
    expect(graphicalElementModalFor({ open: true, data }, 'lda')).toBeNull()
  })

  it('returns null for a bare node with no pouName, the payload shape the openers used to send', () => {
    expect(graphicalElementModalFor({ open: true, data: NODE }, 'lda')).toBeNull()
  })

  it('returns null when pouName is not a string', () => {
    expect(graphicalElementModalFor({ open: true, data: { pouName: 1, node: NODE } }, 'lda')).toBeNull()
  })

  it.each<[string, unknown]>([
    ['no node', { pouName: 'lda' }],
    ['a null node', { pouName: 'lda', node: null }],
    ['a node that is a string', { pouName: 'lda', node: 'CONTACT_1' }],
    ['a node without an id', { pouName: 'lda', node: { type: 'contact', position: { x: 0, y: 0 }, data: {} } }],
    ['a node whose id is not a string', { pouName: 'lda', node: { id: 1, position: { x: 0, y: 0 }, data: {} } }],
  ])('returns null for a payload with %s', (_label, data) => {
    expect(graphicalElementModalFor({ open: true, data }, 'lda')).toBeNull()
  })

  it('returns null for an empty bound POU, even when the payload pouName is empty too', () => {
    expect(graphicalElementModalFor({ open: true, data: payloadFor('') }, '')).toBeNull()
  })
})
