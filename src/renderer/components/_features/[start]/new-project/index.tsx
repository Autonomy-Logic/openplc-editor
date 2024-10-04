/* eslint-disable @typescript-eslint/no-misused-promises */
import { BookIcon, FolderIcon, PathIcon } from '@root/renderer/assets'
import { InputWithRef,  } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
// import { useOpenPLCStore } from '@root/renderer/store'
import { cn,  } from '@root/utils'
import React, { ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'

type NewProjectModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  onClose: () => void
}

type CreateProjectForm = {
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
}

export const NewProjectModal = ({ isOpen, onClose, ...res }: NewProjectModalProps) => {
  const [selected, setSelected] = useState<'plc-project' | 'plc-library' | null>(null)
  const [step, setStep] = useState<number>(1)

  const { register, handleSubmit, setValue, reset } = useForm<CreateProjectForm>()

  const handleClick = (type: 'plc-project' | 'plc-library') => {
    setSelected(type)
    setValue('type', type) // Atualiza o valor no react-hook-form
  }

  const handleCreateProject: SubmitHandler<CreateProjectForm> = (data) => {
    try {
      console.log(data)
      reset()
      onClose()
    } catch (_error) {
      /* empty */
    }
  }

  useEffect(() => {
    if (!isOpen) {
      setSelected('plc-project')
      setStep(1)
    }
  }, [isOpen])

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1)
    }
  }

  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <Modal open={isOpen} onOpenChange={onClose} {...res}>
      <ModalContent onClose={onClose} className='flex h-[450px] flex-col justify-between p-6'>
        <ModalTitle className='absolute -top-10 opacity-0' />
        <div>
          {/* Progress Bar */}
          <div className='flex h-[60px] flex-shrink-0 select-none items-center justify-center'>
            {/* Progress indicators */}
            <div
              className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${step >= 1 ? (step === 2 || step === 3 ? 'border-blue-500 bg-blue-500 font-bold text-white' : 'border-blue-500 bg-white text-blue-500') : 'border-gray-500 bg-gray-200 text-gray-500'}`}
            >
              1
            </div>
            <div className={`h-[2px] w-12 ${step >= 2 ? 'bg-blue-300' : 'bg-gray-500'}`}></div>
            <div
              className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${step === 2 ? 'border-blue-500 bg-white font-bold text-blue-500' : step === 3 ? 'border-blue-500 bg-blue-500 font-bold text-white' : 'border-gray-500 bg-gray-200 text-gray-500'}`}
            >
              2
            </div>
            <div className={`h-[2px] w-12 ${step === 3 ? 'bg-blue-300' : 'bg-gray-500'}`}></div>
            <div
              className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${step === 3 ? 'border-blue-500 bg-white font-bold text-blue-500' : 'border-gray-500 bg-gray-200 text-gray-500'}`}
            >
              3
            </div>
          </div>

          <form onSubmit={handleSubmit(handleCreateProject)}>
            <div className='flex flex-grow flex-col items-center justify-around py-8'>
              {step === 1 ? (
                <>
                  <h2 className='mb-2 select-none text-lg font-semibold text-neutral-1000 dark:text-white'>
                    What type of project will you be working on?
                  </h2>
                  <div className='flex w-full justify-around'>
                    {/* Botão PLC Project */}
                    <button
                      type='button'
                      className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${selected === 'plc-project' ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600' : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'}`}
                      onClick={() => handleClick('plc-project')}
                    >
                      <FolderIcon className='mr-2' /> PLC Project
                    </button>

                    {/* Botão Library */}
                    <button
                      type='button'
                      className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${selected === 'plc-library' ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600' : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'}`}
                      onClick={() => handleClick('plc-library')}
                    >
                      <BookIcon className='mr-2' /> Library
                    </button>
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div className='mb-4'>
                    <label
                      id='project-name-label'
                      htmlFor='project-name'
                      className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'
                    >
                      Give a name for the project:
                    </label>
                    <InputWithRef
                      {...register('name', {
                        required: true,
                        minLength: 3,
                      })}
                      id='project-name'
                      type='text'
                      placeholder='Project name'
                      className={`relative flex items-center focus-within:border-brand ${inputStyle}`}
                    />
                  </div>
                  <div className='mb-4 flex flex-col items-center'>
                    <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                      Choose an empty directory for your project:
                    </h2>
                    <div className='group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400'>
                      <PathIcon className='mr-2 mt-3 flex-shrink-0 text-gray-400 group-hover:text-neutral-1000 dark:text-white' />
                      <InputWithRef
                        {...register('path', {
                          required: true,
                        })}
                        id='project-directory'
                        type='text'
                        placeholder='. . .'
                        className={`text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white`}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                      Choose the language for the base program:{' '}
                    </h2>
                    <div id='pou-language-form-container' className='flex w-full flex-col gap-[6px] '>
                      <label
                        id='pou-language-label'
                        htmlFor='pou-language'
                        className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        Language:
                      </label>

                    </div>
                  </div>
                  {/* <div className='flex flex-col items-center justify-between gap-1'>
                    <h2 className=' select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                      Define the time for the cyclic task:{' '}
                    </h2>
                    <button
                      type='button'
                      className={cn(
                        'group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400',
                      )}
                    >
                      <TimerIcon className='mr-2 mt-2' />
                      <span className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white'>
                        T#20ms
                      </span>
                    </button>
                  </div> */}
                </>
              )}
            </div>

            {/* Bottom Buttons */}
            <div className='mt-4 flex flex-row justify-center space-x-4'>
              {step === 1 && (
                <>
                  <button
                    type='button'
                    className={cn(
                      'h-8 w-52 items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
                    )}
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    className={`h-8 w-52 items-center rounded-lg text-center font-medium text-white ${selected ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'}`}
                    onClick={handleNext}
                    disabled={!selected}
                  >
                    Next
                  </button>
                </>
              )}
              {step === 2 && (
                <>
                  <button
                    type='button'
                    className={cn(
                      'h-8 w-52 items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
                    )}
                    onClick={() => setStep(1)}
                  >
                    Prev
                  </button>
                  <button
                    type='button'
                    className={`h-8 w-52 items-center rounded-lg bg-brand text-center font-medium text-white`}
                    onClick={handleNext}
                  >
                    Next
                  </button>
                </>
              )}
              {step === 3 && (
                <>
                  <button
                    type='button'
                    className={cn(
                      'h-8 w-52 items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
                    )}
                    onClick={() => setStep(2)}
                  >
                    Prev
                  </button>
                  <button
                    type='submit'
                    className={`h-8 w-52 items-center rounded-lg bg-brand text-center font-medium text-white`}
                  >
                    Create Project
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </ModalContent>
    </Modal>
  )
}
