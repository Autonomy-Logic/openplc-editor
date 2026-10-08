/**
 * The GUI force path for a function block's VAR_IN_OUT.
 *
 * The in-out is the caller's variable (IEC 61131-3 §3.48); its debug leaf is a
 * read-only view the runtime refuses to force. `forceDebugVariable` and
 * `releaseDebugVariable` send the force to the bound variable instead, and
 * record it under that variable's key, so [FORCED] shows where the force lives.
 */

import type { DebuggerPort } from '../../../middleware/shared/ports/debugger-port'
import { useOpenPLCStore } from '../../store'
import { packDebugAddr, parseDebugMap } from '../../utils/debug-parser'
import { clearDebugLeafAccess, registerDebugLeafAccess } from '../../utils/inout-force'
import { forceDebugVariable, releaseDebugVariable } from '../debug-force-variable'

const at = (elemIdx: number) => packDebugAddr({ arrayIdx: 0, elemIdx })

function setUp() {
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
  registerDebugLeafAccess(
    map,
    new Map([
      ['main:counter', at(0)],
      ['main:acc0.total', at(1)],
      ['main:acc1.total', at(2)],
    ]),
  )
  useOpenPLCStore.getState().workspaceActions.setDebugForcedVariables(new Map())

  const calls: Array<{ index: number; force: boolean }> = []
  const port = {
    setVariable: (index: number, force: boolean) => {
      calls.push({ index, force })
      return Promise.resolve({ success: true })
    },
  } as unknown as DebuggerPort
  return { port, calls }
}

const forced = () => useOpenPLCStore.getState().workspace.debugForcedVariables

afterEach(() => clearDebugLeafAccess())

describe('GUI force of a VAR_IN_OUT (IEC 61131-3 §3.48)', () => {
  it('forces the bound variable and records it under that variable', async () => {
    const { port, calls } = setUp()
    const ok = await forceDebugVariable(port, 'main:acc0.total', at(1), new Uint8Array([7, 0]), true, 'INT')

    expect(ok).toBe(true)
    expect(calls).toEqual([{ index: at(0), force: true }])
    expect([...forced().keys()]).toEqual(['main:counter'])
  })

  it('releases the bound variable', async () => {
    const { port, calls } = setUp()
    await forceDebugVariable(port, 'main:acc0.total', at(1), new Uint8Array([7, 0]), true, 'INT')
    const ok = await releaseDebugVariable(port, 'main:acc0.total', at(1))

    expect(ok).toBe(true)
    expect(calls[1]).toEqual({ index: at(0), force: false })
    expect(forced().size).toBe(0)
  })

  it('sends nothing for an in-out whose variable cannot be named', async () => {
    const { port, calls } = setUp()
    const ok = await forceDebugVariable(port, 'main:acc1.total', at(2), new Uint8Array([7, 0]), true, 'INT')

    expect(ok).toBe(false)
    expect(calls).toEqual([])
    expect(forced().size).toBe(0)
  })

  it('forces an ordinary variable at its own index and key', async () => {
    const { port, calls } = setUp()
    await forceDebugVariable(port, 'main:counter', at(0), new Uint8Array([7, 0]), true, 'INT')

    expect(calls).toEqual([{ index: at(0), force: true }])
    expect([...forced().keys()]).toEqual(['main:counter'])
  })
})
