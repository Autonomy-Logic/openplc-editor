/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { CreatePouSources, PouLanguageSources } from '@process:renderer/data'
import * as Popover from '@radix-ui/react-popover'
import { ArrowIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { DatatypeDerivationSources } from '@root/renderer/data/sources/data-type'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCArrayDatatype, PLCEnumeratedDatatype, PLCStructureDatatype } from '@root/types/PLC/open-plc'
import {
  cn,
  ConvertToLangShortenedFormat,
  isArduinoTarget as checkIsArduinoTarget,
  isOpenPLCRuntimeV4Target,
} from '@root/utils'
import { startCase } from 'lodash'
import { Dispatch, ReactNode, SetStateAction, useState } from 'react'
import { Controller, SubmitHandler, useForm } from 'react-hook-form'

import { useToast } from '../../../[app]/toast/use-toast'

type ElementCardProps = {
  target: 'function' | 'function-block' | 'program' | 'data-type' | 'server' | 'remote-device'
  closeContainer: Dispatch<SetStateAction<boolean>>
}

type CreatePouFormProps = {
  type: 'function' | 'function-block' | 'program'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
}

type CreateDataTypeFormProps = {
  name: string
  derivation: 'array' | 'enumerated' | 'structure'
}

type CreateServerFormProps = {
  name: string
  protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip'
}

type CreateRemoteDeviceFormProps = {
  name: string
  protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'
}

const ServerProtocolSources = [
  { value: 'modbus-tcp', label: 'Modbus/TCP', disabled: false },
  { value: 's7comm', label: 'Siemens S7comm', disabled: true },
  { value: 'ethernet-ip', label: 'EtherNet/IP', disabled: true },
] as const

const RemoteDeviceProtocolSources = [
  { value: 'modbus-tcp', label: 'Modbus/TCP', disabled: false },
  { value: 'ethernet-ip', label: 'EtherNet/IP', disabled: true },
  { value: 'ethercat', label: 'EtherCAT', disabled: true },
  { value: 'profinet', label: 'PROFINET', disabled: true },
] as const

{
  /** TODO: Need to be implemented - Sequential Functional Chart and Functional Block Diagram */
}

const getBlockedLanguageStyle = (isBlocked: boolean) =>
  isBlocked ? 'hover:bg-white dark:hover:bg-neutral-950 cursor-not-allowed pointer-events-none opacity-30' : ''

