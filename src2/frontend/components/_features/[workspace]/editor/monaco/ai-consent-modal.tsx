import { Modal, ModalContent, ModalTitle } from '../../../../_molecules/modal'
import { useOpenPLCStore } from '../../../../../store'

const AIConsentModal = () => {
  const {
    modals,
    modalActions: { onOpenChange },
    aiActions: { setAIConsented, setAIEnabled },
  } = useOpenPLCStore()

  const isOpen = modals['ai-consent']?.open ?? false

  const handleAccept = () => {
    setAIConsented(true)
    onOpenChange('ai-consent', false)
  }

  const handleDecline = () => {
    setAIConsented(false)
    setAIEnabled(false)
    onOpenChange('ai-consent', false)
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('ai-consent', open)}>
      <ModalContent className='flex !inset-x-0 !top-1/2 !bottom-auto !h-auto w-[400px] !-translate-y-1/2 select-none flex-col gap-5 rounded-lg p-6'>
        <ModalTitle className='text-base font-semibold text-neutral-950 dark:text-white'>AI-Assisted Coding</ModalTitle>

        <div className='flex flex-col gap-3 text-sm text-neutral-600 dark:text-neutral-300'>
          <p>
            OpenPLC can use AI to provide inline code completions as you type. When enabled, your code context is sent
            to our AI service to generate suggestions.
          </p>
          <p>You can disable this at any time in AI settings. AI completions use credits from your account.</p>
        </div>

        <div className='flex gap-3'>
          <button
            onClick={handleDecline}
            className='flex-1 rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 dark:bg-neutral-850 dark:text-neutral-100'
          >
            No thanks
          </button>
          <button
            onClick={handleAccept}
            className='flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white'
          >
            Enable AI
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { AIConsentModal }
