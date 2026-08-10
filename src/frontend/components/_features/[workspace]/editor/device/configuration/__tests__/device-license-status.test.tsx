import type { DeviceLicenseReport } from '@root/middleware/shared/ports/device-port'
import { fireEvent, render, screen } from '@testing-library/react'

import { DeviceLicenseStatus } from '../components/device-license-status'

const DEVICE_ID = '659a3520540f803625ddc34081e893d3'
const BUY_URL = `https://edge.example.com/buy?vppId=com.openplc.espressif-licensed&deviceId=${DEVICE_ID}`

function setup(report: DeviceLicenseReport | null, overrides: { isChecking?: boolean; buyUrl?: string | null } = {}) {
  const onBuy = jest.fn()
  const onRecheck = jest.fn()
  render(
    <DeviceLicenseStatus
      report={report}
      isChecking={overrides.isChecking ?? false}
      // `??` would be wrong here: an explicit `buyUrl: null` is a case under test.
      buyUrl={'buyUrl' in overrides ? (overrides.buyUrl ?? null) : BUY_URL}
      onBuy={onBuy}
      onRecheck={onRecheck}
    />,
  )
  return { onBuy, onRecheck }
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: 'Licence status' }))
}

describe('DeviceLicenseStatus', () => {
  it('renders nothing before any licensing call has landed', () => {
    // The state every non-licensable board stays in, and a licensable one before
    // Connect. A placeholder badge would invite the user to read meaning into a
    // check that never happened.
    const { container } = render(
      <DeviceLicenseStatus report={null} isChecking={false} buyUrl={null} onBuy={jest.fn()} onRecheck={jest.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows progress while a check is in flight with nothing known yet', () => {
    setup(null, { isChecking: true })
    expect(screen.getByText('Checking licence…')).toBeTruthy()
  })

  it('labels a stored, verified licence as Licensed', () => {
    setup({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } })
    expect(screen.getByText('Licensed')).toBeTruthy()
  })

  it('labels a definitive negative as Not licensed', () => {
    setup({ deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: true } })
    expect(screen.getByText('Not licensed')).toBeTruthy()
  })

  it('labels an unanswered check as a FAILURE, not as Not licensed', () => {
    // Three states, deliberately not two: collapsing these either tells a paying
    // customer to buy again or hides a real failure behind a reassuring badge.
    setup({ outcome: { state: 'check-failed', error: 'Request timeout' } })
    expect(screen.getByText('Licence check failed')).toBeTruthy()
    expect(screen.queryByText('Not licensed')).toBeNull()
  })

  it('labels missing storage as a FIRMWARE fault, distinctly from having no licence', () => {
    // "Not storable" read as a hardware limitation and sent us looking at a
    // NodeMCU that stores licences fine — the image was built without the backend.
    setup({ deviceId: DEVICE_ID, outcome: { state: 'unsupported' } })
    expect(screen.getByText('Storage missing')).toBeTruthy()
    expect(screen.queryByText('Not licensed')).toBeNull()
  })

  it('never claims to know the execution mode the board is running in', () => {
    // The editor verifies POSSESSION, not the ECDSA signature — it cannot know
    // whether the closed licence-core will run FULL. No label may say otherwise.
    const outcomes: DeviceLicenseReport['outcome'][] = [
      { state: 'licensed', how: 'already-stored' },
      { state: 'licensed', how: 'activated' },
      { state: 'unlicensed', entitlementChecked: true },
      { state: 'unsupported' },
      { state: 'check-failed', error: 'x' },
    ]

    for (const outcome of outcomes) {
      const { container, unmount } = render(
        <DeviceLicenseStatus
          report={{ deviceId: DEVICE_ID, outcome }}
          isChecking={false}
          buyUrl={BUY_URL}
          onBuy={jest.fn()}
          onRecheck={jest.fn()}
        />,
      )
      expect(container.textContent ?? '').not.toMatch(/full mode|unlocked|demo mode/i)
      unmount()
    }
  })

  it('keeps the details OUT of the layout flow, so opening them cannot move the page', () => {
    // The regression this exists for: the panel used to be a conditional <div>
    // next to the trigger, so opening it grew the connect row by ~140px and
    // pushed "Specs" and the board image down. A portalled popover renders under
    // document.body, so the row's own subtree never changes.
    const { container } = render(
      <DeviceLicenseStatus
        report={{ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } }}
        isChecking={false}
        buyUrl={BUY_URL}
        onBuy={jest.fn()}
        onRecheck={jest.fn()}
      />,
    )

    const before = container.innerHTML
    expand()

    // The panel is visible…
    expect(screen.getByText('Device ID')).toBeTruthy()
    // …and it is NOT inside the component's own container.
    expect(container.querySelector('code')).toBeNull()
    // The trigger's subtree is byte-identical apart from the attributes Radix
    // toggles on it (aria-expanded / data-state).
    expect(before.replace(/(aria-expanded|data-state)="[^"]*"/g, '')).toBe(
      container.innerHTML.replace(/(aria-expanded|data-state)="[^"]*"/g, ''),
    )
  })

  describe('details panel', () => {
    it('exposes the device id and copies it on request', () => {
      const writeText = jest.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

      setup({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } })
      expand()

      // The id is what a support ticket needs and what the /buy page accepts pasted.
      expect(screen.getByText(DEVICE_ID)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenCalledWith(DEVICE_ID)
    })

    it('omits the device id when there was no anchor to derive one from', () => {
      setup({ outcome: { state: 'check-failed', error: 'no unique hardware id' } })
      expand()
      expect(screen.queryByText('Device ID')).toBeNull()
    })

    it('always offers a re-check', () => {
      const { onRecheck } = setup({ deviceId: DEVICE_ID, outcome: { state: 'check-failed', error: 'x' } })
      expand()
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
      expect(onRecheck).toHaveBeenCalledTimes(1)
    })

    it('disables the re-check while one is already running', () => {
      setup({ deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: true } }, { isChecking: true })
      expand()
      expect(screen.getByRole('button', { name: 'Check again' }).hasAttribute('disabled')).toBe(true)
    })

    it('offers a purchase ONLY when the backend confirmed there is no entitlement', () => {
      const { onBuy } = setup({ deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: true } })
      expand()
      fireEvent.click(screen.getByRole('button', { name: 'Buy licence' }))
      expect(onBuy).toHaveBeenCalledTimes(1)
    })

    it('does NOT offer a purchase when nobody asked whether one exists', () => {
      // Offering to buy here is a guess, and the wrong one for anyone who paid.
      setup({ deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: false } })
      expand()
      expect(screen.queryByRole('button', { name: 'Buy licence' })).toBeNull()
    })

    it('does NOT offer a purchase when the check failed', () => {
      setup({ outcome: { state: 'check-failed', error: 'Activation request failed: 429' } })
      expand()
      expect(screen.queryByRole('button', { name: 'Buy licence' })).toBeNull()
    })

    it('does NOT offer a purchase when the device cannot store a licence', () => {
      // Buying would not make the device able to store one.
      setup({ deviceId: DEVICE_ID, outcome: { state: 'unsupported' } })
      expand()
      expect(screen.queryByRole('button', { name: 'Buy licence' })).toBeNull()
    })

    it('hides the purchase button when no valid link could be built', () => {
      setup({ deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: true } }, { buyUrl: null })
      expand()
      expect(screen.queryByRole('button', { name: 'Buy licence' })).toBeNull()
    })

    it('tells an unsupported device to rebuild, and does not blame the hardware', () => {
      setup({ deviceId: DEVICE_ID, outcome: { state: 'unsupported' } })
      expand()
      expect(screen.getByText(/rebuild and upload/i)).toBeTruthy()
      expect(screen.getByText(/This hardware supports it/)).toBeTruthy()
    })

    it("quotes the backend's reason when it gave one", () => {
      setup({
        deviceId: DEVICE_ID,
        outcome: { state: 'unlicensed', entitlementChecked: true, backendReason: 'no active subscription' },
      })
      expand()
      expect(screen.getByText(/no active subscription/)).toBeTruthy()
    })

    it('states that a failed check is not the same as having no licence', () => {
      setup({ outcome: { state: 'check-failed', error: 'Request timeout' } })
      expand()
      expect(screen.getByText(/not the same as having no licence/)).toBeTruthy()
    })
  })
})
