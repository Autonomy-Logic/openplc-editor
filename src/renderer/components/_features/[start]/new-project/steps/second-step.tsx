/* eslint-disable @typescript-eslint/no-misused-promises */

import { PathIcon } from '@root/renderer/assets'
import { SubmitHandler, useForm } from 'react-hook-form'

import { NewProjectStore } from '../project-modal'

const Step2 = ({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) => {
  const { register, handleSubmit } = useForm<{ name: string; path: string }>()
  const handleUpdateForm = NewProjectStore((state) => state.setFormData)
  const projectData = NewProjectStore((state) => state.formData)

  const handleFormSubmit: SubmitHandler<{ name: string; path: string }> = (data) => {
    const allData = {
      ...projectData,
      name: data.name,
      path: data.path,
    }

    handleUpdateForm(allData)
    console.log('All Data:', allData)
    onNext()
  }

  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <>
      <div className='relative flex items-center justify-center pt-2'>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-500'>
          1
        </div>
        <div className='h-[2px] w-12 bg-blue-300'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500 font-bold text-white'>
          2
        </div>
        <div className='h-[2px] w-12 bg-gray-500'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gray-500 bg-gray-200 text-gray-500'>
          3
        </div>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className='flex flex-grow flex-col justify-between'>
        <div className=' flex flex-col items-center justify-center'>
          <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Give a name for the project:
          </h2>
          <div className='relative h-10 w-64 '>
            <div className={`relative flex items-center ${inputStyle} `}>
              <input
                id='project-name'
                className='flex w-64 truncate bg-inherit px-2 py-0 text-sm font-medium leading-tight text-neutral-950 outline-none dark:text-white'
                {...register('name')}
                autoFocus
                placeholder='Project Name'
              />
            </div>
          </div>
        </div>

        <div className='mb-4 flex flex-col items-center'>
          <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Choose an empty directory for your project:
          </h2>
          <div className='group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400'>
            <PathIcon className='mr-2 mt-3 flex-shrink-0 text-gray-400 group-hover:text-neutral-1000 dark:text-white' />
            <input
              id='project-path'
              className='h-full w-full truncate bg-inherit px-2 py-0 text-sm font-medium leading-tight text-neutral-950 outline-none dark:text-white'
              {...register('path')}
              placeholder='Project Path'
            />
          </div>
        </div>

        <div className='mt-4 flex flex-row justify-center space-x-4'>
          <button
            type='button'
            className='h-8 w-52 rounded-lg bg-neutral-100 text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            onClick={onPrev}
          >
            Prev
          </button>
          <button type='submit' className={`h-8 w-52 rounded-lg bg-brand text-white`}>
            Next
          </button>
        </div>
      </form>

    </>
  )
}

export { Step2 }
