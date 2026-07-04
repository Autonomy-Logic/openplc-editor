import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const DebuggerMessageModal = () => {
  const { modals, modalActions } = useOpenPLCStore()
  const isOpen = modals['debugger-message']?.open || false
  const modalData = modals['debugger-message']?.data as {
    type: 'info' | 'warning' | 'error' | 'question'
    title: string
    message: string
    buttons: string[]
    onResponse: (buttonIndex: number) => void
    // Optional layout overrides. By default the FIRST button is the primary
    // (brand) action and dismissing the modal (Escape / click-away) resolves to
    // the LAST button. Usages where the affirmative action isn't first — e.g. a
    // [Cancel, Proceed] layout — set primaryButtonIndex to brand-style the right
    // button and dismissButtonIndex so Escape routes to Cancel.
    primaryButtonIndex?: number
    dismissButtonIndex?: number
  } | null

  const handleButtonClick = (index: number) => {
    // Capture callback before closing (closeModal clears data)
    const onResponse = modalData?.onResponse
    // Close modal first, then call callback to avoid race condition
    // when callback opens another modal
    modalActions.closeModal()
    if (onResponse) {
      onResponse(index)
    }
  }

  if (!modalData) return null

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Capture callback and button count before closing (closeModal clears data)
          const onResponse = modalData?.onResponse
          const lastButtonIndex = modalData?.buttons?.length ? modalData.buttons.length - 1 : 0
          const dismissButtonIndex = modalData?.dismissButtonIndex ?? lastButtonIndex
          // Close modal first, then call callback to avoid race condition
          // when callback opens another modal
          modalActions.closeModal()
          if (onResponse) {
            onResponse(dismissButtonIndex)
          }
        }
        modalActions.onOpenChange('debugger-message', open)
      }}
    >
      <ModalContent className='flex min-h-[200px] w-[450px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <div className='mb-4'>
          <WarningIcon size='lg' className='h-12 w-12' />
        </div>
        <ModalTitle className='mb-4 text-xl font-semibold'>{modalData.title}</ModalTitle>
        <p className='mb-6 text-center text-sm text-neutral-700 dark:text-neutral-300'>{modalData.message}</p>
        <div className='mt-4 flex w-full gap-3'>
          {modalData.buttons.map((button, index) => (
            <button
              key={index}
              onClick={() => handleButtonClick(index)}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                index === (modalData.primaryButtonIndex ?? 0)
                  ? 'bg-brand text-white hover:bg-brand-medium-dark'
                  : 'bg-neutral-100 text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
              }`}
            >
              {button}
            </button>
          ))}
        </div>
      </ModalContent>
    </Modal>
  )
}

export { DebuggerMessageModal }
