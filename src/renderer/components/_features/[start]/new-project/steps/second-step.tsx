/* eslint-disable @typescript-eslint/no-misused-promises */

import { PathIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'

import { NewProjectStore } from '../store'


const Step2 = ({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) => {
  const { register, handleSubmit, setValue, watch } = useForm<{ name: string; path: string }>()
  const handleUpdateForm = NewProjectStore((state) => state.setFormData)
  const projectData = NewProjectStore((state) => state.formData)
  const [path, setPath] = useState('')
  const [pathErrorMessage, setPathErrorMessage] = useState('')

  const formData = watch()

  useEffect(() => {
    if (projectData.name) setValue('name', projectData.name)
    if (projectData.path) setValue('path', projectData.path)
  }, [projectData, setValue])

  const handleFormSubmit: SubmitHandler<{ name: string; path: string }> = (data) => {
    const allData = { ...projectData, name: data.name, path: data.path }
    handleUpdateForm(allData)
    onNext()
  }

  const handlePathPicker = async () => {
    const res = await window.bridge.pathPicker()
    if (res.success && res.path) {
      setPath(res.path)
      handleUpdateForm({ ...projectData, path: res.path })
      setPathErrorMessage('')
    } else if (res.error) {
      setPathErrorMessage(` ${res.error.description}`)
    }
  }

  const inputStyle =
    'border h-[40px] dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  const isFormValid = formData.name && formData.path

  return (
    <>
      <div className='relative flex select-none items-center justify-center pt-2'>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500 font-bold text-white'>
          1
        </div>
        <div className='h-[2px] w-12 bg-blue-300'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-500 dark:bg-neutral-950'>
          2
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
          3
        </div>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className='flex flex-grow flex-col justify-between'>
        {/* Project Name */}
        <div className='flex flex-col items-center justify-center'>
          <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Give a name for the project: *
          </h2>
          <div className='relative h-10 w-64'>
            <input
              id='project-name'
              className={`flex w-64 truncate bg-inherit px-2 py-0 text-sm font-medium leading-tight text-neutral-950 outline-none dark:text-white ${inputStyle}`}
              {...register('name', { required: true })}
              autoFocus
              placeholder='Project Name'
            />
          </div>
        </div>

        {/* Path Selection */}
        <div className='flex flex-col items-center'>
          <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Choose an empty directory for your project: *
          </h2>
          <div className='relative h-20 w-64'>
            {' '}
            {/* Fixed height for the div element */}
            <div
              className='group flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2'
              onClick={handlePathPicker}
            >
              <PathIcon className='mr-2 mt-3 flex-shrink-0 cursor-pointer text-gray-400 group-hover:text-neutral-1000 dark:text-white' />
              <input
                type='text'
                id='project-path'
                className='flex w-full cursor-pointer truncate bg-inherit px-2 py-0 text-sm font-medium leading-tight text-neutral-950 outline-none dark:text-white'
                placeholder={path || 'Choose path'}
                {...register('path')}
                readOnly
              />
            </div>
            {/* Error message with fixed height */}
            {pathErrorMessage && (
              <div className='absolute bottom-0 left-0 w-full text-sm text-red-600' style={{ height: '20px' }}>
                {pathErrorMessage}
              </div>
            )}
          </div>
        </div>
        {/* Navigation Buttons */}
        <div className='mt-4 flex flex-row justify-center space-x-4'>
          <button
            type='button'
            className={cn(
              'h-8 w-52 items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100',
            )}
            onClick={onPrev}
          >
            Prev
          </button>
          <button
            type='submit'
            disabled={!isFormValid}
            className={`h-8 w-52 rounded-lg bg-brand text-white ${!isFormValid ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Next
          </button>
        </div>
      </form>
    </>
  )
}

export { Step2 }
