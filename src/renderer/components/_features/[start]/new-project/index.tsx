import { BookIcon, FolderIcon, PathIcon } from '@root/renderer/assets'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
import { cn } from '@root/utils'
import React, { useEffect, useState } from 'react'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ isOpen, onClose }) => {
  const [selected, setSelected] = useState<string | null>(null)
  const [step, setStep] = useState<number>(1)
  const [projectName, setProjectName] = useState('Project-name')

  useEffect(() => {
    if (!isOpen) {
      setSelected(null)
      setStep(1)
    }
  }, [isOpen])

  const handleClick = (value: string) => {
    setSelected(value)
  }

  const handleNext = () => {
    if (selected) {
      setStep(2)
    }
  }
  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'
  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose} className='flex h-[450px] flex-col justify-between p-6'>
        <div className='flex h-[60px] flex-shrink-0 items-center justify-center select-none'>
          {/* Progress Bar */}
          <div className='relative flex items-center justify-center pt-2'>
            <div
              className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${step === 1 ? 'border-blue-500 bg-white text-blue-500' : 'border-blue-200 bg-blue-300 font-bold text-white'} font-bold`}
            >
              1
            </div>
            <div className={`h-[2px] w-12 ${step === 2 ? 'bg-blue-300' : 'bg-gray-500'}`}></div>
            <div
              className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${step === 2 ? 'border-blue-500 bg-white text-blue-500' : 'border-gray-500 bg-gray-200 text-gray-500'} font-bold`}
            >
              2
            </div>
            <div className='h-[2px] w-12 bg-gray-500'></div>
            <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 font-bold text-gray-500'>
              3
            </div>
          </div>
        </div>

        <div className='flex flex-grow flex-col items-center justify-around py-8'>
          {step === 1 ? (
            <>
              <h2 className='mb-2 text-center text-lg font-semibold text-neutral-1000 dark:text-white select-none'>
                What type of project will you be working on?
              </h2>
              <div className='flex w-full justify-around'>
                <button
                  className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${selected === 'project' ? 'border-blue-300 bg-blue-300 text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
                  onClick={() => handleClick('project')}
                >
                  <FolderIcon className='mr-2' /> PLC Project
                </button>
                <button
                  className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${selected === 'library' ? 'border-blue-300 bg-blue-300 text-white' : 'border-transparent bg-gray-200 text-black hover:border-blue-500'}`}
                  onClick={() => handleClick('library')}
                >
                  <BookIcon className='mr-2' /> Library
                </button>
              </div>
            </>
          ) : (
            // Step 2 Content
            <>
              <div className='mb-4'>
                <h2 className='mb-2 text-center text-lg font-semibold text-neutral-1000 dark:text-white  select-none'>
                  Give a name for the project:
                </h2>
                <div className={`relative flex items-center focus-within:border-brand ${inputStyle}`}>
                  <input
                    id='project-name'
                    className='h-full w-full truncate bg-inherit px-2 py-0 text-sm font-medium leading-tight text-neutral-950 outline-none dark:text-white'
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoFocus
                    placeholder='Project Name'
                  />
                </div>
              </div>
              <div className='mb-4'>
                <h2 className='mb-2 text-center text-lg font-semibold text-neutral-1000 dark:text-white select-none'>
                  Choose an empty directory for your project:
                </h2>
                <div className='group flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400'>
                  <PathIcon className='mr-2 mt-2 flex-shrink-0' />
                  <h2 className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white'>
                    User/userName/data/plcproject
                  </h2>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bottom Buttons */}
        <div className='mt-4 flex flex-row justify-center space-x-4'>
          {step === 1 && (
            <button
              type='button'
              className={cn(
                'h-8 w-52  items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
              )}
              onClick={onClose}
            >
              Cancel
            </button>
          )}
          {step === 2 && (
            <button
              type='button'
              className={cn(
                'h-8 w-52  items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
              )}
              onClick={() => setStep(1)}
            >
              Prev
            </button>
          )}
          <button
            type='button'
            className={`h-8 w-52 items-center rounded-lg text-center font-medium text-white ${selected ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'}`}
            onClick={handleNext}
            disabled={!selected}
          >
            Next
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
