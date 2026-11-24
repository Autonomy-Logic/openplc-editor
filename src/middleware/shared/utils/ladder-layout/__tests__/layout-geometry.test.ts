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
import {
  renamedRung,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import { renderLadderPou } from '@root/backend/shared/print/ladder-painter'

import { EMPTY_LABEL_SOURCE } from '../labels'
import { applyRungLayout, layoutRung, layoutRungOrStored, rungLayoutDiffers } from '../layout'
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

  it('draws and prints a rung the engine cannot read where it is stored', () => {
    const rung = seriesRung('rung_broken', [
      { kind: 'contact', id: 'a', name: 'A' },
      { kind: 'coil', id: 'q', name: 'Q' },
    ])
    const broken = {
      ...rung,
      nodes: rung.nodes.map((node) =>
        node.type === 'contact' ? { ...node, data: { ...node.data, handles: undefined } } : node,
      ),
    }
    expect(() => layoutRung(broken, EMPTY_LABEL_SOURCE)).toThrow()
    const contact = broken.nodes.find((node) => node.type === 'contact')
    const layout = layoutRungOrStored(broken, EMPTY_LABEL_SOURCE)
    expect(layout.nodes.get(contact?.id ?? '')?.position).toEqual(contact?.position)
    const pou = { name: 'P', kind: 'ld' as const, rungs: [broken], variables: [], labels: EMPTY_LABEL_SOURCE }
    expect(renderLadderPou(pou, 'normal', 523, 770)).toHaveLength(2)
  })
})
