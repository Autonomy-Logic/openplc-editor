/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { CreatePouSources, PouLanguageSources } from '@process:renderer/data'
import * as Popover from '@radix-ui/react-popover'
import { ArrowIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { DatatypeDerivationSources } from '@root/renderer/data/sources/data-type'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCArrayDatatype, PLCEnumeratedDatatype, PLCStructureDatatype } from '@root/types/PLC/open-plc'
import { cn, ConvertToLangShortenedFormat } from '@root/utils'
import { startCase } from 'lodash'
import { Dispatch, ReactNode, SetStateAction, useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

import { useToast } from '../../../[app]/toast/use-toast'

type ElementCardProps = {
  target: 'function' | 'function-block' | 'program' | 'data-type'
  closeContainer: Dispatch<SetStateAction<boolean>>
}

type CreatePouFormProps = {
  type: 'function' | 'function-block' | 'program'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

type CreateDataTypeFormProps = {
  name: string
  derivation: 'array' | 'enumerated' | 'structure'
}

{
  /** TODO: Need to be implemented - Sequential Functional Chart and Functional Block Diagram */
}

const BlockedLanguagesStyles = {
  'Sequential Functional Chart':
    'hover:bg-white dark:hover:bg-neutral-950 cursor-not-allowed pointer-events-none opacity-30',
  'Functional Block Diagram':
    'hover:bg-white dark:hover:bg-neutral-950 cursor-not-allowed pointer-events-none opacity-30',
  'Ladder Diagram': '',
  'Structured Text': '',
  'Instruction List': '',
} as const

const ElementCard = (props: ElementCardProps): ReactNode => {
  const { toast } = useToast()
  const { target, closeContainer } = props
  const {
    control: pouControl,
    register: pouRegister,
    handleSubmit: handleSubmitPou,
    setError: pouSetError,
    formState: { errors: pouErrors },
  } = useForm<CreatePouFormProps>()

  const {
    control: datatypeControl,
    register: datatypeRegister,
    handleSubmit: handleSubmitDatatype,
    /**
     * TODO: add validation
     */
    // setError: datatypeSetError,
    formState: { errors: datatypeErrors },
  } = useForm<CreateDataTypeFormProps>()

  const {
    pouActions: { create },
    datatypeActions: { create: createDatatype },
  } = useOpenPLCStore()
  const [isOpen, setIsOpen] = useState(false)

  const handleCreatePou: SubmitHandler<CreatePouFormProps> = (data) => {
    try {
      const pouWasCreated = create(data)
      if (!pouWasCreated) throw new TypeError()
      toast({ title: 'Pou created successfully', description: 'The POU has been created', variant: 'default' })
      closeContainer((prev) => !prev)
      setIsOpen(false)
    } catch (_error) {
      pouSetError('name', {
        type: 'already-exists',
      })
    }
  }

  const handleCancelCreateElement = () => {
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  const handleCreateDatatype: SubmitHandler<CreateDataTypeFormProps> = (data) => {
    if (data.derivation === 'array') {
      const draft = {
        name: data.name,
        derivation: data.derivation,
        baseType: {
          definition: 'base-type',
          value: 'bool',
        },
        initialValue: '',
        dimensions: [],
      } as PLCArrayDatatype
      const res = createDatatype(draft)
    }
    if (data.derivation === 'enumerated') {
      const draft = {
        name: data.name,
        derivation: data.derivation,
        initialValue: '',
        values: [],
      } as PLCEnumeratedDatatype
      const res = createDatatype(draft)
    }
    if (data.derivation === 'structure') {
      const draft = {
        name: data.name,
        derivation: data.derivation,
        variable: [],
      } as PLCStructureDatatype
      const res = createDatatype(draft)
    }
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  const handleMouseEnter = () => {
    setIsOpen(true)
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger
        onMouseEnter={handleMouseEnter}
        id={`create-${target}-trigger`}
        className='rounded-md focus:bg-neutral-100 dark:focus:bg-neutral-900'
      >
        <div
          id={`create-${target}-trigger-container`}
          className='relative flex h-7 w-full cursor-pointer  items-center justify-between gap-[6px] rounded-md px-[6px] py-[2px] hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 dark:data-[state=open]:bg-neutral-900'
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
            id='data-type-card-root'
            className='box flex h-fit w-[225px] flex-col gap-3 rounded-lg bg-white px-3 pb-3 pt-2 dark:bg-neutral-950'
          >
            {target === 'data-type' ? (
              <>
                <div
                  id='data-type-card-label-container'
                  className='flex h-8 w-full flex-col items-center justify-between'
                >
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
                    onSubmit={handleSubmitDatatype(handleCreateDatatype)}
                    className='flex h-fit w-full select-none flex-col gap-3'
                  >
                    <div id='data-type-name-form-container' className='flex w-full flex-col'>
                      <label
                        id='data-type-name-label'
                        htmlFor='data-type-name'
                        className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        Data type name:
                        {datatypeErrors.name?.type === 'required' && <span className='text-red-500'>*</span>}
                      </label>
                      <InputWithRef
                        {...datatypeRegister('name', {
                          required: true,
                          minLength: 3,
                        })}
                        id='data-type-name'
                        type='text'
                        placeholder='Data type name'
                        className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      {datatypeErrors.name?.type === 'already-exists' && (
                        <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                          * data type name already exists
                        </span>
                      )}
                      <span className='flex-1 text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-65 dark:text-neutral-300'>
                        ** Name must be at least 3 characters
                      </span>
                    </div>
                    <div id='data-type-derivation-form-container' className='flex w-full flex-col gap-[6px] '>
                      <label
                        id='data-type-language-label'
                        htmlFor='data-type-language'
                        className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        Derivation:
                        {datatypeErrors.derivation && <span className='text-red-500'>*</span>}
                      </label>
                      <Controller
                        name='derivation'
                        control={datatypeControl}
                        rules={{ required: true }}
                        render={({ field: { value, onChange } }) => {
                          return (
                            <Select value={value} onValueChange={onChange}>
                              <SelectTrigger
                                withIndicator
                                aria-label='data-type-derivation'
                                placeholder='Select a derivation'
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
                                {DatatypeDerivationSources.map((derivation) => {
                                  return (
                                    <SelectItem
                                      key={derivation.value}
                                      className='flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900'
                                      value={derivation.value.toLocaleLowerCase()}
                                    >
                                      <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                        {derivation.icon} <span>{derivation.value}</span>
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
                      <Popover.Close asChild>
                        <button
                          type='button'
                          className='h-7 w-[88px] rounded-md bg-neutral-100 font-caption text-cp-sm font-medium  !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                          onClick={handleCancelCreateElement}
                        >
                          Cancel
                        </button>
                      </Popover.Close>
                      <button
                        type='submit'
                        className={cn(
                          'h-7 w-[88px] rounded-md bg-brand font-caption text-cp-sm font-medium !text-white hover:bg-brand-medium-dark focus:bg-brand-medium',
                        )}
                      >
                        Create
                      </button>
                    </div>
                  </form>
                </div>
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
                    onSubmit={handleSubmitPou(handleCreatePou)}
                    className='flex h-fit w-full select-none flex-col gap-3'
                  >
                    <input type='hidden' {...pouRegister('type')} value={target} />
                    <div id='pou-name-form-container' className='flex w-full flex-col'>
                      <label
                        id='pou-name-label'
                        htmlFor='pou-name'
                        className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                      >
                        POU name:
                        {pouErrors.name?.type === 'required' && <span className='text-red-500'>*</span>}
                      </label>
                      <InputWithRef
                        {...pouRegister('name', {
                          required: true,
                          minLength: 3,
                        })}
                        id='pou-name'
                        type='text'
                        placeholder='POU name'
                        className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                      />
                      {pouErrors.name?.type === 'already-exists' && (
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
                        {pouErrors.language && <span className='text-red-500'>*</span>}
                      </label>
                      <Controller
                        name='language'
                        control={pouControl}
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
                                      className={cn(
                                        `${BlockedLanguagesStyles[lang.value]}`,
                                        'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900',
                                      )}
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
                      <Popover.Close asChild>
                        <button
                          type='button'
                          className='h-7 w-[88px] rounded-md bg-neutral-100 font-caption text-cp-sm font-medium  !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                          onClick={handleCancelCreateElement}
                        >
                          Cancel
                        </button>
                      </Popover.Close>
                      <button
                        type='submit'
                        className={cn(
                          'h-7 w-[88px] rounded-md bg-brand font-caption text-cp-sm font-medium !text-white hover:bg-brand-medium-dark focus:bg-brand-medium',
                        )}
                      >
                        Create
                      </button>
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
