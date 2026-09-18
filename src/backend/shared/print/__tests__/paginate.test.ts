import type { RungLadderState } from '@root/middleware/shared/ports/types'
import type { Node } from '@xyflow/react'

import { paginate } from '../paginate'
import { resolvePageBox } from '../geometry'
import type { PrintPou, PrintRequest } from '../types'

function makeFbdNode(overrides: Record<string, unknown> = {}): Node {
  return {
    id: 'n1',
    type: 'block',
    position: { x: 0, y: 0 },
    width: 100,
    height: 40,
    data: {},
    ...overrides,
  } as unknown as Node
}

function makeRung(overrides: Partial<RungLadderState> = {}): RungLadderState {
  return {
    id: 'rung-0',
    comment: '',
    defaultBounds: [0, 0],
    reactFlowViewport: [0, 200],
    selectedNodes: [],
    nodes: [],
    edges: [],
    ...overrides,
  }
}

function ldPou(name: string): PrintPou {
  return { name, kind: 'ld', rungs: [makeRung()], variables: [] }
}

function stPou(name: string, lineCount = 3): PrintPou {
  return {
    name,
    kind: 'st',
    lines: Array.from({ length: lineCount }, (_, i) => ({ runs: [{ text: `line ${i}`, color: '#000000' }] })),
    variables: [],
  }
}

function fbdPou(name: string): PrintPou {
  return {
    name,
    kind: 'fbd',
    rung: { comment: '', selectedNodes: [], nodes: [], edges: [] },
    variables: [],
  }
}

function baseRequest(overrides: Partial<PrintRequest> = {}): PrintRequest {
  return {
    projectName: 'Test',
    mode: 'normal',
    pagePolicy: 'may-share-page',
    page: { size: 'a4', orientation: 'portrait', marginsPt: { top: 36, right: 36, bottom: 36, left: 36 } },
    pous: [],
    ...overrides,
  }
}

describe('paginate', () => {
  it('places a single small POU on one page, sized to the page box', () => {
    const request = baseRequest({ pous: [ldPou('Main')] })
    const pages = paginate(request)
    const box = resolvePageBox(request.page)
    expect(pages).toHaveLength(1)
    expect(pages[0].widthPt).toBe(box.widthPt)
    expect(pages[0].heightPt).toBe(box.heightPt)
    expect(pages[0].ops.length).toBeGreaterThan(0)
  })

  it('flushes an empty page when there are no POUs to print', () => {
    const request = baseRequest({ pous: [] })
    const pages = paginate(request)
    expect(pages).toHaveLength(1)
    expect(pages[0].ops).toEqual([])
  })

  it('forces a new page per POU under new-page-per-pou policy', () => {
    const request = baseRequest({ pagePolicy: 'new-page-per-pou', pous: [ldPou('First'), stPou('Second')] })
    const pages = paginate(request)
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })

  it('lets POUs share a page under may-share-page policy when they fit', () => {
    const request = baseRequest({ pagePolicy: 'may-share-page', pous: [ldPou('First'), ldPou('Second')] })
    const pages = paginate(request)
    expect(pages).toHaveLength(1)
  })

  it('flushes mid-POU once accumulated content overflows the content box, even under may-share-page', () => {
    // Huge top/bottom margins on A4 leave a tiny content height, so a POU with
    // several text lines + a header + a variables table can't fit on one page.
    const request = baseRequest({
      pagePolicy: 'may-share-page',
      page: { size: 'a4', orientation: 'portrait', marginsPt: { top: 400, right: 36, bottom: 400, left: 36 } },
      pous: [
        {
          name: 'Overflow',
          kind: 'il',
          lines: Array.from({ length: 30 }, () => ({ runs: [{ text: 'x', color: '#000' }] })),
          variables: [
            {
              name: 'v1',
              varClass: 'local',
              flag: '',
              type: 'BOOL',
              location: '',
              initialValue: '',
              documentation: '',
              debug: false,
            },
          ],
        },
      ],
    })
    const pages = paginate(request)
    expect(pages.length).toBeGreaterThan(1)
  })

  it('renders an FBD POU', () => {
    const request = baseRequest({ pous: [fbdPou('Diagram')] })
    const pages = paginate(request)
    expect(pages).toHaveLength(1)
  })

  it('keeps a scale-to-fit FBD diagram on the same page as its header, even when the diagram is much taller than wide', () => {
    // Regression: `scaleToFitBlock` used to size against the FULL page height,
    // so a diagram this tall would come out just under `contentHeightPt`.
    // Placed right after the header, it then overflowed on its own and the
    // whole diagram jumped to a second page, leaving the header alone above
    // blank space on the first.
    const tallRung = {
      comment: '',
      selectedNodes: [],
      nodes: [
        makeFbdNode({ id: 'top', position: { x: 0, y: 0 } }),
        makeFbdNode({ id: 'bottom', position: { x: 0, y: 3000 } }),
      ],
      edges: [],
    }
    const request = baseRequest({
      mode: 'scale-to-fit',
      pous: [{ name: 'Tall', kind: 'fbd', rung: tallRung, variables: [] }],
    })

    const pages = paginate(request)

    expect(pages).toHaveLength(1)
  })

  it('throws for an unhandled POU kind (defensive exhaustiveness check)', () => {
    const invalidPou = { name: 'Bad', kind: 'invalid', variables: [] } as unknown as PrintPou
    const request = baseRequest({ pous: [invalidPou] })
    expect(() => paginate(request)).toThrow('Unhandled POU kind')
  })
})
