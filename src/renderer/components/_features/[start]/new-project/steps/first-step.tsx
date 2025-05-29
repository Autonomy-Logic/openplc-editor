/* eslint-disable @typescript-eslint/no-misused-promises */

import { BookIcon, FolderIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'

import { NewProjectStore } from '../store'

const Step1 = ({ onNext, onClose }: { onNext: () => void; onClose: () => void }) => {
  const { handleSubmit, setValue } = useForm<{ type: string }>()

  const handleUpdateForm = NewProjectStore((state) => state.setFormData)
  const projectData = NewProjectStore((state) => state.formData)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (projectData.type) {
      setSelected(projectData.type)
      setValue('type', projectData.type)
    }
  }, [projectData, setValue])

  const handleFormSubmit: SubmitHandler<{ type: string }> = (data) => {
    handleUpdateForm({
      ...projectData,
      type: data.type,
    })
    onNext()
  }

  const handleSelectType = (type: string) => {
    setSelected(type)
    setValue('type', type)
  }

  const handleCancel = () => {
    onClose()
  }

  return (
    <>
      <div className='relative flex select-none items-center justify-center pb-12 pt-2'>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-500 dark:bg-neutral-950 '>
          1
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>

        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
          2
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>

        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
          3
        </div>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className='flex flex-grow flex-col justify-between'>
        <div>
          <h2 className='mb-8 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            What type of project will you be working on? *
          </h2>

          <div className='flex w-full justify-around'>
            <button
              type='button'
              className={`flex h-10 w-40 items-center justify-center rounded-md border-2 ${
                selected === 'plc-project'
                  ? 'border-blue-300 bg-blue-300 text-white dark:border-neutral-600 dark:bg-neutral-600'
                  : 'border-transparent bg-gray-200 text-black hover:border-blue-500 hover:dark:border-neutral-600'
              }`}
              onClick={() => handleSelectType('plc-project')}
            >
              <FolderIcon className='mr-2' /> PLC Project
            </button>

            <div className='group relative'>
              <button
                type='button'
                className='flex h-10 w-40 cursor-not-allowed items-center justify-center rounded-md border-2 border-transparent bg-gray-200 text-black opacity-50'
                disabled
              >
                <BookIcon className='mr-2' /> Library
              </button>
              <span className='absolute bottom-12 left-1/2 mb-1 hidden w-40 -translate-x-1/2 rounded bg-gray-800 p-2 text-center text-xs text-white opacity-0 group-hover:block group-hover:opacity-100'>
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
