/**
 * The device license badge + popover (T12).
 *
 * `board.tsx` had no test at all, and everything asserted here is text a user
 * reads and acts on:
 *
 *  - the THREE possession labels. `GLOSSARY.md` fixes this vocabulary (Licensed /
 *    Not licensed / License check failed) and forbids the closed gate's execution
 *    modes (FULL / DEMO) in the interface. The subtitle used to say "Full version
 *    unlocked" / "Running in demo mode" — both forbidden, and both asserting an
 *    execution mode the editor cannot know.
 *  - the TWO identifier labels. Device ID and Hardware ID are different values;
 *    showing the anchor under "Device ID" is the bug task #23 had to fix, and
 *    swapping them back kept the whole suite green.
 *  - that the Hardware ID is NOT reproduced in full anywhere (D3). The anchor is
 *    the pre-image of the Device ID and the input to the proof-of-possession KDF,
 *    it never rotates, and a screenshot of a hover tooltip in a support ticket
 *    handed it over permanently.
 */
import { fireEvent, render, screen } from '@testing-library/react'

import type { DeviceProbeInfo } from '../../../../../../../store/slices/device/types'
import { DeviceLicenseStatus } from '../board'

const DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'
const ANCHOR_HEX = '38363235383037623061383361653764'

function probe(result: Partial<NonNullable<DeviceProbeInfo['result']>>): DeviceProbeInfo {
  return { phase: 'done', result: { status: 'connected-with-firmware', ...result } }
}

function renderBadge(info: DeviceProbeInfo, boardIsLicensable = true) {
  return render(
    <DeviceLicenseStatus
      probeInfo={info}
      boardIsLicensable={boardIsLicensable}
      onBuy={() => undefined}
      onRecheck={() => undefined}
    />,
  )
}

describe('DeviceLicenseStatus — the possession badge', () => {
  it('renders nothing before a probe lands', () => {
    const { container } = renderBadge({ phase: 'idle', result: null })
    expect(container.innerHTML).toBe('')
  })

  it('says only "Connected" for a free VPP, where licensing does not apply', () => {
    renderBadge(probe({ licenseStatus: 'unlicensed' }), false)
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('says "License unknown" when the firmware has no license storage', () => {
    renderBadge(probe({ licenseStatus: 'unsupported', activation: 'unsupported' }))
    expect(screen.getByText('License unknown')).toBeTruthy()
  })

  // The three states are deliberately not two: "Not licensed" is an ANSWER,
  // "License check failed" is the absence of one. Collapsing them tells a paying
  // customer to buy again.
  it.each([
    ['licensed', { licenseStatus: 'licensed' as const, activation: 'already-licensed' as const }, 'Licensed'],
    ['unlicensed', { licenseStatus: 'unlicensed' as const, activation: 'demo' as const }, 'Not licensed'],
    [
      'a failed check',
      { licenseStatus: 'unlicensed' as const, activation: 'error' as const, error: 'boom' },
      'License check failed',
    ],
  ])('labels %s as "%s"', (_label, result, expected) => {
    renderBadge(probe(result))
    expect(screen.getByRole('button', { name: 'License status' }).textContent).toBe(expected)
  })
})

describe('DeviceLicenseStatus — the detail popover', () => {
  /** Radix renders the content only once the trigger is activated. */
  function openPopover(info: DeviceProbeInfo) {
    renderBadge(info)
    fireEvent.click(screen.getByRole('button', { name: 'License status' }))
  }

  // POSSESSION, never an execution mode (GLOSSARY.md). And the editor may only
  // claim what it verified: the blob is present, intact, and bound to this device
  // and this VPP — never that the closed gate will run the full version.
  it.each([
    [
      'licensed',
      { licenseStatus: 'licensed' as const, activation: 'already-licensed' as const },
      'A license issued for this device is stored on the board',
    ],
    [
      'unlicensed',
      { licenseStatus: 'unlicensed' as const, activation: 'demo' as const },
      'No license for this device is stored on the board',
    ],
  ])('describes %s in terms of what is stored on the board', (_label, result, expected) => {
    openPopover(probe(result))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it.each(['Full version unlocked', 'Running in demo mode'])(
    'never renders the forbidden execution-mode wording %s',
    (forbidden) => {
      openPopover(probe({ licenseStatus: 'licensed', activation: 'already-licensed' }))
      expect(screen.queryByText(forbidden)).toBeNull()
    },
  )

  it('shows the failure reason instead of a possession claim on a failed check', () => {
    openPopover(probe({ licenseStatus: 'unlicensed', activation: 'error', error: '503 Service Unavailable' }))
    expect(screen.getByText('503 Service Unavailable')).toBeTruthy()
  })

  // Two DIFFERENT values, and the labels must not be swapped (#23).
  it('labels the licensing identity "Device ID" and the raw serial "Hardware ID"', () => {
    openPopover(probe({ licenseStatus: 'unlicensed', activation: 'demo', deviceId: DEVICE_ID, anchorHex: ANCHOR_HEX }))
    expect(screen.getByText('Device ID')).toBeTruthy()
    expect(screen.getByText('Hardware ID')).toBeTruthy()
  })

  // The Device ID is a NAME: it is meant to be quoted in a ticket, so it is
  // copyable in full on purpose (#23/ADR-0002).
  it('offers to copy the Device ID in full', () => {
    openPopover(probe({ licenseStatus: 'unlicensed', activation: 'demo', deviceId: DEVICE_ID, anchorHex: ANCHOR_HEX }))
    expect(screen.getByRole('button', { name: 'Copy device ID' })).toBeTruthy()
    // Truncated for display, full value available on hover — the copy path.
    expect(screen.getByTitle(DEVICE_ID)).toBeTruthy()
  })

  // D3. The anchor is the one secret here. No copy button, and no `title`
  // carrying the whole value — a tooltip screenshot is a permanent giveaway.
  it('never reproduces the Hardware ID in full, and offers no way to copy it', () => {
    openPopover(probe({ licenseStatus: 'unlicensed', activation: 'demo', deviceId: DEVICE_ID, anchorHex: ANCHOR_HEX }))
    expect(screen.queryByTitle(ANCHOR_HEX)).toBeNull()
    expect(screen.queryByRole('button', { name: /Copy.*[Hh]ardware/ })).toBeNull()
    expect(document.body.textContent).not.toContain(ANCHOR_HEX)
    // The truncated form IS shown — it is what identifies a board on a bench.
    expect(screen.getByText('38363235…3764')).toBeTruthy()
  })
})
