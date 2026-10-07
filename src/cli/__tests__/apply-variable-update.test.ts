/**
 * A spec is a declaration: re-applying it without a variable's `retain` flag
 * or initial value removes them. The store merges an update into the existing
 * variable, so an absent key used to keep its old value, and a block whose
 * RETAIN the spec had dropped went on retaining.
 */

import { openPLCStoreBase } from '@root/frontend/store'

jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const BOOL = { definition: 'base-type' as const, value: 'BOOL' }

const apply = (spec: Partial<ApplySpec>) =>
  applySpec({ specVersion: 1, ...spec } as ApplySpec, { prune: true, projectPath: '/does/not/matter' })

const fb = (variable: Record<string, unknown>) => ({
  pous: [
    {
      name: 'FB_KEEP',
      kind: 'function-block' as const,
      language: 'st' as const,
      variables: [{ name: 'runReq', class: 'local' as const, type: BOOL, ...variable }],
      body: { text: '' },
    },
  ],
})

const runReq = () =>
  openPLCStoreBase
    .getState()
    .project.data.pous.find((pou) => pou.name === 'FB_KEEP')
    ?.interface?.variables.find((variable) => variable.name === 'runReq')

describe('re-applying a variable without its flag or initial value', () => {
  it('drops RETAIN and the initial value', async () => {
    await apply(fb({ flag: 'retain', initialValue: 'TRUE' }) as Partial<ApplySpec>)
    expect(runReq()?.flag).toBe('retain')
    expect(runReq()?.initialValue).toBe('TRUE')

    const result = await apply(fb({}) as Partial<ApplySpec>)
    expect(result.errors).toEqual([])
    expect(runReq()?.flag).toBeUndefined()
    expect(runReq()?.initialValue ?? '').toBe('')
  })

  it('keeps them while the spec still has them', async () => {
    await apply(fb({ flag: 'retain', initialValue: 'TRUE' }) as Partial<ApplySpec>)
    await apply(fb({ flag: 'retain', initialValue: 'TRUE' }) as Partial<ApplySpec>)
    expect(runReq()?.flag).toBe('retain')
    expect(runReq()?.initialValue).toBe('TRUE')
  })
})

describe('re-applying a function-block-typed in-out pin', () => {
  // The editor's table resets a variable to `local` when its type becomes a
  // function block. Re-applying a library whose blocks take each other on
  // in-out pins (`NODE : BEEBUS_NODE`) used to turn every such pin into a VAR.
  const spec = {
    pous: [
      {
        name: 'FB_NODE',
        kind: 'function-block' as const,
        language: 'st' as const,
        variables: [{ name: 'ready', class: 'output' as const, type: BOOL }],
        body: { text: '' },
      },
      {
        name: 'FB_USER',
        kind: 'function-block' as const,
        language: 'st' as const,
        variables: [{ name: 'NODE', class: 'inOut' as const, type: { definition: 'derived' as const, value: 'FB_NODE' } }],
        body: { text: '' },
      },
    ],
  }
  const node = () =>
    openPLCStoreBase
      .getState()
      .project.data.pous.find((pou) => pou.name === 'FB_USER')
      ?.interface?.variables.find((variable) => variable.name === 'NODE')

  it('keeps the inOut class on every apply', async () => {
    expect((await apply(spec as Partial<ApplySpec>)).errors).toEqual([])
    expect(node()?.class).toBe('inOut')
    expect((await apply(spec as Partial<ApplySpec>)).errors).toEqual([])
    expect(node()?.class).toBe('inOut')
  })
})
