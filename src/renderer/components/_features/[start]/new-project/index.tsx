import { BookIcon, FolderIcon, PasteIcon } from '@root/renderer/assets'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
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

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose} className='h-[400px]'>
        <div className='flex h-full w-full flex-col items-center'>
          {/* Progress Bar */}
          <div className='relative  flex h-[100px] items-center justify-center'>
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

          <div className='flex flex-grow flex-col items-center justify-center'>
            {step === 1 ? (
              <>
                <h2 className='mb-14 text-center text-lg font-semibold text-neutral-1000'>
                  What type of project will you be working on?
                </h2>
                <div className='mb-16 flex w-full justify-around'>
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
                <div className='mb-8'>
                  {' '}
                  {/* Aumente o valor aqui para mais espaço */}
                  <h2 className='mb-2 text-center text-lg font-semibold text-neutral-1000'>
                    Give a name for the project:
                  </h2>
                  <input
                    id='project-name'
                    className='box-border h-[28px] w-[260px] cursor-text rounded-lg border-2 border-blue-500 bg-transparent px-2 py-0 text-xs font-medium leading-tight text-neutral-1000 outline-none dark:text-neutral-50'
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className='mb-8'>
                  {' '}
                  {/* Aumente o valor aqui para mais espaço */}
                  <h2 className='mb-2 text-center text-lg font-semibold text-neutral-1000'>
                    Choose an empty directory for data:
                  </h2>
                  <div className='group flex h-10 w-full cursor-pointer items-center justify-center rounded-md p-2 hover:bg-gray-300 active:bg-gray-400'>
                    <PasteIcon className='mr-2 mt-2 flex-shrink-0' />
                    <h2 className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000'>
                      User/userName/data/plcproject
                    </h2>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom Buttons */}
          <div className='mt-auto flex flex-row justify-center space-x-4'>
            {step === 1 && (
              <button
                className='flex h-8 w-52 items-center justify-center rounded-md bg-neutral-100 font-semibold !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                type='button'
                onClick={onClose}
              >
                Cancel
              </button>
            )}
            {step === 2 && (
              <button
                className='flex h-8 w-52 items-center justify-center rounded-md bg-neutral-100 font-semibold !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                type='button'
                onClick={() => setStep(1)}
              >
                Prev
              </button>
            )}
            <button
              className={`flex h-8 w-52 items-center justify-center rounded-md bg-brand font-semibold !text-white hover:bg-brand-medium-dark focus:bg-brand-medium ${!selected ? 'cursor-not-allowed opacity-50' : ''}`}
              type='button'
              onClick={handleNext}
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
