import { useOpenPLCStore } from '@root/renderer/store'

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
  } | null

  const handleButtonClick = (index: number) => {
    if (modalData?.onResponse) {
      modalData.onResponse(index)
    }
    modalActions.closeModal()
  }

  if (!modalData) return null

  const getIcon = () => {
    switch (modalData.type) {
      case 'error':
        return '❌'
      case 'warning':
        return '⚠️'
      case 'question':
        return '❓'
      case 'info':
      default:
        return 'ℹ️'
    }
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => modalActions.onOpenChange('debugger-message', open)}>
      <ModalContent className='flex min-h-[200px] w-[450px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <div className='mb-4 text-4xl'>{getIcon()}</div>
        <ModalTitle className='mb-4 text-xl font-semibold'>{modalData.title}</ModalTitle>
        <p className='mb-6 text-center text-sm text-neutral-700 dark:text-neutral-300'>{modalData.message}</p>
        <div className='mt-4 flex w-full gap-3'>
          {modalData.buttons.map((button, index) => (
            <button
              key={index}
              onClick={() => handleButtonClick(index)}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                index === 0
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
