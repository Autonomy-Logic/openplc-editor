import { evaluateVppBackplaneGate, vppGateStateFor } from '../vpp-backplane-gate'

const NO_BACKPLANE =
  'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one that has it.'
const PACKAGE_ID = 'com.synergy-logic.slm-rp4'

/** A vPLC that holds the backplane and runs `packageId`, unless told otherwise. */
function vplc(overrides: Partial<Parameters<typeof vppGateStateFor>[0]['target'] & object> = {}) {
  return {
    backplaneAccess: true,
    vpp: { packageId: PACKAGE_ID, version: '1.0.0', contentHash: 'sha256:x' },
    ...overrides,
  }
}

describe('evaluateVppBackplaneGate', () => {
  // The desktop's own case, first because it is the one this repo ships: it
  // never selects a vPLC and installs packages locally, so every vendor board
  // stays available and no board is ever "missing because of the target".
  it('gates nothing on the desktop, where no vPLC is ever the target', () => {
    for (const board of [{ vpp: { packageId: PACKAGE_ID } }, {}, undefined]) {
      expect(
        evaluateVppBackplaneGate(
          vppGateStateFor({ vplcProvidesVendorBoards: false, board, boardName: 'SLM-RP4', target: null }),
        ),
      ).toEqual({ kind: 'allow' })
    }
  })

  it('allows a vendor board on the vPLC that runs its package', () => {
    expect(
      evaluateVppBackplaneGate(
        vppGateStateFor({ vplcProvidesVendorBoards: true, board: { vpp: { packageId: PACKAGE_ID } }, target: vplc() }),
      ),
    ).toEqual({ kind: 'allow' })
  })

  it('refuses a vendor board on a vPLC that answered no to the backplane', () => {
    expect(
      evaluateVppBackplaneGate(
        vppGateStateFor({
          vplcProvidesVendorBoards: true,
          board: { vpp: { packageId: PACKAGE_ID } },
          target: vplc({ backplaneAccess: false }),
        }),
      ),
    ).toEqual({ kind: 'refuse', reason: NO_BACKPLANE })
  })

  // The board is meaningless without a vPLC to run it on, and refusing here is
  // what keeps the picker from offering vendor boards to nothing.
  it('refuses a vendor board when no vPLC is the target', () => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({ vplcProvidesVendorBoards: true, board: { vpp: { packageId: PACKAGE_ID } }, target: null }),
    )
    expect(verdict.kind).toBe('refuse')
    expect(verdict).toMatchObject({ reason: expect.stringContaining('Select a vPLC') })
  })

  it('refuses a vendor board from another package, naming the one the vPLC runs', () => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: 'com.other.board' } },
        target: vplc(),
      }),
    )
    expect(verdict.kind).toBe('refuse')
    expect(verdict).toMatchObject({ reason: expect.stringContaining(PACKAGE_ID) })
    expect(verdict).toMatchObject({ reason: expect.stringContaining('com.other.board') })
  })

  it('refuses a vendor board on a vPLC created without a package', () => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: PACKAGE_ID } },
        target: { backplaneAccess: true, vpp: null },
      }),
    )
    expect(verdict.kind).toBe('refuse')
    expect(verdict).toMatchObject({ reason: expect.stringContaining('without a vendor package') })
  })

  // A host predating the field says nothing about the binding, and silence must
  // not read as "no package".
  it('allows a vendor board when the host answered neither question', () => {
    expect(
      evaluateVppBackplaneGate(
        vppGateStateFor({ vplcProvidesVendorBoards: true, board: { vpp: { packageId: PACKAGE_ID } }, target: {} }),
      ),
    ).toEqual({ kind: 'allow' })
  })

  it('refuses a board the project names that this vPLC does not have', () => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({ vplcProvidesVendorBoards: true, board: undefined, boardName: 'SLM-RP4', target: vplc() }),
    )
    expect(verdict.kind).toBe('refuse')
    expect(verdict).toMatchObject({ reason: expect.stringContaining('SLM-RP4') })
  })

  // The desktop resolves an unknown board its own way and has its own message.
  // The desktop installs packages locally and connects to a board directly, so
  // "no vPLC" is its normal state and gating on it would refuse every build.
  it('gates nothing where a vPLC is not what provides vendor boards', () => {
    for (const board of [{ vpp: { packageId: PACKAGE_ID } }, undefined]) {
      expect(
        evaluateVppBackplaneGate(
          vppGateStateFor({ vplcProvidesVendorBoards: false, board, boardName: 'SLM-RP4', target: null }),
        ),
      ).toEqual({ kind: 'allow' })
    }
  })

  it('ignores every vPLC fact for a board no vendor package provides', () => {
    for (const target of [null, {}, vplc(), vplc({ backplaneAccess: false })]) {
      expect(
        evaluateVppBackplaneGate(
          vppGateStateFor({ vplcProvidesVendorBoards: true, board: {}, boardName: 'Uno', target }),
        ),
      ).toEqual({
        kind: 'allow',
      })
    }
  })
})
