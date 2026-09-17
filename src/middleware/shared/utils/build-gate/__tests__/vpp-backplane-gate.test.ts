import { evaluateVppBackplaneGate } from '../vpp-backplane-gate'

const REFUSAL =
  'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one that has it.'

describe('evaluateVppBackplaneGate', () => {
  it('refuses a VPP board on a vPLC that answered no', () => {
    expect(evaluateVppBackplaneGate({ isVppBoard: true, backplaneAccess: false })).toEqual({
      kind: 'refuse',
      reason: REFUSAL,
    })
  })

  it('allows a VPP board on the vPLC that holds the backplane', () => {
    expect(evaluateVppBackplaneGate({ isVppBoard: true, backplaneAccess: true })).toEqual({ kind: 'allow' })
  })

  it('allows a VPP board when nothing answered the question', () => {
    // A host predating the field, and a target that is not a vPLC at all, both
    // land here. Absent means the question was never answered, not answered no.
    expect(evaluateVppBackplaneGate({ isVppBoard: true, backplaneAccess: undefined })).toEqual({ kind: 'allow' })
  })

  it('ignores the flag for a board no vendor package provides', () => {
    expect(evaluateVppBackplaneGate({ isVppBoard: false, backplaneAccess: false })).toEqual({ kind: 'allow' })
    expect(evaluateVppBackplaneGate({ isVppBoard: false, backplaneAccess: true })).toEqual({ kind: 'allow' })
    expect(evaluateVppBackplaneGate({ isVppBoard: false, backplaneAccess: undefined })).toEqual({ kind: 'allow' })
  })
})
