import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'

const AboutModal = () => {
  const {
    workspaceActions: { setModalOpen },
    workspace: { isModalOpen },
  } = useOpenPLCStore()

  const handleOpenChange = (open: boolean) => {
    setModalOpen('aboutOpenPlc', open)
  }

  const isAboutModalOpen = isModalOpen.some(
    (modal: { modalName: string; modalState: boolean }) => modal.modalName === 'aboutOpenPlc' && modal.modalState,
  )
  const handleModalClose = () => {
    setModalOpen('aboutOpenPlc', false)
  }
  return (
    <Modal onOpenChange={handleOpenChange} open={isAboutModalOpen}>
      <ModalContent className='h-[540px] w-[508px] select-none flex-col justify-between px-4 py-4'>
        <ModalTitle className='text-xs font-normal text-neutral-950 dark:text-white'>About OpenPLC</ModalTitle>
        <div className='h-[180px] w-full bg-blue-500'></div>
        <div className='text-xs font-normal dark:text-neutral-200'>
          <div className='w-full items-center text-center text-xl font-bold'>
            <h2>OpenPLC Editor 3.0</h2>
            <h2>Release: 2024-10-16</h2>
          </div>

          <p>Open Source IDE for the OpenPLC Runtime, compliant with the IEC 61131-3 international standard.</p>
          <br />
          <p>
            Based on PLCOpen Editor and Beremiz by Andrey Skvortsov, Sergey Surkov, Edourard Tisserant and Laurent
            Bessard.
          </p>
          <p className='w-full items-center text-center'>(C) 2019 Thiago Alves</p>
          <p className='w-full items-center text-center'>
            <a className='text-blue-500 underline' href='https://autonomylogic.com/'>https://autonomylogic.com/</a>
          </p>
        </div>
        <div className='flex w-full justify-center gap-3 font-medium text-sm dark:text-neutral-100'>
          <button className='h-8 w-20 rounded-md bg-neutral-100 dark:bg-neutral-850' onClick={() => handleModalClose()}>
            credits
          </button>
          <button className='h-8 w-20 rounded-md bg-neutral-100 dark:bg-neutral-850' onClick={() => handleModalClose()}>
            license
          </button>
          <button className='h-8 w-20 rounded-md bg-neutral-100 dark:bg-neutral-850' onClick={() => handleModalClose()}>
            sponsors
          </button>
          <button className='h-8 w-20 rounded-md bg-neutral-100 dark:bg-neutral-850' onClick={() => handleModalClose()}>
            Close
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default AboutModal
