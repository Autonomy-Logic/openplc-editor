import { useOpenPLCStore } from '@root/renderer/store'
import { useState } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const EmscriptenInstallModal = () => {
  const { modals, modalActions } = useOpenPLCStore()
  const [isInstalling, setIsInstalling] = useState(false)
  const [installationStatus, setInstallationStatus] = useState<string>('')
  const [error, setError] = useState<string>('')

  const isOpen = modals['emscripten-install']?.open || false

  const handleInstall = async () => {
    setError('')
    setInstallationStatus('Starting Emscripten installation...')
    setIsInstalling(true)

    try {
      const result = await window.bridge.installEmscripten((status: string) => {
        setInstallationStatus(status)
      })

      if (result.success) {
        setInstallationStatus('Emscripten installed successfully!')
        setTimeout(() => {
          modalActions.closeModal()
          setInstallationStatus('')
          setIsInstalling(false)
        }, 2000)
      } else {
        setError('Installation failed: ' + (result.error || 'Unknown error'))
        setIsInstalling(false)
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError('Error: ' + errorMessage)
      setIsInstalling(false)
    }
  }

  const handleCancel = () => {
    if (!isInstalling) {
      modalActions.closeModal()
      setInstallationStatus('')
      setError('')
    }
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => modalActions.onOpenChange('emscripten-install', open)}>
      <ModalContent className='flex min-h-[350px] w-[500px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Emscripten Required</ModalTitle>

        <p className='mb-6 text-center text-sm text-neutral-700 dark:text-neutral-300'>
          The OpenPLC Simulator requires Emscripten to compile WebAssembly code. Emscripten is not currently installed
          on your system.
        </p>

        <p className='mb-6 text-center text-sm text-neutral-700 dark:text-neutral-300'>
          Would you like to download and install Emscripten automatically? This may take several minutes.
        </p>

        {installationStatus && (
          <div className='mb-4 w-full rounded-md bg-neutral-100 p-3 dark:bg-neutral-800'>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>{installationStatus}</p>
          </div>
        )}

        {error && (
          <div className='mb-4 w-full rounded-md bg-red-50 p-3 dark:bg-red-900/20'>
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          </div>
        )}

        <div className='mt-4 flex w-full gap-3'>
          <button
            onClick={() => void handleInstall()}
            disabled={isInstalling}
            className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
          >
            {isInstalling ? 'Installing...' : 'Install Emscripten'}
          </button>
          <button
            onClick={handleCancel}
            disabled={isInstalling}
            className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { EmscriptenInstallModal }
