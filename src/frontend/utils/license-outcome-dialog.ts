/**
 * Turn a licensing outcome into what the user is told — and what they are offered.
 *
 * Pure decision, separate from the hook that calls it, because this is where the
 * union's distinctions become promises to a customer and each branch has to be
 * defensible on its own:
 *
 *   licensed          → say nothing. A silent success is the correct UX; a dialog
 *                       confirming a license nobody asked about is noise on every
 *                       single connect.
 *   unlicensed + checked   → demo mode, and OFFER TO BUY. The backend was asked
 *                       and said there is no purchase, so this is the one branch
 *                       where pointing at a purchase page is honest.
 *   unlicensed + NOT checked → demo mode, but offer to CHECK AGAIN, not to buy.
 *                       Nobody asked whether a purchase exists; telling someone
 *                       who already paid to pay again is the worst thing this
 *                       flow can do.
 *   unsupported       → the device cannot store a license. Buying would not help,
 *                       so no purchase is offered.
 *   check-failed      → say we could not tell, and offer a retry. Never present
 *                       this as "not licensed".
 */

import type { DeviceLicenseReport, DeviceLicenseState } from '@root/middleware/shared/ports/device-port'
import { DEMO_MODE_NOTICE } from '@root/middleware/shared/utils/licensing'

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
   * predates the license function codes, where every connect would otherwise
   * open "License Check Failed" on a working device. User-INITIATED paths
   * (serial connect, the badge's own recheck dialog) leave this unset: there
   * the user asked a question and silence would read as success.
   */
  quietCheckFailed?: boolean
}

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
        openModal('debugger-message', {
          type: 'warning',
          title: 'No License for This Device',
          message: DEMO_MODE_NOTICE,
          buttons: ['Buy License', 'Continue in Demo Mode'],
          onResponse: (buttonIndex: number) => {
            if (buttonIndex === 0) void buy(report.deviceId)
          },
        })
        return true
      }

      // Nobody asked the backend. Offer a check, NOT a purchase.
      openModal('debugger-message', {
        type: 'warning',
        title: 'No License Stored on This Device',
        message: DEMO_MODE_NOTICE,
        buttons: retry ? ['Check for License', 'Continue in Demo Mode'] : ['OK'],
        onResponse: (buttonIndex: number) => {
          if (retry && buttonIndex === 0) void retry()
        },
      })
      return true
    }

    case 'unsupported':
      // Names the firmware, not the hardware: the image was built without a license store.
      openModal('debugger-message', {
        type: 'warning',
        title: 'License Storage Missing from This Firmware',
        message: 'The firmware on this device reports no license storage, so a license cannot be written to it.',
        // No purchase offered: buying would not fix a firmware built wrong.
        buttons: ['OK'],
        onResponse: () => undefined,
      })
      return true

    case 'check-failed':
      if (quietCheckFailed && outcome.retryable !== false) {
        // The badge already renders the check-failed state with its own
        // recheck affordance; the automatic flow adds no modal on top.
        //
        // Only for a RETRYABLE failure, though. A terminal one has no recheck
        // button in the panel any more (that is the point), so silencing the
        // modal too would leave the automatic flow with no surface at all: no
        // dialog, no action, and a popover the user has no reason to open. The
        // loud case this quieting exists for -- a runtime predating the license
        // FCs on every connect -- is retryable, so it stays quiet.
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
          title: 'License Check Failed',
          message: `The editor could not determine whether this device holds a license.\n\n${outcome.error}`,
          buttons: canRetry ? ['Try Again', 'Continue'] : ['OK'],
          onResponse: (buttonIndex: number) => {
            // `retry` re-runs the whole licensing flow, which reaches the
            // network. `void` would turn a rejection into an unhandled one and
            // the user would see the modal close with nothing happening.
            if (canRetry && buttonIndex === 0) {
              retry().catch((error: unknown) => console.error('[license] retry failed', error))
            }
          },
        })
      }
      return true
  }
}
