import { PouLanguageSources } from '@process:renderer/data'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@radix-ui/react-select'
import { ArrowIcon, BookIcon, FolderIcon, PathIcon, TimerIcon } from '@root/renderer/assets'
import { Modal, ModalContent } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn, ConvertToLangShortenedFormat } from '@root/utils'
import React, { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
}
type CreatePouFormProps = {
  type: 'function' | 'function-block' | 'program'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
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

  const {
    workspaceActions: { setUserWorkspace },
  } = useOpenPLCStore()

  const { control, handleSubmit, reset } = useForm<CreatePouFormProps>({
    defaultValues: {
      type: 'function',
      name: '',
      language: 'il',
    },
  })

  const _retrieveNewProjectData = async () => {
    const { success, data } = await window.bridge.createProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: projectName,
      })
    }
  }

  const handleClick = (value: string) => {
    setSelected(value)
  }

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1)
    }
  }

  const onSubmit = (data: CreatePouFormProps) => {
    console.log(data)
  }

  useEffect(() => {
    if (!isOpen) {
      reset()
      setStep(1)
    }
  }, [isOpen, reset])

  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <form onSubmit={void handleSubmit( onSubmit)}>
        <ModalContent onClose={onClose} className='flex h-[450px] flex-col justify-between p-6'>
          <div className='flex h-[60px] flex-shrink-0 select-none items-center justify-center'>
            {/* Progress Bar */}
            <div className='relative flex items-center justify-center pt-2'>
              <div
                className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${
                  step >= 1
                    ? step === 2 || step === 3
                      ? 'border-blue-500 bg-blue-500 font-bold text-white'
                      : 'border-blue-500 bg-white text-blue-500'
                    : 'border-gray-500 bg-gray-200 text-gray-500'
                }`}
              >
                1
              </div>
              <div className={`h-[2px] w-12 ${step >= 2 ? 'bg-blue-300' : 'bg-gray-500'}`}></div>
              <div
                className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${
                  step === 2
                    ? 'border-blue-500 bg-white font-bold text-blue-500'
                    : step === 3
                      ? 'border-blue-500 bg-blue-500 font-bold text-white'
                      : 'border-gray-500 bg-gray-200 text-gray-500'
                }`}
              >
                2
              </div>
              <div className={`h-[2px] w-12 ${step === 3 ? 'bg-blue-300' : 'bg-gray-500'}`}></div>
              <div
                className={`z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 ${
                  step === 3
                    ? 'border-blue-500 bg-white font-bold text-blue-500'
                    : 'border-gray-500 bg-gray-200 text-gray-500'
                }`}
              >
                3
              </div>
            </div>
          </div>

          <div className='flex flex-grow flex-col items-center justify-around py-8'>
            {step === 1 ? (
              <>
                <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                  What type of project will you be working on?
                </h2>
                <div className='flex w-full justify-around'>
                  <button
                    className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${
                      selected === 'project'
                        ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600'
                        : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'
                    }`}
                    onClick={() => handleClick('project')}
                  >
                    <FolderIcon className='mr-2' /> PLC Project
                  </button>
                  <button
                    className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${
                      selected === 'library'
                        ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600'
                        : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'
                    }`}
                    onClick={() => handleClick('library')}
                  >
                    <BookIcon className='mr-2' /> Library
                  </button>
                </div>
              </>
            ) : step === 2 ? (
              <>
                <div className='mb-4'>
                  <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
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
                <div className='mb-4 flex flex-col items-center'>
                  <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                    Choose an empty directory for your project:
                  </h2>
                  <div className='group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400'>
                    <PathIcon className='mr-2 mt-3 flex-shrink-0 text-gray-400 group-hover:text-neutral-1000 dark:text-white' />
                    <span className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white'>
                      . . .
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
                    Choose the language for the base program:{' '}
                  </h2>
                  <div id='pou-language-form-container' className='flex w-full flex-col items-center gap-[6px]'>
                    <Controller
                      name='language'
                      control={control}
                      rules={{ required: true }}
                      render={({ field: { value, onChange } }) => {
                        const selectedLang = PouLanguageSources.find(
                          (lang) => ConvertToLangShortenedFormat(lang.value) === value,
                        )
                        return (
                          <Select value={value} onValueChange={onChange}>
                            <SelectTrigger
                              aria-label='pou-language'
                              className='flex h-[40px] w-[200px] items-center justify-between gap-1 rounded-md border border-neutral-100 bg-gray-200 px-2 py-1 font-caption text-cp-sm font-medium text-black outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                            >
                              {selectedLang ? (
                                <span className='flex items-center gap-2'>
                                  {selectedLang.icon} <span>{selectedLang.value}</span>
                                </span>
                              ) : (
                                <span>Select a language</span>
                              )}
                              <span className='ml-auto'>
                                <ArrowIcon size='md' direction='down' />
                              </span>
                            </SelectTrigger>

                            <SelectContent
                              className='box h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                              sideOffset={5}
                              alignOffset={5}
                              position='popper'
                              align='center'
                              side='bottom'
                            >
                              {PouLanguageSources.map((lang) => (
                                <SelectItem
                                  key={lang.value}
                                  className='flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900'
                                  value={ConvertToLangShortenedFormat(lang.value)}
                                >
                                  <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                    {lang.icon} <span>{lang.value}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )
                      }}
                    />
                  </div>
                </div>
                <div className='flex flex-col items-center justify-between gap-1'>
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
                </div>
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
                    'h-8 w-52  items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
                  )}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className={`h-8 w-52 items-center rounded-lg text-center font-medium text-white ${
                    selected ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'
                  }`}
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
                  type='button'
                  className={`h-8 w-52 items-center rounded-lg bg-brand text-center font-medium text-white`}
                  onClick={onClose}
                >
                  Create Project
                </button>
              </>
            )}
          </div>
        </ModalContent>
      </form>
    </Modal>
  )
}
