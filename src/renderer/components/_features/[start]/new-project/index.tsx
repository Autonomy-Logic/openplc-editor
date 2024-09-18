import { BookIcon, FolderIcon } from '@root/renderer/assets'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
import React, { useState } from 'react'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ isOpen, onClose }) => {
  const [selected, setSelected] = useState<string | null>(null)

  const handleClick = (value: string) => {
    setSelected(value)
  }

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose}>
        <div className='flex h-full w-full flex-col items-center justify-between'>
          {/* Progress Bar */}
          <div className='relative flex h-[100px] items-center justify-center'>
            {/* Step 1 */}
            <div className='relative flex items-center'>
              {/* Outer Circle */}
              <div className='relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-blue-500'>
                {/* Inner Circle */}
                <div className='absolute flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#0464fb] bg-[#0464fb] font-bold text-[#d0e2fe]'>
                  1
                </div>
              </div>
            </div>

            {/* Line between step 1 and step 2 */}
            <div className='space-y-1'>
              <div className='h-[2px] w-12 bg-blue-500'></div>
              <div className='h-[2px] w-12 bg-blue-500'></div>
            </div>
            {/* Step 2 */}
            <div className='flex items-center'>
              <div className='bg-custom-gray-light z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-[#edeff2] font-bold text-blue-500'>
                2
              </div>
            </div>

            {/* Line between step 2 and step 3 */}
            <div className='space-y-1'>
              <div className='h-[2px] w-12 bg-blue-500'></div>
              <div className='h-[2px] w-12 bg-blue-500'></div>
            </div>

            {/* Step 3 */}
            <div className='flex items-center'>
              <div className='bg-custom-gray-light z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-[#edeff2] font-bold text-blue-500'>
                3
              </div>
            </div>
          </div>

          <h2 className='mb-4 text-center text-lg font-semibold'>What type of project you will be working on?</h2>
          <div className='flex w-full justify-around bg-white'>
            <button
              className={`flex h-12 w-40 items-center justify-center rounded-md border-2  ${selected === 'project' ? 'border-blue-500 bg-blue-500 text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
              onClick={() => handleClick('project')}
            >
              <FolderIcon className='mr-2' /> PLC Project
            </button>
            <button
              className={`flex h-12 w-40 items-center justify-center rounded-md border-2  ${selected === 'library' ? 'border-blue-500 bg-blue-500  text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
              onClick={() => handleClick('library')}
            >
              <BookIcon className='mr-2' /> Library
            </button>
          </div>
          <div className='flex flex-row justify-center space-x-4'>
            <button className='flex h-8 w-48 items-center justify-center rounded-md bg-[#0464fb] px-4 py-2 font-semibold text-white shadow-[0_4px_4px_rgba(0,_0,_0,_0.25)] transition-all duration-300 hover:shadow-xl active:scale-95 active:shadow-inner'>
              Cancel
            </button>
            <button className='flex h-8 w-48  items-center justify-center rounded-md border-2 border-[#0464fb] bg-white px-4 py-2  font-semibold text-black shadow-[0_4px_4px_rgba(0,_0,_0,_0.25)] transition-all duration-300 hover:border-[#0350c9] hover:shadow-xl active:scale-95 active:shadow-inner'>
              Next
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
