import { InputWithRef } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import React from 'react'

export default function SearchInProject() {
  return (
    <Modal>
      <ModalTrigger>Search</ModalTrigger>
      <ModalContent className='h-[424px] w-[668px] select-none flex-col justify-between px-8 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Search in Project</ModalTitle>
        <div className='flex h-full w-full flex-col gap-8'>
          <div className='flex h-[57px] w-full gap-6'>
            <div className='flex w-full flex-col justify-between'>
              <p className='text-cp-base font-medium text-neutral-950 dark:text-white'>Pattern to Search</p>
              <InputWithRef className='h-[30px] w-full rounded-lg border border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-100' />
            </div>
            <div className=' flex flex-col justify-between'>
              <div>
                <p className='whitespace-nowrap text-cp-base font-medium text-neutral-950 dark:text-white '>
                  Sensitive case
                </p>
              </div>
              <div>
                <p className='whitespace-nowrap text-cp-base font-medium text-neutral-950 dark:text-white '>
                  Regular Expression
                </p>
              </div>
            </div>
          </div>
          <div className=' h-[183px]  w-full'></div>
          <div className='flex !h-8 w-full gap-6'>
            <button className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'>
              Confirm
            </button>
            <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
