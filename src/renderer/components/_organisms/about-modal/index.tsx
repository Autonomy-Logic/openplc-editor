import openPlcLogo from '@root/renderer/assets/icons/about/logo.svg'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

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
  const closeModal = () => {
    setModalOpen('aboutOpenPlc', false)
  }
  const title = 'OpenPLC Editor 4.0.3-beta'
  const releaseDate = 'Release: 2025-04-18'
  const description = 'Open Source IDE for the OpenPLC Runtime, compliant with the IEC 61131-3 international standard.'
  const copyright = '© 2024 Autonomy Logic'
  const linkUrl = 'https://autonomylogic.com/'

  const handleOpenAboutLink = () => {
    void window.bridge.openExternalLinkAccelerator(linkUrl)
  }

  const [isAboutOpen, setIsAboutOpen] = useState(false)

  const openAboutModal = () => {
    if (!isAboutOpen) {
      setIsAboutOpen(true)
      setModalOpen('aboutOpenPlc', true)
    }
  }

  useEffect(() => {
    window.bridge.aboutModalAccelerator((_event) => {
      openAboutModal()
    })
  }, [])

  return (
    <Modal onOpenChange={handleOpenChange} open={isAboutModalOpen}>
      <ModalContent className='h-[520px] w-[508px] select-none flex-col justify-between px-4 py-4'>
        <div className='flex h-[180px] w-full items-center justify-center bg-[#0464fb]'>
          <img src={openPlcLogo} />
        </div>

        <div className='text-center text-xs font-normal text-neutral-950 dark:text-neutral-200'>
          <div className='text-xl font-medium'>
            <h2>{title}</h2>
            <h2>{releaseDate}</h2>
          </div>
          <div className='text-center'>
            <p className='mt-4'>{description}</p>
          </div>
          <p className='mt-4'>{copyright}</p>
          <p className='mt-4'>
            <button onClick={() => void handleOpenAboutLink()} className='text-[#0464fb] underline'>
              {linkUrl}
            </button>
          </p>
        </div>

        <div className='my-4 flex justify-center gap-3 text-sm font-medium dark:text-neutral-100'>
          {['Credits', 'License', 'Sponsors', 'Close'].map((label, index) => (
            <button key={index} className='h-8 w-20 rounded-md bg-neutral-100 dark:bg-neutral-850' onClick={closeModal}>
              {label}
            </button>
          ))}
        </div>
      </ModalContent>
    </Modal>
  )
}

export default AboutModal
