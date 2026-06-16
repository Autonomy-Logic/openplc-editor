import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'
import { restampFlowLibraryVariants } from '../restamp-library-variants'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** A system library whose ADR function now returns __XWORD (was ULINT). */
function makeSystemLibraries(): SystemLibrary[] {
  return [
    {
      name: 'STANDARD_FUNCTIONS',
      pous: [
        {
          name: 'ADR',
          type: 'function',
          language: 'st',
          body: '',
          documentation: '',
          variables: [
            { name: 'OUT', class: 'output', type: { definition: 'base-type', value: '__XWORD' } },
            { name: 'IN', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
          ],
        },
      ],
    },
  ] as unknown as SystemLibrary[]
}

/** A block node whose ADR variant is still stamped with the old ULINT return. */
function makeStaleAdrNode() {
  return {
    id: 'block-1',
    type: 'block',
    data: {
      variant: {
        name: 'ADR',
        type: 'function',
        language: 'st',
        body: '',
        documentation: '',
        variables: [
          { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
          { name: 'IN', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
        ],
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('restampFlowLibraryVariants', () => {
  it('refreshes a stale library block return type (ADR ULINT -> __XWORD)', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(1)
    expect(node.data.variant.variables.find((v) => v.name === 'OUT')!.type.value).toBe('__XWORD')
  })

  it('walks every rung of a ladder flow', () => {
    const node = makeStaleAdrNode()
    const flow = { rungs: [{ nodes: [] }, { nodes: [node] }] }

    const changed = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(1)
    expect(node.data.variant.variables[0].type.value).toBe('__XWORD')
  })

  it('skips blocks backed by a user-defined POU', () => {
    // A user POU named "ADR" (contrived) must NOT be re-stamped even though a
    // library entry of the same name exists.
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowLibraryVariants([flow], makeSystemLibraries(), ['ADR'])

    expect(changed).toBe(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('leaves up-to-date variants untouched (no spurious changes)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.variables[0].type.value = '__XWORD'
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(0)
  })

  it('ignores blocks not present in any library (user blocks, unknown types)', () => {
    const node = makeStaleAdrNode()
    node.data.variant.name = 'MY_CUSTOM_FB'
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowLibraryVariants([flow], makeSystemLibraries(), [])

    expect(changed).toBe(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })

  it('is a no-op when no libraries are loaded yet', () => {
    const node = makeStaleAdrNode()
    const flow = { rung: { nodes: [node] } }

    const changed = restampFlowLibraryVariants([flow], [], [])

    expect(changed).toBe(0)
    expect(node.data.variant.variables[0].type.value).toBe('ULINT')
  })
})
