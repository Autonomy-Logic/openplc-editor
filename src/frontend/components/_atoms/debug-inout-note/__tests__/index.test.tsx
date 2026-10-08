/**
 * The note at the top of a force menu opened on a function block's in-out
 * (IEC 61131-3 §3.48: the in-out is the caller's variable).
 */
import { render, screen } from '@testing-library/react'

import { packDebugAddr, parseDebugMap } from '../../../../utils/debug-parser'
import { clearDebugLeafAccess, registerDebugLeafAccess } from '../../../../utils/inout-force'
import { DebugInOutNote } from '..'

const at = (elemIdx: number) => packDebugAddr({ arrayIdx: 0, elemIdx })

beforeEach(() => {
  const map = parseDebugMap(
    JSON.stringify({
      version: 2,
      md5: 'abc',
      typeTags: {},
      arrays: [{ index: 0, count: 3 }],
      leaves: [
        { arrayIdx: 0, elemIdx: 0, path: 'INSTANCE0.COUNTER', type: 'INT', size: 2 },
        {
          arrayIdx: 0,
          elemIdx: 1,
          path: 'INSTANCE0.ACC0.TOTAL',
          type: 'INT',
          size: 2,
          readOnly: true,
          indirect: true,
          target: 'INSTANCE0.COUNTER',
        },
        { arrayIdx: 0, elemIdx: 2, path: 'INSTANCE0.ACC1.TOTAL', type: 'INT', size: 2, readOnly: true, indirect: true },
      ],
    }),
  )
  if (!map) throw new Error('fixture did not parse')
  registerDebugLeafAccess(map, new Map([['main:counter', at(0)]]))
})

afterEach(() => clearDebugLeafAccess())

describe('DebugInOutNote', () => {
  it('names the variable a force of the in-out goes to', () => {
    render(<DebugInOutNote debugIndex={at(1)} />)
    expect(screen.getByRole('note').textContent).toBe('In-out: shows main:counter. Forcing it forces main:counter.')
  })

  it('says an in-out without a target is read-only', () => {
    render(<DebugInOutNote debugIndex={at(2)} />)
    expect(screen.getByRole('note').textContent).toContain('read-only')
  })

  it('renders nothing for an ordinary variable', () => {
    const { container } = render(<DebugInOutNote debugIndex={at(0)} />)
    expect(container.firstChild).toBeNull()
  })
})
