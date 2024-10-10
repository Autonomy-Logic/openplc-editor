/* eslint-disable @typescript-eslint/no-misused-promises */
import { BookIcon, FolderIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { useState } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'

import { NewProjectStore } from '../project-modal'

const Step1 = ({ onNext }: { onNext: () => void }) => {
  const { handleSubmit, setValue, reset } = useForm<{ type: string }>()

  const handleUpdateForm = NewProjectStore((state) => state.setFormData)

  const [selected, setSelected] = useState<string>('')

  const handleFormSubmit: SubmitHandler<{ type: string }> = (data) => {
    handleUpdateForm({
      type: data.type,
      name: '',
      path: '',
      language: '',
      time: '',
    })
    onNext()
    console.log('All Data 1', data.type)
  }

  const handleSelectType = (type: string) => {
    setSelected(type)
    setValue('type', type)
  }

  const handleCancel = () => {
    reset()
    setSelected('')
  }

  return (
    <>
      <div className='relative flex items-center justify-center pt-2 pb-20 select-none'>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500 font-bold text-white'>
          1
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>

        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 text-gray-500'>
          2
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>

        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 text-gray-500'>
          3
        </div>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className='flex flex-grow flex-col justify-between'>
        <div>
          <h2 className='mb-8 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            What type of project will you be working on?
          </h2>

          <div className='flex w-full justify-around'>
            {/* PLC Project Button */}
            <button
              type='button'
              className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${
                selected === 'project'
                  ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600'
                  : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'
              }`}
              onClick={() => handleSelectType('project')}
            >
              <FolderIcon className='mr-2' /> PLC Project
            </button>

            <div className='relative group'>
              <button
                type='button'
                className='flex h-10 w-40 items-center justify-center rounded-md border-2 border-transparent bg-gray-200 text-black opacity-50 cursor-not-allowed'
                disabled
              >
                <BookIcon className='mr-2' /> Library
              </button>
              <span className='absolute left-1/2 -translate-x-1/2 bottom-12 mb-1 hidden w-40 rounded bg-gray-800 p-2 text-center text-white text-xs opacity-0 group-hover:block group-hover:opacity-100'>
                Feature in development
              </span>
            </div>
          </div>
        </div>

        <div className='flex flex-row justify-center space-x-4'>
          <button
            type='button'
            onClick={handleCancel}
            className={cn(
              'h-8 w-52 items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
            )}
          >
            Cancel
          </button>

          <button
            type='submit'
            className={`h-8 w-52 items-center rounded-lg text-center font-medium text-white ${
              selected ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'
            }`}
            disabled={!selected}
          >
            Next
          </button>
        </div>
      </form>
    </>
  )
}

export { Step1 }
