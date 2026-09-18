import type { ShmLeaf } from '../shm-leaves'
import { renderLayoutTable } from '../shm-layout-table'
import { SHM_SCALAR_TYPES, SHM_STRING, SHM_WSTRING } from '../shm-type-map'

const leaf = (over: Partial<ShmLeaf>): ShmLeaf => ({
  field: 'x',
  path: ['x'],
  access: 'X',
  objectPath: [null],
  descriptor: SHM_SCALAR_TYPES.int,
  ...over,
})

describe('renderLayoutTable', () => {
  it('renders an empty layout as an empty tuple, needing no special case downstream', () => {
    // A block with no inbound variables is ordinary, and the runtime iterates an
    // empty tuple happily.
    expect(renderLayoutTable('_SHM_IN', [])).toBe('_SHM_IN = ()')
  })

  it('accumulates offsets in leaf order, matching the packed struct', () => {
    // The C struct is emitted `#pragma pack(push, 1)` from the same leaf list in
    // the same order, so the offset of a field is the sum of the widths before
    // it. This is the arithmetic both sides depend on.
    const table = renderLayoutTable('_SHM_IN', [
      leaf({ field: 'a', path: ['a'], descriptor: SHM_SCALAR_TYPES.bool }),
      leaf({ field: 'b', path: ['b'], descriptor: SHM_SCALAR_TYPES.dint }),
      leaf({ field: 'c', path: ['c'], descriptor: SHM_SCALAR_TYPES.int }),
    ])

    expect(table).toContain(`(('a',), (None,), 'B', 0, 1, None),`)
    expect(table).toContain(`(('b',), (None,), 'i', 1, 4, None),`)
    expect(table).toContain(`(('c',), (None,), 'h', 5, 2, None),`)
  })

  it('marks a string by kind rather than by format, because it is two struct items', () => {
    const table = renderLayoutTable('_SHM_IN', [
      leaf({ field: 's', path: ['s'], descriptor: SHM_STRING }),
      leaf({ field: 'w', path: ['w'], descriptor: SHM_WSTRING }),
    ])

    expect(table).toContain(`(('s',), (None,), 'str', 0, 127, None),`)
    expect(table).toContain(`(('w',), (None,), 'wstr', 127, 253, None),`)
  })

  it('writes an index as a number and a member as a quoted name', () => {
    // The runtime tells a list node from an object node by that distinction, so
    // the literal has to preserve it rather than flatten everything to strings.
    const table = renderLayoutTable('_SHM_IN', [
      leaf({ field: 'bank_0_speed', path: ['bank', 0, 'speed'], objectPath: [null, 'Motor', null] }),
    ])

    expect(table).toContain(`(('bank', 0, 'speed'), (None, 'Motor', None), 'h', 0, 2, None),`)
  })

  it('gives a one-element tuple its trailing comma, or Python reads it as a scalar', () => {
    const table = renderLayoutTable('_SHM_IN', [leaf({})])

    expect(table).toContain(`(('x',), (None,),`)
    expect(table).not.toContain(`(('x'), (None),`)
  })

  it('names the enumeration class when there is one', () => {
    const table = renderLayoutTable('_SHM_IN', [leaf({ enumTypeName: 'Mode' })])

    expect(table).toContain(`'Mode'),`)
  })
})
