import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { i18n } from '@root/frontend/locales/i18n'

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
  'inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md bg-brand px-4 font-caption text-sm font-medium text-white hover:bg-brand-medium-dark'
const secondaryBtn =
  'inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md bg-neutral-100 px-4 font-caption text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-white dark:hover:bg-neutral-800'

const titleFor = (step: PurchaseStep): string => {
  switch (step) {
    case 'confirm':
      return i18n.t('license:modal.titles.confirm')
    case 'browser':
      return i18n.t('license:modal.titles.browser')
    case 'success':
      return i18n.t('license:modal.titles.success')
    case 'error':
      return i18n.t('license:modal.titles.error')
  }
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
          <ModalTitle>{step ? titleFor(step) : ''}</ModalTitle>
        </ModalHeader>

        {step === 'confirm' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <p>{i18n.t('license:modal.confirm.subtitle')}</p>
              <div className='flex flex-col gap-1 rounded-md bg-neutral-100 p-3 text-xs dark:bg-neutral-850'>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>
                    {i18n.t('license:modal.confirm.driver')}
                  </span>
                  <span className='font-medium text-neutral-850 dark:text-neutral-200'>{vppName}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>
                    {i18n.t('license:modal.confirm.device')}
                  </span>
                  <span className='truncate font-mono text-neutral-850 dark:text-neutral-200'>{deviceId}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-neutral-500 dark:text-neutral-400'>
                    {i18n.t('license:modal.confirm.price')}
                  </span>
                  <span className='font-medium text-neutral-850 dark:text-neutral-200'>
                    {i18n.t('license:modal.confirm.priceValue', { price: LICENSE_PRICE })}
                  </span>
                </div>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>{i18n.t('license:modal.confirm.note')}</p>
            </div>
            <ModalFooter className='flex justify-end gap-2'>
              <button type='button' className={secondaryBtn} onClick={onClose}>
                {i18n.t('license:modal.confirm.cancel')}
              </button>
              <button type='button' className={primaryBtn} onClick={onConfirm}>
                {i18n.t('license:modal.confirm.buy', { price: LICENSE_PRICE })}
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'browser' && (
          <>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>{i18n.t('license:modal.browser.body')}</p>
            <ModalFooter className='flex justify-end'>
              <button type='button' className={primaryBtn} onClick={onBrowserAck}>
                {i18n.t('license:modal.browser.ack')}
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'success' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <div className='flex items-center gap-2 font-medium text-green-600 dark:text-green-400'>
                <span>✓</span>
                <span>{i18n.t('license:modal.success.body')}</span>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                {i18n.t('license:modal.success.note', { deviceId })}
              </p>
            </div>
            <ModalFooter className='flex justify-end'>
              <button type='button' className={primaryBtn} onClick={onFinish}>
                {i18n.t('license:modal.success.done')}
              </button>
            </ModalFooter>
          </>
        )}

        {step === 'error' && (
          <>
            <div className='flex flex-col gap-3 text-sm text-neutral-700 dark:text-neutral-300'>
              <div className='flex items-start gap-2 text-amber-600 dark:text-amber-400'>
                <span>⚠</span>
                <span>{i18n.t('license:modal.error.body')}</span>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>{i18n.t('license:modal.error.note')}</p>
            </div>
            <ModalFooter className='flex justify-end gap-2'>
              <button type='button' className={secondaryBtn} onClick={onClose}>
                {i18n.t('license:modal.error.close')}
              </button>
              <button type='button' className={primaryBtn} onClick={onRetry}>
                {i18n.t('license:modal.error.retry')}
              </button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
