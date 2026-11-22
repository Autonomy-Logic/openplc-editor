/**
 * Stored geometry follows the layout.
 * @jest-environment node
 * @vitest-environment node
 */
import { loadCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  loadedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import { renamedRung } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'

import { applyRungLayout, layoutRung, rungLayoutDiffers } from '../layout'
import { withLaidOutGeometry } from '../relayout'

describe('withLaidOutGeometry', () => {
  const data = loadCorpusProject('ld-corpus-parallel-width')
  const src = corpusLabelSource(data, 'Blocks')

  it('stores the layout on a rung left away from it, and keeps a laid-out list as it is', () => {
    const laidOut = loadedRungs(data, 'Blocks').map((rung) => applyRungLayout(rung, layoutRung(rung, src)))
    const layoutsOf = (rungs: typeof laidOut) => new Map(rungs.map((rung) => [rung, layoutRung(rung, src)] as const))
    expect(withLaidOutGeometry(laidOut, layoutsOf(laidOut))).toBe(laidOut)

    const first = laidOut[0]
    const variable = first.nodes.find((node) => node.type === 'contact')?.data.variable
    const name = typeof variable === 'object' && variable !== null && 'name' in variable ? String(variable.name) : ''
    const stale = [renamedRung(first, { [name]: 'a_much_longer_contact_name' }), ...laidOut.slice(1)]
    const synced = withLaidOutGeometry(stale, layoutsOf(stale))
    expect(synced).not.toBe(stale)
    expect(rungLayoutDiffers(synced[0], layoutRung(synced[0], src))).toBe(false)
    expect(synced.slice(1)).toEqual(laidOut.slice(1))
    expect(synced[0].defaultBounds[0]).toBeGreaterThan(first.defaultBounds[0])
  })
})
