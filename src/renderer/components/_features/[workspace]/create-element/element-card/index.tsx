/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { CreatePouSources, PouLanguageSources } from '@process:renderer/data'
import * as Popover from '@radix-ui/react-popover'
import { ArrayIcon, ArrowIcon, EnumIcon, StructureIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { CreateDatatypeObject } from '@root/renderer/store/slices/shared/utils'
import { cn, ConvertToLangShortenedFormat } from '@root/utils'
import { startCase } from 'lodash'
import { Dispatch, ReactNode, SetStateAction, useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

import { useToast } from '../../../[app]/toast/use-toast'
import { CreateDataType } from './data-type-element'

type ElementCardProps = {
  target: 'function' | 'function-block' | 'program' | 'data-type'
  closeContainer: Dispatch<SetStateAction<boolean>>
}

type CreatePouFormProps = {
  type: 'function' | 'function-block' | 'program'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

const ElementCard = (props: ElementCardProps): ReactNode => {
  const { toast } = useToast()
  const { target, closeContainer } = props
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreatePouFormProps>()
  const {
    pouActions: { create },
    workspaceActions: { createDatatype },
  } = useOpenPLCStore()
  const [isOpen, setIsOpen] = useState(false)

  const handleCreatePou: SubmitHandler<CreatePouFormProps> = (data) => {
    console.log(data)
    try {
      const pouWasCreated = create.pou(data)
      if (!pouWasCreated) throw new TypeError()
      toast({ title: 'Pou created successfully', description: 'The POU has been created', variant: 'default' })
      closeContainer((prev) => !prev)
      setIsOpen(false)
    } catch (_error) {
      setError('name', {
        type: 'already-exists',
      })
    }
  }

  const handleCancelCreatePou = () => {
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  const handleCreateDatatype = (derivation: 'enumerated' | 'structure' | 'array') => {
    const data = CreateDatatypeObject(derivation)
    console.log(data)
    createDatatype(data)
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger id={`create-${target}-trigger`} asChild>
        <div
          id={`create-${target}-trigger-container`}
          className='relative flex h-7 w-full cursor-pointer select-none items-center justify-between gap-[6px] rounded-md px-[6px] py-[2px] hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 dark:data-[state=open]:bg-neutral-900'
        >
          {CreatePouSources[target]}
          <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
            {startCase(target)}
          </p>
          <ArrowIcon size='md' direction='right' />
        </div>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content id={`create-${target}-content`} sideOffset={14} alignOffset={-7} align='start' side='right'>
          <div
            id='pou-card-root'
            className='box flex h-fit w-[225px] flex-col gap-3 rounded-lg bg-white px-3 pb-3 pt-2 dark:bg-neutral-950'
          >
            {target === 'data-type' ? (
              <>
                <CreateDataType derivation='array' onClick={() => handleCreateDatatype('array')} />
                <CreateDataType derivation='enumerated' onClick={() => handleCreateDatatype('enumerated')} />
                <CreateDataType derivation='structure' onClick={() => handleCreateDatatype('structure')} />
              </>
            ) : (
              <>
                <div id='pou-card-label-container' className='flex h-8 w-full flex-col items-center justify-between'>
                  <div className='flex w-full select-none items-center gap-2'>
                    {CreatePouSources[target]}
                    <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
                      {startCase(target)}
                    </p>
                  </div>
                  <div className='h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
                </div>
                <div id='pou-card-form'>
                  <form
                    onSubmit={handleSubmit(handleCreatePou)}
                    className='flex h-fit w-full select-none flex-col gap-3'
                  >
                    <input type='hidden' {...register('type')} value={target} />
                    <div id='pou-name-form-container' className='flex w-full flex-col'>
                      <label
                        id='pou-name-label'
                        htmlFor='pou-name'
                        className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        POU name:
                        {errors.name?.type === 'required' && <span className='text-red-500'>*</span>}
                      </label>
                      <InputWithRef
                        {...register('name', {
                          required: true,
                          minLength: 3,
                        })}
                        id='pou-name'
                        type='text'
                        placeholder='POU name'
                        className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      {errors.name?.type === 'already-exists' && (
                        <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                          * POU name already exists
                        </span>
                      )}
                      <span className='flex-1 text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-65 dark:text-neutral-300'>
                        ** Name must be at least 3 characters
                      </span>
                    </div>
                    <div id='pou-language-form-container' className='flex w-full flex-col gap-[6px] '>
                      <label
                        id='pou-language-label'
                        htmlFor='pou-language'
                        className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        Language:
                        {errors.language && <span className='text-red-500'>*</span>}
                      </label>
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
                                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                              />
                              <SelectContent
                                className='box h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                                sideOffset={5}
                                alignOffset={5}
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
                                        {lang.icon} <span>{lang.value}</span>
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
                    <div id='form-button-container' className='flex w-full justify-between'>
                      <button
                        type='submit'
                        className={cn(
                          'h-7 w-[88px] rounded-md bg-brand font-caption text-cp-sm font-medium !text-white hover:bg-brand-medium-dark focus:bg-brand-medium',
                        )}
                      >
                        Create
                      </button>
                      <Popover.Close asChild>
                        <button
                          type='button'
                          className='h-7 w-[88px] rounded-md bg-neutral-100 font-caption text-cp-sm font-medium  !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                          onClick={handleCancelCreatePou}
                        >
                          Cancel
                        </button>
                      </Popover.Close>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { ElementCard }
