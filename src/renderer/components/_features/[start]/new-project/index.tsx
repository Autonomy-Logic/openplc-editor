import { BookIcon, FolderIcon } from '@root/renderer/assets'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
import React, { useEffect, useState } from 'react'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ isOpen, onClose }) => {
  const [selected, setSelected] = useState<string | null>(null)

  const handleClick = (value: string) => {
    setSelected(value)
  }

  // Reset the state when the modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelected(null)
    }
  }, [isOpen])

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose}>
        <div className='flex h-full  w-full flex-col items-center justify-around '>
          {/* Progress Bar */}
          <div className='relative mb-8 flex h-[100px] items-center justify-center'>
            <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white font-bold text-blue-500 '>
              1
            </div>
            <div className='h-[2px] w-12 bg-gray-500'></div>
            <div className='flex items-center'>
              <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 font-bold text-gray-500'>
                2
              </div>
            </div>

            <div className='h-[2px] w-12 bg-gray-500'></div>

            <div className='flex items-center'>
              <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 font-bold text-gray-500'>
                3
              </div>
            </div>
          </div>
          <div>
            <h2 className=' mb-14 text-center text-lg font-semibold'>What type of project you will be working on?</h2>{' '}
            <div className='mb-16 flex w-full justify-around '>
              <button
                className={`flex h-10 w-40 items-center justify-center rounded-md border-2  ${selected === 'project' ? 'border-blue-300 bg-blue-300 text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
                onClick={() => handleClick('project')}
              >
                <FolderIcon className='mr-2' /> PLC Project
              </button>
              <button
                className={`flex h-10 w-40 items-center justify-center rounded-md border-2  ${selected === 'library' ? 'border-blue-300 bg-blue-300  text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
                onClick={() => handleClick('library')}
              >
                <BookIcon className='mr-2' /> Library
              </button>
            </div>
          </div>

          <div className='flex flex-row justify-center space-x-4'>
            <button
              className='flex h-8 w-52 items-center justify-center rounded-md bg-neutral-100 font-semibold !text-neutral-1000 hover:bg-neutral-200 disabled:hover:bg-neutral-100 dark:bg-white dark:hover:bg-neutral-100'
              type='button'
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className={`flex h-8 w-52 items-center justify-center rounded-md bg-brand font-semibold !text-white hover:bg-brand-medium-dark focus:bg-brand-medium ${
                !selected ? 'cursor-not-allowed opacity-50 disabled:hover:bg-brand' : ''
              }`}
              type='button'
              disabled={!selected}
            >
              Next
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
