import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'

import { LICENSE_PRICE } from './mock-license'

export type PurchaseStep = 'confirm' | 'browser' | 'success' | 'error'

interface LicensePurchaseModalProps {
  /** null closes the modal. */
  step: PurchaseStep | null
  vppName: string
  deviceId: string
  /** confirm → open the external browser checkout (caller handles it). */
  onConfirm: () => void
  /** browser step acknowledged → close, stay in "pending". */
  onBrowserAck: () => void
  /** success → mark licensed. */
  onFinish: () => void
  /** error → re-check. */
  onRetry: () => void
  onClose: () => void
}

const primaryBtn =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md bg-brand px-4 font-caption text-sm font-medium text-white hover:bg-brand-medium-dark'
const secondaryBtn =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md bg-neutral-100 px-4 font-caption text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-white dark:hover:bg-neutral-800'

const TITLES: Record<PurchaseStep, string> = {
  confirm: 'Buy driver license',
  browser: 'We opened your browser',
  success: 'License activated on this device',
  error: 'No internet to verify',
}

/**
 * Purchase sub-flow modal (presentational; driven by `step`).
 *
 * confirm → browser (external checkout) → [close, stays pending] → on
 * "check now"/next upload: success, or error when offline. No polling screen —
 * the offline-first flow activates the license on the next upload.
 */
export const LicensePurchaseModal = ({
  step,
  vppName,
  deviceId,
  onConfirm,
  onBrowserAck,
  onFinish,
  onRetry,
  onClose,
}: LicensePurchaseModalProps) => {
  return (
    <Modal
      open={step !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ModalContent className='h-fit w-[430px]'>
        <ModalHeader>
          <ModalTitle>{step ? TITLES[step] : ''}</ModalTitle>
        </ModalHeader>

        {step === 'confirm' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <p>One-time payment. No subscription.</p>
              <div className='flex flex-col gap-1 rounded-md bg-neutral-100 p-3 text-xs dark:bg-neutral-850'>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>Driver</span>
                  <span className='font-medium text-neutral-850 dark:text-neutral-200'>{vppName}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>Device</span>
                  <span className='truncate font-mono text-neutral-850 dark:text-neutral-200'>{deviceId}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>Price</span>
                  <span className='font-medium text-neutral-850 dark:text-neutral-200'>{LICENSE_PRICE} · one-time</span>
                </div>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                You&apos;ll finish in your browser, on a secure page. No account needed — just an email. The license is
                tied to this device and activates on the next upload.
              </p>
            </div>
            <ModalFooter className='flex justify-end gap-2'>
              <button type='button' className={secondaryBtn} onClick={onClose}>
                Continue in demo
              </button>
              <button type='button' className={primaryBtn} onClick={onConfirm}>
                Buy · {LICENSE_PRICE}
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'browser' && (
          <>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              Finish the payment in the browser tab we opened, on a secure page. No account needed — just an email. The
              license activates on the next upload to this device.
            </p>
            <ModalFooter className='flex justify-end'>
              <button type='button' className={primaryBtn} onClick={onBrowserAck}>
                Got it
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'success' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <div className='flex items-center gap-2 font-medium text-green-600 dark:text-green-400'>
                <span>✓</span>
                <span>License written to the hardware.</span>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                The driver now works offline, with no time limit. HW-ID {deviceId}
              </p>
            </div>
            <ModalFooter className='flex justify-end'>
              <button type='button' className={primaryBtn} onClick={onFinish}>
                Done
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'error' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <div className='flex items-start gap-2 text-amber-600 dark:text-amber-400'>
                <span>⚠</span>
                <span>You need an internet connection to activate the license.</span>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                Connect and upload to the device again — your purchase isn&apos;t lost and applies as soon as
                you&apos;re online.
              </p>
            </div>
            <ModalFooter className='flex justify-end gap-2'>
              <button type='button' className={secondaryBtn} onClick={onClose}>
                Close
              </button>
              <button type='button' className={primaryBtn} onClick={onRetry}>
                Try again
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
