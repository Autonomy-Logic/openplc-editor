/* eslint-disable @typescript-eslint/no-misused-promises */
import { CreatePouSources, PouLanguageSources } from '@process:renderer/data'
import * as Popover from '@radix-ui/react-popover'
import { ArrowIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { IFunction, IFunctionBlock, IProgram } from '@root/types/PLC'
import { ConvertToLangShortenedFormat, CreateEditorPath } from '@root/utils'
import { lowerCase, startCase } from 'lodash'
import { Dispatch, ReactNode, SetStateAction, useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

type ICardProps = {
  target: 'function' | 'function-block' | 'program'
  closeContainer: Dispatch<SetStateAction<boolean>>
}

type IPouFormProps = {
  pouType: 'function' | 'function-block' | 'program'
  pouName: string
  pouLanguage: 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL'
}

type IPouDTO =
  | {
      type: 'program'
      data: IProgram
    }
  | {
      type: 'function'
      data: IFunction
    }
  | {
      type: 'function-block'
      data: IFunctionBlock
    }

const Card = (props: ICardProps): ReactNode => {
  const { target, closeContainer } = props
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IPouFormProps>()
  const {
    workspaceActions: { createPou },
    editorActions: { setEditor },
    tabsActions: { updateTabs },
  } = useOpenPLCStore()
  const [isOpen, setIsOpen] = useState(false)

  const handleWorkspaceActions = (data: IPouFormProps) => {
    const dataToCreatePou = createNormalizedPou(data)
    const response = createPou(dataToCreatePou)
    if (!response.ok) {
      console.log(response.message)
    } else {
      console.log(response.message)
      // closeContainer((prev) => !prev)
      // setIsOpen(false)
    }
  }

  const handleEditorActions = (data: IPouFormProps) => {
    const dataToCreateEditor = {
      path: CreateEditorPath(data.pouName, data.pouType),
      language: lowerCase(data.pouLanguage),
      value: '',
      isEditorOpen: true,
    }
    setEditor(dataToCreateEditor)
  }

  const handleTabsActions = (data: IPouFormProps) => {
    const dataToCreateTab = {
      name: data.pouName,
      language: data.pouLanguage,
      currentTab: true,
    }
    updateTabs(dataToCreateTab)
  }

  const createNormalizedPou = (data: IPouFormProps): IPouDTO => {
    switch (data.pouType) {
      case 'function':
        return {
          type: 'function',
          data: {
            name: data.pouName,
            language: data.pouLanguage,
            body: '',
            returnType: 'BOOL',
          },
        }
      case 'function-block':
        return {
          type: 'function-block',
          data: {
            name: data.pouName,
            language: data.pouLanguage,
            body: '',
          },
        }
      case 'program':
        return {
          type: 'program',
          data: {
            name: data.pouName,
            language: data.pouLanguage,
            body: '',
          },
        }
    }
  }

  const submitData: SubmitHandler<IPouFormProps> = (data) => {
    handleWorkspaceActions(data)
    handleEditorActions(data)
    handleTabsActions(data)
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  const handleCancelCreatePou = () => {
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
            className='flex h-fit w-[225px] flex-col gap-3 rounded-lg border border-brand-light bg-white p-2 px-3 pb-3 pt-2 drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
          >
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
              <form onSubmit={handleSubmit(submitData)} className='flex h-fit w-full select-none flex-col gap-3'>
                <input type='hidden' {...register('pouType')} value={target} />
                <div id='pou-name-form-container' className='flex w-full flex-col gap-[6px]'>
                  <label
                    id='pou-name-label'
                    htmlFor='pou-name'
                    className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                  >
                    POU name:
                  </label>
                  <InputWithRef
                    {...register('pouName', {
                      required: 'POU name is required',
                      minLength: {
                        value: 3,
                        message: 'POU name must be at least 3 characters',
                      },
                    })}
                    id='pou-name'
                    type='text'
                    placeholder='POU name'
                    className='h-[30px] w-full rounded-md  border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  {errors.pouName && (
                    <span className='flex-1 text-center font-caption text-cp-sm font-normal text-red-500 dark:text-red-500'>
                      {errors.pouName.message}
                    </span>
                  )}
                </div>
                <div id='pou-language-form-container' className='flex w-full flex-col gap-[6px] '>
                  <label
                    id='pou-language-label'
                    htmlFor='pou-language'
                    className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                  >
                    Language:
                  </label>
                  <Controller
                    name='pouLanguage'
                    control={control}
                    render={({ field: { value, onChange } }) => {
                      return (
                        <Select value={value} onValueChange={onChange}>
                          <SelectTrigger
                            id='pou-language'
                            aria-label='pou-language'
                            placeholder='Select a language'
                            className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                          />
                          <SelectContent
                            className='h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-neutral-100 bg-white drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
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
                                  className='flex w-full cursor-pointer items-center px-2 py-[9px] hover:bg-neutral-100 dark:hover:bg-neutral-900'
                                  value={ConvertToLangShortenedFormat(lang.value)}
                                >
                                  <span className='flex items-center  gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
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
                    className='h-7 w-[88px] rounded-md bg-brand font-caption text-cp-sm  font-medium !text-white hover:bg-brand-medium-dark focus:bg-brand-medium'
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
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { Card }
