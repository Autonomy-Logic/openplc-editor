import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFBody, RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

// Regression coverage for issue #836 — a contact feeding multiple coils
// must be evaluated once per energization path, not re-read between coil
// assignments. SET/RESET coils that branch off the same source collapse
// into one IF even when a merge-fed coil sorts between them; sequential
// coils (distinct sources) stay as separate IFs.

let edgeId = 0
const e = (source: string, target: string): RFEdge => ({ id: `e${edgeId++}`, source, target })
const rail = (id: string, variant: 'left' | 'right', x: number): RFNode => ({
  id,
  type: 'powerRail',
  position: { x, y: 30 },
  data: { variant },
})
const contact = (id: string, name: string, x: number, nid: string): RFNode => ({
  id,
  type: 'contact',
  position: { x, y: 38 },
  data: { variant: 'default', variable: { name }, numericId: nid },
})
const coil = (id: string, name: string, variant: 'set' | 'reset', x: number, y: number, nid: string): RFNode => ({
  id,
  type: 'coil',
  position: { x, y },
  data: { variant, variable: { name }, executionOrder: 0, numericId: nid },
})
const par = (id: string, side: 'open' | 'close', x: number): RFNode => ({
  id,
  type: 'parallel',
  position: { x, y: 49 },
  data: { type: side },
})

// One emitted `IF <cond> THEN <assign...> END_IF;` block, base indent 2.
const block = (cond: string, ...assigns: string[]): string =>
  `  IF ${cond} THEN\n${assigns.map((a) => `    ${a}\n`).join('')}  END_IF;\n`

describe('issue 836 — contact evaluated once across multiple coils', () => {
  it('groups parallel outputs even when the reset coil sorts between them', () => {
    // FirstScan -> [Output1(S) || Output2(S)] -> FirstScan(R)
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [700, 300],
          nodes: [
            rail('L', 'left', 0),
            contact('C', 'FirstScan', 68, '10'),
            par('PO', 'open', 251),
            coil('K1', 'Output1', 'set', 300, 38, '20'),
            coil('K2', 'Output2', 'set', 300, 130, '21'),
            par('PC', 'close', 373),
            coil('KR', 'FirstScan', 'reset', 500, 38, '22'),
            rail('R', 'right', 600),
          ],
          edges: [
            e('L', 'C'),
            e('C', 'PO'),
            e('PO', 'K1'),
            e('PO', 'K2'),
            e('K1', 'PC'),
            e('K2', 'PC'),
            e('PC', 'KR'),
            e('KR', 'R'),
          ],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        block('FirstScan', 'Output1 := TRUE; (*set*)', 'Output2 := TRUE; (*set*)') +
        block('FirstScan', 'FirstScan := FALSE; (*reset*)'),
    )
  })

  it('groups three coils sharing one source into a single IF', () => {
    // FirstScan -> [Output1(S) || FirstScan(R) || Output2(S)]
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [600, 300],
          nodes: [
            rail('L', 'left', 0),
            contact('C', 'FirstScan', 68, '10'),
            par('PO', 'open', 251),
            coil('K1', 'Output1', 'set', 300, 38, '20'),
            coil('KR', 'FirstScan', 'reset', 300, 130, '22'),
            coil('K2', 'Output2', 'set', 300, 220, '21'),
            par('PC', 'close', 400),
            rail('R', 'right', 500),
          ],
          edges: [
            e('L', 'C'),
            e('C', 'PO'),
            e('PO', 'K1'),
            e('PO', 'KR'),
            e('PO', 'K2'),
            e('K1', 'PC'),
            e('KR', 'PC'),
            e('K2', 'PC'),
            e('PC', 'R'),
          ],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        block('FirstScan', 'Output1 := TRUE; (*set*)', 'FirstScan := FALSE; (*reset*)', 'Output2 := TRUE; (*set*)'),
    )
  })

  it('keeps sequential coils (distinct sources) as separate IFs', () => {
    // FirstScan -> Output1(S) -> FirstScan(R) -> Output2(S)
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [700, 100],
          nodes: [
            rail('L', 'left', 0),
            contact('C', 'FirstScan', 68, '10'),
            coil('K1', 'Output1', 'set', 200, 38, '20'),
            coil('KR', 'FirstScan', 'reset', 350, 38, '22'),
            coil('K2', 'Output2', 'set', 500, 38, '21'),
            rail('R', 'right', 650),
          ],
          edges: [e('L', 'C'), e('C', 'K1'), e('K1', 'KR'), e('KR', 'K2'), e('K2', 'R')],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        block('FirstScan', 'Output1 := TRUE; (*set*)') +
        block('FirstScan', 'FirstScan := FALSE; (*reset*)') +
        block('FirstScan', 'Output2 := TRUE; (*set*)'),
    )
  })
})
