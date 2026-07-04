import type { RungLadderState } from '@root/frontend/store/slices'

import { ladderToXml } from '../ladder-xml'
import ctudRung from './fixtures/ctud-parallel-output-rung.json'

/**
 * Regression for the CTUD QU/QD output-coil bug.
 *
 * The fixture is the real CTUD_DINT rung from the "PWM Control Example"
 * production project: coils wired to BOTH the QU and QD outputs, each through a
 * parallel chain. The old-editor serializer (the one the compile pipeline runs
 * via XmlGenerator(..., 'old-editor')) used to map every parallel-chain coil's
 * connectionPointIn to the block's PRIMARY output (QU), so QD coils came out as
 * QU — and at runtime every coil followed QU. The fix resolves the formal
 * parameter from the edge that actually leaves the block into the parallel
 * chain (QU vs QD).
 */
describe('old-editor ladderToXml — CTUD parallel output coils', () => {
  it('maps each output coil to the block pin it is actually wired to (QU vs QD), not all to QU', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xml: any = ladderToXml([ctudRung as unknown as RungLadderState])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formalParams = xml.body.LD.coil
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((c: any) => (c.connectionPointIn?.connection || []).map((x: any) => x['@formalParameter']))
      // keep only the CTUD outputs (ignore the unrelated oscillator coil's 'Q')
      .filter((fp: string) => fp === 'QU' || fp === 'QD')

    // Two coils on QU, two on QD — NOT four on QU.
    expect(formalParams.filter((p: string) => p === 'QU')).toHaveLength(2)
    expect(formalParams.filter((p: string) => p === 'QD')).toHaveLength(2)
  })
})
