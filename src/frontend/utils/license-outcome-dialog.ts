/**
 * Turn a licensing outcome into what the user is told — and what they are offered.
 *
 * Pure decision, separate from the hook that calls it, because this is where the
 * union's distinctions become promises to a customer and each branch has to be
 * defensible on its own:
 *
 *   licensed          → say nothing. A silent success is the correct UX; a dialog
 *                       confirming a licence nobody asked about is noise on every
 *                       single connect.
 *   unlicensed + checked   → demo mode, and OFFER TO BUY. The backend was asked
 *                       and said there is no purchase, so this is the one branch
 *                       where pointing at a purchase page is honest.
 *   unlicensed + NOT checked → demo mode, but offer to CHECK AGAIN, not to buy.
 *                       Nobody asked whether a purchase exists; telling someone
 *                       who already paid to pay again is the worst thing this
 *                       flow can do.
 *   unsupported       → the device cannot store a licence. Buying would not help,
 *                       so no purchase is offered; the detail (when present) names
 *                       a build mismatch, which is actionable.
 *   check-failed      → say we could not tell, and offer a retry. Never present
 *                       this as "not licensed".
 *
 * The demo-mode wording is deliberate about WHO enforces it: the closed
 * license-core inside the VPP does, on the device. The editor uploads either way —
 * it does not gate the build on a licence, and saying it might would be false.
 */

import type { DeviceLicenseReport, DeviceLicenseState } from '@root/middleware/shared/ports/device-port'

/** The subset of the modal action this needs, so tests need no store. */
export type OpenLicenseDialog = (
  name: 'debugger-message',
  props: {
    type: 'error' | 'warning' | 'question' | 'info'
    title: string
    message: string
    buttons: string[]
    onResponse: (buttonIndex: number) => void
  },
) => void

export interface LicenseDialogHandlers {
  openModal: OpenLicenseDialog
  /**
   * Open the device-bound purchase page for `deviceId`.
   *
   * The id is passed IN rather than looked up by the handler, because this dialog
   * is opened straight out of a licensing call and the handler's own view of the
   * current report is one render behind — so a lookup would find nothing on a
   * first connect and the button would do nothing.
   */
  buy: (deviceId?: string) => Promise<void>
  /** Re-run the full licensing flow (offered on a failed or unchecked outcome). */
  retry?: () => Promise<void>
  /**
   * Keep `check-failed` on the badge instead of opening the error modal.
   *
   * For the AUTOMATIC flows (the runtime settle effect) — a modal the user did
   * not ask for, about a question they did not ask, is the wrong surface for
   * "we could not tell". The loudest case this quiets is a runtime that
   * predates the licence function codes, where every connect would otherwise
   * open "Licence Check Failed" on a working device. User-INITIATED paths
   * (serial connect, the badge's own recheck dialog) leave this unset: there
   * the user asked a question and silence would read as success.
   */
  quietCheckFailed?: boolean
}

// "About two hours" mirrors LIC_GATE_DEMO_MS (7200000 ms) in the closed gate.
// If the product decision changes the window, this sentence changes with it —
// a dialog promising minutes while the device enforces hours (or the reverse)
// is the kind of copy drift a customer notices before we do.
const DEMO_EXPLANATION =
  'The device will run in DEMO mode: the VPP stops driving outputs about two hours after each start. ' +
  'You can still build and upload. The licence is enforced on the device, not by the editor.'

/**
 * Show the dialog this outcome warrants, if any. Returns whether one was opened,
 * which is what makes "licensed is silent" testable rather than assumed.
 */
export function explainLicenseOutcome(report: DeviceLicenseReport, handlers: LicenseDialogHandlers): boolean {
  const { openModal, buy, retry, quietCheckFailed } = handlers
  const outcome: DeviceLicenseState = report.outcome

  switch (outcome.state) {
    case 'licensed':
      // Silence on purpose. See the module docstring.
      return false

    case 'unlicensed': {
      if (outcome.entitlementChecked) {
        const reason = outcome.backendReason ? `\n\nThe licence server said: ${outcome.backendReason}` : ''
        openModal('debugger-message', {
          type: 'warning',
          title: 'No Licence for This Device',
          message: `This VPP is a paid product and no licence is registered for this device.${reason}\n\n${DEMO_EXPLANATION}`,
          buttons: ['Buy Licence', 'Continue in Demo Mode'],
          onResponse: (buttonIndex: number) => {
            if (buttonIndex === 0) void buy(report.deviceId)
          },
        })
        return true
      }

      // Nobody asked the backend. Offer a check, NOT a purchase.
      openModal('debugger-message', {
        type: 'warning',
        title: 'No Licence Stored on This Device',
        message: `This device is not holding a valid licence for this VPP. It may simply not have been activated yet.\n\n${DEMO_EXPLANATION}`,
        buttons: retry ? ['Check For Licence', 'Continue in Demo Mode'] : ['OK'],
        onResponse: (buttonIndex: number) => {
          if (retry && buttonIndex === 0) void retry()
        },
      })
      return true
    }

    case 'unsupported':
      // Unconditional wording, and it names the FIRMWARE. Every licensable VPP
      // targets hardware that persists a licence, so a board answering this was
      // built without its storage backend — "your hardware cannot do this" would
      // be false, and it is the message that sent us looking at a NodeMCU that
      // stores licences perfectly well.
      openModal('debugger-message', {
        type: 'warning',
        title: 'Licence Storage Missing from This Firmware',
        message:
          'The firmware on this device reports no licence storage, so a licence cannot be ' +
          'written to it.\n\nThis hardware supports it: every licensed VPP targets hardware that ' +
          'does. The image on the board was built without the storage backend, so rebuild and ' +
          `upload it.\n\n${DEMO_EXPLANATION}`,
        // No purchase offered: buying would not fix a firmware built wrong.
        buttons: ['OK'],
        onResponse: () => undefined,
      })
      return true

    case 'check-failed':
      if (quietCheckFailed) {
        // The badge already renders the check-failed state with its own
        // recheck affordance; the automatic flow adds no modal on top.
        return false
      }
      {
        // A cause the flow marked terminal cannot change by asking again, so
        // the retry is withheld: a button guaranteed to reproduce the same
        // error reads as a flaky link and keeps the user pressing it instead of
        // doing the thing that would fix it (which those messages name).
        const canRetry = retry !== undefined && outcome.retryable !== false
        openModal('debugger-message', {
          type: 'error',
          title: 'Licence Check Failed',
          message:
            `The editor could not determine whether this device holds a licence.\n\n${outcome.error}\n\n` +
            'This is NOT the same as having no licence. Nothing has changed on the device.',
          buttons: canRetry ? ['Try Again', 'Continue'] : ['OK'],
          onResponse: (buttonIndex: number) => {
            if (canRetry && buttonIndex === 0) void retry()
          },
        })
      }
      return true
  }
}