const BlockedLanguagesStyles = {
  'Sequential Functional Chart':
    'hover:bg-white dark:hover:bg-neutral-950 cursor-not-allowed pointer-events-none opacity-30',
  'Functional Block Diagram': '',
  'Ladder Diagram': '',
  'Structured Text': '',
  'Instruction List': '',
  Python: '',
  'C/C++': '',
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
    control: serverControl,
    register: serverRegister,
    handleSubmit: handleSubmitServer,
    setError: serverSetError,
    formState: { errors: serverErrors },
  } = useForm<CreateServerFormProps>()

  const {
    control: remoteDeviceControl,
    register: remoteDeviceRegister,
    handleSubmit: handleSubmitRemoteDevice,
    setError: remoteDeviceSetError,
    formState: { errors: remoteDeviceErrors },
  } = useForm<CreateRemoteDeviceFormProps>()

  const {
    pouActions: { create },
    datatypeActions: { create: createDatatype },
    projectActions: { createServer, createRemoteDevice },
    deviceAvailableOptions: { availableBoards },
  } = useOpenPLCStore()
  const deviceBoard = useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard)
  const [isOpen, setIsOpen] = useState(false)

  const currentBoardInfo = availableBoards.get(deviceBoard)
  const isArduinoTarget = checkIsArduinoTarget(currentBoardInfo)
  const isRuntimeV4 = isOpenPLCRuntimeV4Target(deviceBoard)

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

  const handleCreateServer: SubmitHandler<CreateServerFormProps> = (data) => {
    const serverWasCreated = createServer({ data: { name: data.name, protocol: data.protocol } })
    if (!serverWasCreated.ok) {
      serverSetError('name', {
        type: 'already-exists',
      })
      return
    }

    toast({
      title: 'Server created successfully',
      description: 'The server has been created',
      variant: 'default',
    })
    closeContainer((prev) => !prev)
    setIsOpen(false)
  }

  const handleCreateRemoteDevice: SubmitHandler<CreateRemoteDeviceFormProps> = (data) => {
    const remoteDeviceWasCreated = createRemoteDevice({ data: { name: data.name, protocol: data.protocol } })
    if (!remoteDeviceWasCreated.ok) {
      remoteDeviceSetError('name', {
        type: 'already-exists',
      })
      return
    }

    toast({
      title: 'Remote device created successfully',
      description: 'The remote device has been created',
      variant: 'default',
    })
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
        className='group rounded-md focus:bg-neutral-100 dark:focus:bg-neutral-900'
      >
        <div
          id={`create-${target}-trigger-container`}
          className='relative flex h-7 w-full cursor-pointer  items-center justify-between gap-[6px] rounded-md px-[6px] py-[2px] hover:bg-neutral-100 group-aria-[expanded=true]:bg-neutral-100 group-data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 dark:group-aria-[expanded=true]:bg-neutral-900 dark:group-data-[state=open]:bg-neutral-900'
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
            ) : target === 'server' ? (
              <>
                <div id='server-card-label-container' className='flex h-8 w-full flex-col items-center justify-between'>
                  <div className='flex w-full select-none items-center gap-2'>
                    {CreatePouSources[target]}
                    <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
                      {startCase(target)}
                    </p>
                  </div>
                  <div className='h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
                </div>
                {!isRuntimeV4 ? (
                  <div className='flex flex-col gap-2 py-2'>
                    <p className='text-sm text-neutral-700 dark:text-neutral-300'>
                      Server configuration is only available for OpenPLC Runtime v4 targets.
                    </p>
                    <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                      Please select OpenPLC Runtime v4 in the Device Configuration to enable this feature.
                    </p>
                  </div>
                ) : (
                  <div id='server-card-form'>
                    <form
                      onSubmit={handleSubmitServer(handleCreateServer)}
                      className='flex h-fit w-full select-none flex-col gap-3'
                    >
                      <div id='server-name-form-container' className='flex w-full flex-col'>
                        <label
                          id='server-name-label'
                          htmlFor='server-name'
                          className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                        >
                          Server name:
                          {serverErrors.name?.type === 'required' && <span className='text-red-500'>*</span>}
                        </label>
                        <InputWithRef
                          {...serverRegister('name', {
                            required: true,
                            minLength: 3,
                          })}
                          id='server-name'
                          type='text'
                          placeholder='Server name'
                          className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                        />
                        {serverErrors.name?.type === 'already-exists' && (
                          <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                            * Server name already exists or protocol already in use
                          </span>
                        )}
                        <span className='flex-1 text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-65 dark:text-neutral-300'>
                          ** Name must be at least 3 characters
                        </span>
                      </div>
                      <div id='server-protocol-form-container' className='flex w-full flex-col gap-[6px] '>
                        <label
                          id='server-protocol-label'
                          htmlFor='server-protocol'
                          className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                        >
                          Protocol:
                          {serverErrors.protocol && <span className='text-red-500'>*</span>}
                        </label>
                        <Controller
                          name='protocol'
                          control={serverControl}
                          rules={{ required: true }}
                          render={({ field: { value, onChange } }) => {
                            return (
                              <Select value={value} onValueChange={onChange}>
                                <SelectTrigger
                                  withIndicator
                                  aria-label='server-protocol'
                                  placeholder='Select a protocol'
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
                                  {ServerProtocolSources.map((protocol) => {
                                    return (
                                      <SelectItem
                                        key={protocol.value}
                                        className={cn(
                                          protocol.disabled
                                            ? 'cursor-not-allowed opacity-50'
                                            : 'cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900',
                                          'flex w-full items-center px-2 py-[9px] outline-none',
                                        )}
                                        value={protocol.value}
                                        disabled={protocol.disabled}
                                      >
                                        <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                          {protocol.label}
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
                )}
              </>
            ) : target === 'remote-device' ? (
              <>
                <div
                  id='remote-device-card-label-container'
                  className='flex h-8 w-full flex-col items-center justify-between'
                >
                  <div className='flex w-full select-none items-center gap-2'>
                    {CreatePouSources[target]}
                    <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
                      Remote Device
                    </p>
                  </div>
                  <div className='h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
                </div>
                {!isRuntimeV4 ? (
                  <div className='flex flex-col gap-2 py-2'>
                    <p className='text-sm text-neutral-700 dark:text-neutral-300'>
                      Remote device configuration is only available for OpenPLC Runtime v4 targets.
                    </p>
                    <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                      Please select OpenPLC Runtime v4 in the Device Configuration to enable this feature.
                    </p>
                  </div>
                ) : (
                  <div id='remote-device-card-form'>
                    <form
                      onSubmit={handleSubmitRemoteDevice(handleCreateRemoteDevice)}
                      className='flex h-fit w-full select-none flex-col gap-3'
                    >
                      <div id='remote-device-name-form-container' className='flex w-full flex-col'>
                        <label
                          id='remote-device-name-label'
                          htmlFor='remote-device-name'
                          className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                        >
                          Device name:
                          {remoteDeviceErrors.name?.type === 'required' && <span className='text-red-500'>*</span>}
                        </label>
                        <InputWithRef
                          {...remoteDeviceRegister('name', {
                            required: true,
                            minLength: 3,
                          })}
                          id='remote-device-name'
                          type='text'
                          placeholder='Device name'
                          className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                        />
                        {remoteDeviceErrors.name?.type === 'already-exists' && (
                          <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                            * Device name already exists
                          </span>
                        )}
                        <span className='flex-1 text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-65 dark:text-neutral-300'>
                          ** Name must be at least 3 characters
                        </span>
                      </div>
                      <div id='remote-device-protocol-form-container' className='flex w-full flex-col gap-[6px] '>
                        <label
                          id='remote-device-protocol-label'
                          htmlFor='remote-device-protocol'
                          className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                        >
                          Protocol:
                          {remoteDeviceErrors.protocol && <span className='text-red-500'>*</span>}
                        </label>
                        <Controller
                          name='protocol'
                          control={remoteDeviceControl}
                          rules={{ required: true }}
                          render={({ field: { value, onChange } }) => {
                            return (
                              <Select value={value} onValueChange={onChange}>
                                <SelectTrigger
                                  withIndicator
                                  aria-label='remote-device-protocol'
                                  placeholder='Select a protocol'
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
                                  {RemoteDeviceProtocolSources.map((protocol) => {
                                    return (
                                      <SelectItem
                                        key={protocol.value}
                                        className={cn(
                                          protocol.disabled
                                            ? 'cursor-not-allowed opacity-50'
                                            : 'cursor-pointer hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus:bg-neutral-900',
                                          'flex w-full items-center px-2 py-[9px] outline-none',
                                        )}
                                        value={protocol.value}
                                        disabled={protocol.disabled}
                                      >
                                        <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                          {protocol.label}
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
                )}
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
                                {PouLanguageSources.filter((lang) => {
                                  if (target === 'function-block') return true
                                  return lang.value !== 'Python' && lang.value !== 'C/C++'
                                }).map((lang) => {
                                  const isPythonBlockedForArduino = lang.value === 'Python' && isArduinoTarget
                                  const isDisabled = !!BlockedLanguagesStyles[lang.value] || isPythonBlockedForArduino

                                  return (
                                    <SelectItem
                                      key={lang.value}
                                      disabled={isDisabled}
                                      className={cn(
                                        BlockedLanguagesStyles[lang.value],
                                        getBlockedLanguageStyle(isPythonBlockedForArduino),
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
