import { ComponentPropsWithoutRef } from 'react'

import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

export type ServerIpMismatch = {
  serverName: string
  serverProtocol: string
  configuredIp: string
}

export type ServerIpMismatchModalData = {
  mismatches: ServerIpMismatch[]
  availableIps: string[]
  onContinue: () => void
  onSwitchToAllInterfaces: () => void
  onCancel: () => void
}

export type ServerIpMismatchModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
}

const ServerIpMismatchModal = ({ isOpen, ...rest }: ServerIpMismatchModalProps) => {
  const {
    modalActions: { closeModal, onOpenChange, getModalState },
  } = useOpenPLCStore()

  const modalState = getModalState('server-ip-mismatch')
  const data = modalState.data as ServerIpMismatchModalData | undefined

  const handleCancel = () => {
    data?.onCancel()
    closeModal()
  }

  const handleContinue = () => {
    data?.onContinue()
    closeModal()
  }

  const handleSwitchToAllInterfaces = () => {
    data?.onSwitchToAllInterfaces()
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        onOpenChange('server-ip-mismatch', open)
        if (!open) {
          handleCancel()
        }
      }}
      {...rest}
    >
      <ModalContent className='flex h-auto max-h-[600px] w-[420px] select-none flex-col items-center justify-start rounded-lg p-6'>
        <ModalTitle className='hidden'>Server IP Address Mismatch</ModalTitle>
        <div className='flex w-full select-none flex-col items-center gap-4'>
          <WarningIcon className='h-[60px] w-[60px] text-amber-500' />
          <div className='text-center'>
            <p className='text-lg font-bold text-gray-600 dark:text-neutral-100'>Server IP Address Mismatch</p>
            <p className='mt-2 text-sm text-gray-500 dark:text-neutral-400'>
              The following servers are configured with IP addresses that don&apos;t exist on the target device:
            </p>
          </div>

          {data?.mismatches && data.mismatches.length > 0 && (
            <div className='max-h-[150px] w-full overflow-y-auto rounded-lg bg-neutral-100 p-3 dark:bg-neutral-850'>
              {data.mismatches.map((mismatch, index) => (
                <div key={index} className='mb-2 last:mb-0'>
                  <p className='text-sm font-medium text-neutral-800 dark:text-neutral-200'>{mismatch.serverName}</p>
                  <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                    {mismatch.serverProtocol}: <span className='font-mono text-red-500'>{mismatch.configuredIp}</span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {data?.availableIps && data.availableIps.length > 0 && (
            <div className='w-full'>
              <p className='mb-1 text-xs font-medium text-gray-500 dark:text-neutral-400'>
                Available interfaces on device:
              </p>
              <div className='flex flex-wrap gap-1'>
                {data.availableIps.map((ip, index) => (
                  <span
                    key={index}
                    className='rounded bg-green-100 px-2 py-0.5 font-mono text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  >
                    {ip}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className='mt-2 flex w-full flex-col gap-2 text-sm'>
            <button
              onClick={handleSwitchToAllInterfaces}
              className='hover:bg-brand/90 w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
            >
              Switch to All Interfaces (0.0.0.0)
            </button>
            <button
              onClick={handleContinue}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Continue Anyway
            </button>
            <button
              onClick={handleCancel}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Cancel Compilation
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { ServerIpMismatchModal }
