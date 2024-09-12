import React from 'react'

import { Modal, ModalContent, ModalHeader, ModalTrigger } from '../../modal'

type IIntervalModalProps = {
  intervalModalOpen: boolean
  setIntervalModalIsOpen: (value: boolean) => void
}
export default function IntervalModal({ intervalModalOpen, setIntervalModalIsOpen }: IIntervalModalProps) {
  return (
    <Modal open={intervalModalOpen} onOpenChange={setIntervalModalIsOpen}>
      <ModalTrigger
        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
        onClick={() => setIntervalModalIsOpen(true)}
      >
        {' '}
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Interval</span>
      </ModalTrigger>
      <ModalContent className='w-[300px] h-80 bg-red-500'>
        <ModalHeader>Interval </ModalHeader>
      </ModalContent>
    </Modal>
  )
}
