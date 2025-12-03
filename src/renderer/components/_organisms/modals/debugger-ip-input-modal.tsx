import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

import { Label } from '../../_atoms'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const DebuggerIpInputModal = () => {
  const { modals, modalActions } = useOpenPLCStore()
  const [ipAddress, setIpAddress] = useState('')
  const isOpen = modals['debugger-ip-input']?.open || false
  const modalData = modals['debugger-ip-input']?.data as {
    title: string
    message: string
    defaultValue: string
    onSubmit: (value: string) => void
    onCancel: () => void
  } | null

  useEffect(() => {
    if (isOpen && modalData) {
      setIpAddress(modalData.defaultValue)
    }
  }, [isOpen, modalData])

  const handleSubmit = () => {
    if (modalData?.onSubmit) {
      modalData.onSubmit(ipAddress.trim())
    }
    modalActions.closeModal()
    setIpAddress('')
  }

  const handleCancel = () => {
    if (modalData?.onCancel) {
      modalData.onCancel()
    }
    modalActions.closeModal()
    setIpAddress('')
  }

  if (!modalData) return null

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
        modalActions.onOpenChange('debugger-ip-input', open)
      }}
    >
      <ModalContent className='flex min-h-[250px] w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>{modalData.title}</ModalTitle>
        <p className='mb-4 text-center text-sm text-neutral-700 dark:text-neutral-300'>{modalData.message}</p>
        <div className='w-full'>
          <Label htmlFor='ip-address' className='mb-2 block text-sm'>
            IP Address
          </Label>
          <input
            id='ip-address'
            type='text'
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
            placeholder='192.168.1.100'
            className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
            autoFocus
          />
        </div>
        <div className='mt-6 flex w-full gap-3'>
          <button
            onClick={handleSubmit}
            className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
          >
            OK
          </button>
          <button
            onClick={handleCancel}
            className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { DebuggerIpInputModal }
