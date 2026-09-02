import type { DeviceLicenseReport } from '@root/middleware/shared/ports/device-port'

import { explainLicenseOutcome, type OpenLicenseDialog } from '../license-outcome-dialog'

type DialogProps = Parameters<OpenLicenseDialog>[1]

function harness() {
  const opened: DialogProps[] = []
  const openModal: OpenLicenseDialog = (_name, props) => {
    opened.push(props)
  }
  const buy = jest.fn(() => Promise.resolve())
  const retry = jest.fn(() => Promise.resolve())
  return { opened, openModal, buy, retry }
}

function report(outcome: DeviceLicenseReport['outcome']): DeviceLicenseReport {
  return { deviceId: '659a3520540f803625ddc34081e893d3', outcome }
}

describe('explainLicenseOutcome', () => {
  it('says NOTHING when the device is licensed', () => {
    // A dialog confirming a licence nobody asked about would fire on every single
    // connect to a licensed board.
    const { opened, openModal, buy, retry } = harness()

    const shown = explainLicenseOutcome(report({ state: 'licensed', how: 'already-stored' }), {
      openModal,
      buy,
      retry,
    })

    expect(shown).toBe(false)
    expect(opened).toHaveLength(0)
  })

  it('is silent for a freshly activated licence too', () => {
    const { opened, openModal, buy } = harness()

    explainLicenseOutcome(report({ state: 'licensed', how: 'activated' }), { openModal, buy })

    expect(opened).toHaveLength(0)
  })

  describe('unlicensed with the entitlement CHECKED', () => {
    it('offers to buy, and buying is what the first button does', () => {
      const { opened, openModal, buy, retry } = harness()

      explainLicenseOutcome(report({ state: 'unlicensed', entitlementChecked: true }), { openModal, buy, retry })

      expect(opened).toHaveLength(1)
      expect(opened[0].buttons).toEqual(['Buy Licence', 'Continue in Demo Mode'])
      opened[0].onResponse(0)
      expect(buy).toHaveBeenCalledTimes(1)
      expect(retry).not.toHaveBeenCalled()
    })

    it('does nothing when the user chooses demo mode', () => {
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(report({ state: 'unlicensed', entitlementChecked: true }), { openModal, buy })
      opened[0].onResponse(1)

      expect(buy).not.toHaveBeenCalled()
    })

    it("quotes the backend's own wording when it gave one", () => {
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(
        report({ state: 'unlicensed', entitlementChecked: true, backendReason: 'no active subscription' }),
        { openModal, buy },
      )

      expect(opened[0].message).toContain('no active subscription')
    })
  })

  describe('unlicensed with the entitlement NOT checked', () => {
    it('offers a re-check and NOT a purchase', () => {
      // Nobody asked whether a purchase exists. Offering to buy here is the worst
      // thing this flow can do to someone who already paid.
      const { opened, openModal, buy, retry } = harness()

      explainLicenseOutcome(report({ state: 'unlicensed', entitlementChecked: false }), { openModal, buy, retry })

      expect(opened[0].buttons).toEqual(['Check for Licence', 'Continue in Demo Mode'])
      expect(opened[0].buttons).not.toContain('Buy Licence')
      opened[0].onResponse(0)
      expect(retry).toHaveBeenCalledTimes(1)
      expect(buy).not.toHaveBeenCalled()
    })

    it('degrades to a plain acknowledgement when no retry is available', () => {
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(report({ state: 'unlicensed', entitlementChecked: false }), { openModal, buy })

      expect(opened[0].buttons).toEqual(['OK'])
      // Pressing the only button must not silently trigger anything.
      opened[0].onResponse(0)
      expect(buy).not.toHaveBeenCalled()
    })
  })

  describe('unsupported', () => {
    it('never offers a purchase — buying would not make the device able to store one', () => {
      const { opened, openModal, buy, retry } = harness()

      explainLicenseOutcome(report({ state: 'unsupported' }), { openModal, buy, retry })

      expect(opened[0].buttons).toEqual(['OK'])
      opened[0].onResponse(0)
      expect(buy).not.toHaveBeenCalled()
      expect(retry).not.toHaveBeenCalled()
    })

    it('names the firmware and tells the user to rebuild, without blaming the hardware', () => {
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(report({ state: 'unsupported' }), { openModal, buy })

      expect(opened[0].message).toMatch(/rebuild and\s+upload/i)
      expect(opened[0].message).toContain('This hardware supports it')
      // The old wording ("This Device Cannot Store A Licence") read as a hardware
      // limitation and cost a debugging session.
      expect(opened[0].title).not.toMatch(/cannot store/i)
    })
  })

  describe('check-failed', () => {
    it('says we could not tell, states it is NOT the same as unlicensed, and offers a retry', () => {
      const { opened, openModal, buy, retry } = harness()

      explainLicenseOutcome(report({ state: 'check-failed', error: 'Activation request failed: 429' }), {
        openModal,
        buy,
        retry,
      })

      expect(opened[0].type).toBe('error')
      expect(opened[0].message).toContain('Activation request failed: 429')
      expect(opened[0].message).toContain('NOT the same as having no licence')
      expect(opened[0].buttons).toEqual(['Try Again', 'Continue'])
      opened[0].onResponse(0)
      expect(retry).toHaveBeenCalledTimes(1)
      // Never a purchase: we do not know that a purchase is what is missing.
      expect(buy).not.toHaveBeenCalled()
    })

    it('withholds the retry when the flow marked the failure terminal', () => {
      // A cause that cannot change by asking again: offering "Try Again" reads
      // as a flaky link and keeps the user pressing it instead of doing the
      // thing the message names (which is usually a rebuild).
      const { opened, openModal, buy } = harness()
      const retry = jest.fn(() => Promise.resolve())

      explainLicenseOutcome(report({ state: 'check-failed', error: 'firmware is out of date', retryable: false }), {
        openModal,
        buy,
        retry,
      })

      expect(opened[0].buttons).toEqual(['OK'])
      opened[0].onResponse(0)
      expect(retry).not.toHaveBeenCalled()
      // The explanation still gets through — only the action is withheld.
      expect(opened[0].message).toContain('firmware is out of date')
    })

    it('keeps the retry when retryable is absent (the common case)', () => {
      // Absent means retryable: a dropped link, a timeout and a backend blip
      // must not lose the retry they have always had.
      const { opened, openModal, buy } = harness()
      const retry = jest.fn(() => Promise.resolve())

      explainLicenseOutcome(report({ state: 'check-failed', error: 'Request timeout' }), { openModal, buy, retry })

      expect(opened[0].buttons).toEqual(['Try Again', 'Continue'])
      opened[0].onResponse(0)
      expect(retry).toHaveBeenCalledTimes(1)
    })

    it('stays quiet on the automatic flow for a RETRYABLE failure', () => {
      // The loud case this exists for: a runtime predating the licence FCs would
      // otherwise open "Licence Check Failed" on every single connect.
      const { opened, openModal, buy } = harness()

      const shown = explainLicenseOutcome(report({ state: 'check-failed', error: 'No response from runtime' }), {
        openModal,
        buy,
        retry: jest.fn(() => Promise.resolve()),
        quietCheckFailed: true,
      })

      expect(shown).toBe(false)
      expect(opened).toHaveLength(0)
    })

    it('speaks up on the automatic flow when the failure is TERMINAL', () => {
      // A terminal failure has no recheck button in the badge panel any more —
      // that is deliberate. Silencing the modal too would leave the automatic
      // flow with no surface at all: no dialog, no action, and a popover the
      // user has no reason to open.
      const { opened, openModal, buy } = harness()

      const shown = explainLicenseOutcome(
        report({ state: 'check-failed', error: 'this hardware cannot hold a licence', retryable: false }),
        { openModal, buy, retry: jest.fn(() => Promise.resolve()), quietCheckFailed: true },
      )

      expect(shown).toBe(true)
      expect(opened).toHaveLength(1)
      expect(opened[0].buttons).toEqual(['OK'])
      expect(opened[0].message).toContain('this hardware cannot hold a licence')
    })

    it('never labels the failure as "not licensed"', () => {
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(report({ state: 'check-failed', error: 'Request timeout' }), { openModal, buy })

      expect(opened[0].title).not.toMatch(/not licen/i)
      expect(opened[0].buttons).not.toContain('Buy Licence')
    })
  })

  describe('demo-mode wording', () => {
    it('is explicit that the DEVICE enforces demo mode, not the editor', () => {
      // Saying or implying the editor gates the upload would be false: it uploads
      // either way, and the licence-core on the device is what limits actuation.
      const { opened, openModal, buy } = harness()

      explainLicenseOutcome(report({ state: 'unlicensed', entitlementChecked: true }), { openModal, buy })

      expect(opened[0].message).toContain('enforced on the device, not by the editor')
      expect(opened[0].message).toContain('build and upload')
    })

    it('never claims to know the execution mode the board is running in', () => {
      // The editor verifies POSSESSION, not the signature — it cannot know whether
      // the closed core will run FULL. No branch may assert an execution mode.
      const { opened, openModal, buy, retry } = harness()
      const outcomes: DeviceLicenseReport['outcome'][] = [
        { state: 'unlicensed', entitlementChecked: true },
        { state: 'unlicensed', entitlementChecked: false },
        { state: 'unsupported' },
        { state: 'check-failed', error: 'x' },
      ]

      for (const outcome of outcomes) explainLicenseOutcome(report(outcome), { openModal, buy, retry })

      for (const props of opened) {
        expect(props.title).not.toMatch(/full mode|unlocked/i)
        expect(props.message).not.toMatch(/full mode|unlocked/i)
      }
    })
  })
})
