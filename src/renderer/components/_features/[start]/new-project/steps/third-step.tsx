/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Select, SelectContent, SelectItem, SelectTrigger } from '@radix-ui/react-select'
import { ArrowIcon, TimerIcon } from '@root/renderer/assets'
import { PouLanguageSources } from '@root/renderer/data'
import { cn, ConvertToLangShortenedFormat } from '@root/utils'
import { useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

import { IntervalModal } from '../interval-model'
import { NewProjectStore } from '../project-modal'

const Step3 = ({ onFinish, onPrev, onClose }: { onFinish: () => void; onPrev: () => void; onClose: () => void }) => {
  type FormData = {
    name: string
    path: string
    language: string
    time: string
  }

  const { handleSubmit, control } = useForm<FormData>()

  const handleUpdateForm = NewProjectStore((state) => state.setFormData)

  const handleFormSubmit: SubmitHandler<FormData> = (data) => {
    handleUpdateForm({
      name: '',
      path: '',
      type: '',
      language: data.language,
      time: data.time,
    })
    onFinish()
    onClose()
  }

  const [isModalOpen, setModalOpen] = useState(false)

  const handleTimeChange = (value: string) => {
    handleUpdateForm((prev: unknown) => ({ ...prev, time: value }))
    setModalOpen(false) // Fecha o modal ao definir o valor
  }

  return (
    <>
      <div className='relative flex items-center justify-center pt-2'>
        {/* Steps */}
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
        <div>
          <h2 className='mb-2 select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Choose the language for the base program:
          </h2>

          <div id='pou-language-form-container' className='flex w-full flex-col items-center gap-[6px]'>
            <Controller
              name='language'
              control={control}
              rules={{ required: true }}
              render={({ field: { onChange, value } }) => {
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
                          {selectedLang.icon}
                          <span>{selectedLang.value}</span>
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
          <h2 className='select-none text-center text-lg font-semibold text-neutral-1000 dark:text-white'>
            Define the time for the cyclic task:
          </h2>
          <button
            type='button'
            className={cn(
              'group flex h-10 w-64 cursor-pointer items-center justify-center rounded-md border border-gray-300 p-2 hover:bg-gray-300 active:bg-gray-400',
            )}
            onClick={() => setModalOpen(true)} // Abre o modal ao clicar
          >
            <TimerIcon className='mr-2 mt-2' />
            <span className='text-sm font-medium text-gray-400 group-hover:text-neutral-1000 dark:text-white'>
              T#20ms
            </span>
          </button>
        </div>

        {/* Renderize o modal somente se isModalOpen for true */}
        {isModalOpen && (
          <IntervalModal
            initialValue='T#20ms'
            onValueChange={handleTimeChange}
            onClose={() => setModalOpen(false)}
            open={false}
          />
        )}

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
            className='h-8 w-52 items-center rounded-lg bg-brand text-center font-medium text-white'
          >
            Create Project
          </button>
        </div>
      </form>
    </>
  )
}

export { Step3 }
