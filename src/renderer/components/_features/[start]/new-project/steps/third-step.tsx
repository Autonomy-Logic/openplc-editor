/* eslint-disable @typescript-eslint/no-misused-promises */
import { PouLanguageSources } from '@process:renderer/data'
import { TimerIcon } from '@root/renderer/assets'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { cn, ConvertToLangShortenedFormat } from '@root/utils'
import { useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

import { IntervalModal } from '../interval-model'
import { NewProjectStore } from '../project-modal'

const Step3 = ({ onPrev, onClose }: { onPrev: () => void; onClose: () => void }) => {
  type FormData = {
    name: string
    path: string
    language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
    time: string
  }

  const { handleSubmit, control } = useForm<FormData>()
  const handleUpdateForm = NewProjectStore((state) => state.setFormData)
  const projectData = NewProjectStore((state) => state.formData)
  const [isModalOpen, setModalOpen] = useState(false)
  const [intervalValue, setIntervalValue] = useState('T#20ms')

  const handleFormSubmit: SubmitHandler<FormData> = (data) => {
    const allData = {
      ...projectData,
      language: data.language,
      time: intervalValue,
    }
    handleUpdateForm(allData)
    console.log('All Data 3:', allData)
    onClose()
  }

  return (
    <>
      <div className='relative flex items-center justify-center pt-2'>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-500'>
          1
        </div>
        <div className='h-[2px] w-12 bg-blue-300'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-500'>
          2
        </div>
        <div className='h-[2px] w-12 bg-blue-300'></div>
        <div className='z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500 font-bold text-white'>
          3
        </div>
      </div>

      <form onSubmit={handleSubmit(handleFormSubmit)} className='flex flex-grow flex-col justify-between'>
        <div className=' flex flex-col items-center justify-center'>
          <h2 className=' select-none text-center text-lg font-semibold text-neutral-900 dark:text-white'>
            Choose the language for the base program:
          </h2>
          <div
            id='pou-language-form-container'
            className='flex w-full max-w-sm flex-col items-center rounded-md  p-4 '
          >
            <Controller
              name='language'
              control={control}
              rules={{ required: true }}
              render={({ field: { value, onChange } }) => {
                return (
                  <Select value={value} onValueChange={onChange}>
                    <SelectTrigger
                      withIndicator
                      aria-label='pou-language'
                      placeholder='Select a language'
                      className='flex h-[40px] w-64 items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 font-medium text-neutral-700 shadow-sm outline-none transition-colors duration-200 ease-in-out hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300'
                    />
                    <SelectContent
                      className='z-50 w-64 rounded-md bg-white shadow-lg dark:bg-neutral-900'
                      position='popper'
                      align='center'
                      side='bottom'
                    >
                      {PouLanguageSources.map((lang) => {
                        return (
                          <SelectItem
                            key={lang.value}
                            className='flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                            value={ConvertToLangShortenedFormat(lang.value)}
                          >
                            <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                              {lang.icon} {lang.value}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )
              }}
            />
          </div>
        </div>

        <div className='flex flex-col items-center justify-between gap-1'>
          <h2 className='select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Define the time for the cyclic task:
          </h2>
          <button
            type='button'
            className={cn(
              'group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400',
            )}
            onClick={() => setModalOpen(true)}
          >
            <TimerIcon className='mr-2 mt-2' />
            <span className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white'>
              {intervalValue}
            </span>
          </button>
          {isModalOpen && (
            <IntervalModal
              initialValue={intervalValue}
              onValueChange={(value) => {
                setIntervalValue(value)
              }}
              onClose={() => setModalOpen(false)}
              open={isModalOpen}
            />
          )}
        </div>

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
            className={cn('h-8 w-52 items-center rounded-lg bg-blue-500 text-center font-medium text-white')}
          >
            Next
          </button>
        </div>
      </form>
    </>
  )
}

export { Step3 }
