import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFBody, RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

let edgeId = 0
const e = (source: string, target: string): RFEdge => ({ id: `e${edgeId++}`, source, target })
const rail = (id: string, variant: 'left' | 'right', x: number): RFNode => ({
  id,
  type: 'powerRail',
  position: { x, y: 30 },
  data: { variant },
})
const contact = (id: string, name: string, variant: string, x: number, nid?: string): RFNode => ({
  id,
  type: 'contact',
  position: { x, y: 38 },
  data: { variant, variable: { name }, ...(nid === undefined ? {} : { numericId: nid }) },
})
const coil = (id: string, name: string, x: number, nid: string): RFNode => ({
  id,
  type: 'coil',
  position: { x, y: 38 },
  data: { variant: 'default', variable: { name }, executionOrder: 0, numericId: nid },
})

const rung = (edge: RFNode, target: string, nid: string): RFBody['rungs'][number] => ({
  reactFlowViewport: [600, 120],
  nodes: [rail(`L${nid}`, 'left', 0), edge, coil(`K${nid}`, target, 300, nid), rail(`R${nid}`, 'right', 500)],
  edges: [e(`L${nid}`, edge.id), e(edge.id, `K${nid}`), e(`K${nid}`, `R${nid}`)],
})

describe('edge trigger instance naming', () => {
  it('names each trigger from its contact numericId', () => {
    const body: RFBody = {
      rungs: [
        rung(contact('C1', 'led', 'risingEdge', 68, '2645420'), 'on_pulse', '11'),
        rung(contact('C2', 'led', 'fallingEdge', 68, '2645421'), 'off_pulse', '12'),
      ],
    }
    const { bodySt, syntheticVars, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toContain('_TMP_R_TRIG2645420(CLK := led);')
    expect(bodySt).toContain('on_pulse := _TMP_R_TRIG2645420.Q;')
    expect(bodySt).toContain('_TMP_F_TRIG2645421(CLK := led);')
    expect(bodySt).toContain('off_pulse := _TMP_F_TRIG2645421.Q;')
    expect(syntheticVars).toEqual(
      expect.arrayContaining([
        { name: '_TMP_R_TRIG2645420', type: 'R_TRIG' },
        { name: '_TMP_F_TRIG2645421', type: 'F_TRIG' },
      ]),
    )
  })

  it('falls back to the counter name when the contact has no integer numericId', () => {
    const body: RFBody = { rungs: [rung(contact('C1', 'led', 'risingEdge', 68), 'on_pulse', '11')] }
    const { bodySt, syntheticVars } = emitLdBody(body)
    expect(bodySt).toContain('R_TRIG1(CLK := led);')
    expect(syntheticVars).toEqual(expect.arrayContaining([{ name: 'R_TRIG1', type: 'R_TRIG' }]))
  })

  it('names the first path of a contact that feeds several paths from the node, the rest by counter', () => {
    const c = contact('C1', 'sw', 'risingEdge', 68, '5905628')
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [600, 200],
          nodes: [
            rail('L', 'left', 0),
            c,
            { id: 'PO', type: 'parallel', position: { x: 150, y: 49 }, data: { type: 'open' } },
            coil('K1', 'a', 300, '11'),
            coil('K2', 'b', 300, '12'),
            { id: 'PC', type: 'parallel', position: { x: 400, y: 49 }, data: { type: 'close' } },
            rail('R', 'right', 500),
          ],
          edges: [
            e('L', 'C1'),
            e('C1', 'PO'),
            e('PO', 'K1'),
            e('PO', 'K2'),
            e('K1', 'PC'),
            e('K2', 'PC'),
            e('PC', 'R'),
          ],
        },
      ],
    }
    const { bodySt } = emitLdBody(body)
    // Every copy is clocked by the same input in the same scan, so the named one reports the contact's pulse.
    expect(bodySt).toContain('_TMP_R_TRIG5905628(CLK := sw);')
    expect(bodySt.match(/\(CLK := sw\);/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(bodySt).not.toMatch(/_TMP_R_TRIG5905628\(CLK[^\n]*\n[\s\S]*_TMP_R_TRIG5905628\(CLK/)
  })

  it('falls back to the counter name when two nodes share a numericId', () => {
    const body: RFBody = {
      rungs: [
        rung(contact('C1', 'a', 'risingEdge', 68, '7'), 'x', '11'),
        rung(contact('C2', 'b', 'risingEdge', 68, '7'), 'y', '12'),
      ],
    }
    const { syntheticVars } = emitLdBody(body)
    const names = syntheticVars.filter((v) => v.type === 'R_TRIG').map((v) => v.name)
    expect(names).toEqual(['_TMP_R_TRIG7', 'R_TRIG1'])
  })
})
