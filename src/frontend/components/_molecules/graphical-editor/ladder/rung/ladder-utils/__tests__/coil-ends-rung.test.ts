import { seriesRung } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'

import { renderPlaceholderElements } from '../elements/placeholder'

describe('a coil ends its rung', () => {
  it('offers drop markers before and below a coil, never after it or before the right rail', () => {
    const rung = seriesRung('rung_coil', [
      { kind: 'contact', id: 'start', name: 'Start' },
      { kind: 'coil', id: 'motor', name: 'Motor' },
    ])
    const markers = renderPlaceholderElements(rung)
      .filter((node) => node.type === 'placeholder' || node.type === 'parallelPlaceholder')
      .map((node) => {
        const data = node.data as { relatedNode?: { id: string }; position?: string }
        return `${data.relatedNode?.id ?? ''}:${data.position ?? ''}`
      })
    const coilId = rung.nodes.find((node) => node.type === 'coil')?.id ?? ''
    const railId = rung.nodes.find((node) => node.id.startsWith('right-rail'))?.id ?? ''
    expect(markers).toEqual(expect.arrayContaining([`${coilId}:left`, `${coilId}:bottom`]))
    expect(markers).not.toContain(`${coilId}:right`)
    expect(markers.some((marker) => marker.startsWith(`${railId}:`))).toBe(false)
  })
})
